#!/usr/bin/env sh
set -eu
# Somente banco descartável criado por este Compose; nunca usa DATABASE_URL.
project="${RELEASE_COMPOSE_PROJECT_NAME:-barber-release-check}"
baseline="${BARBER_BASELINE_REF:-4bf8c9d}"
export E2E_DB_PORT="${RELEASE_DB_PORT:-55434}"
if [ -z "${BARBER_RUNTIME_PASSWORD:-}" ]; then
  BARBER_RUNTIME_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
fi
export BARBER_RUNTIME_PASSWORD
if [ -z "${POSTGRES_ADMIN_PASSWORD:-}" ]; then
  POSTGRES_ADMIN_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
fi
export POSTGRES_ADMIN_PASSWORD
temporary="$(mktemp -d)"
cleanup(){ docker compose -p "$project" -f compose.e2e.yaml down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$temporary"; }
trap cleanup EXIT INT TERM
git cat-file -e "$baseline:database/schema/090_schema_manifest.sql"
git archive "$baseline" database/schema database/verify/assertions.sql | tar -x -C "$temporary"
compose(){ docker compose -p "$project" -f compose.e2e.yaml "$@"; }
psql_db(){ compose exec -T db-e2e psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$@"; }
signature(){ psql_db "$1" -tA -f /opt/app-sql/verify/scheduling-release-equivalence.sql; }
compare(){
  if ! cmp -s "$1" "$2"; then
    printf '%s\n' 'Diferença estrutural detectada; comparação por categoria:' >&2
    python3 - "$1" "$2" <<'PY'
import json,sys
left=json.load(open(sys.argv[1])); right=json.load(open(sys.argv[2]))
for key in left:
 if left[key]!=right[key]: print(key, '\nesperado:', left[key], '\nrecebido:', right[key], file=sys.stderr)
PY
    exit 1
  fi
}
compose up -d --wait db-e2e
psql_db postgres -c 'CREATE DATABASE scheduling_release'
tar -C "$temporary/database" -cf - . | compose exec -T db-e2e sh -c 'mkdir -p /tmp/release-baseline && tar -C /tmp/release-baseline -xf -'
psql_db scheduling_release <<'SQL'
\getenv BARBER_RUNTIME_PASSWORD BARBER_RUNTIME_PASSWORD
\ir /tmp/release-baseline/schema/001_extensions.sql
\ir /tmp/release-baseline/schema/010_schemas.sql
\ir /tmp/release-baseline/schema/020_tables.sql
\ir /tmp/release-baseline/schema/030_constraints.sql
\ir /tmp/release-baseline/schema/040_indexes.sql
\ir /tmp/release-baseline/schema/090_schema_manifest.sql
\ir /tmp/release-baseline/schema/090_grants.sql
REVOKE ALL ON DATABASE scheduling_release FROM barber_runtime;
GRANT CONNECT ON DATABASE scheduling_release TO barber_runtime;
\ir /tmp/release-baseline/verify/assertions.sql
INSERT INTO tenancy.tenants(id,name,slug,created_at,updated_at) VALUES ('90000000-0000-4000-8000-000000000001','Release Exemplo','release-exemplo',now(),now());
SQL
signature scheduling_release > "$temporary/baseline.json"
signature barber_calendar_e2e > "$temporary/canonical.json"
# Primeiro validar a base v1, preservando seu release imutável.
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling/up.sql
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling/verify.sql
signature scheduling_release > "$temporary/v1.json"
psql_db scheduling_release <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM scheduling.tenant_settings WHERE tenant_id='90000000-0000-4000-8000-000000000001' AND slot_interval_minutes=15 AND minimum_advance_minutes=30) THEN RAISE EXCEPTION 'defaults not backfilled'; END IF;
END $$;
\ir /opt/app-sql/tests/fixtures/scheduling.sql
INSERT INTO scheduling.appointment_events(id,tenant_id,appointment_id,event_type,occurred_at,correlation_id,new_status,starts_at,ends_at)
SELECT gen_random_uuid(),tenant_id,id,'created',now(),gen_random_uuid(),'confirmed',starts_at,ends_at FROM scheduling.appointments;
SQL
# Hash dos dados v1, comparado antes/depois do incremento e do seu rollback.
v1_data(){ psql_db scheduling_release -tA -c "SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM scheduling.appointments a),(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM scheduling.appointment_events e),(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tenancy.tenants t))::text)"; }
v1_data > "$temporary/v1-data.txt"
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling-audit/up.sql
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling-audit/verify.sql
psql_db scheduling_release -f /opt/app-sql/verify/assertions.sql
signature scheduling_release > "$temporary/up.json"
compare "$temporary/canonical.json" "$temporary/up.json"
v1_data > "$temporary/v2-data.txt"
cmp "$temporary/v1-data.txt" "$temporary/v2-data.txt"
# Nova trilha fica vazia no upgrade: não inventar auditoria retroativa.
psql_db scheduling_release <<'SQL'
DO $$ BEGIN
 IF EXISTS(SELECT FROM scheduling.configuration_events) OR EXISTS(SELECT FROM scheduling.configuration_audit_access) THEN RAISE EXCEPTION 'unexpected audit backfill'; END IF;
END $$;
INSERT INTO scheduling.configuration_events(id,tenant_id,actor_membership_id,operation_id,operation,resource_type,resource_id,occurred_at,correlation_id,changes)
VALUES(gen_random_uuid(),'10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',gen_random_uuid(),'updateSchedulingSettings','tenant_settings','10000000-0000-4000-8000-000000000001',now(),'release-verification','{"slot_interval_minutes":{"before":15,"after":20}}');
SQL
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling-audit/rollback.sql
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling/verify.sql
signature scheduling_release > "$temporary/v1-rollback.json"
compare "$temporary/v1.json" "$temporary/v1-rollback.json"
v1_data > "$temporary/v1-rollback-data.txt"
cmp "$temporary/v1-data.txt" "$temporary/v1-rollback-data.txt"
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling-audit/up.sql
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling-audit/verify.sql
signature scheduling_release > "$temporary/reapplied.json"
compare "$temporary/canonical.json" "$temporary/reapplied.json"
# Prova separada do rollback original v1 -> autenticação.
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling-audit/rollback.sql
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling/rollback.sql
psql_db scheduling_release -f /tmp/release-baseline/verify/assertions.sql
signature scheduling_release > "$temporary/rollback.json"
compare "$temporary/baseline.json" "$temporary/rollback.json"
psql_db scheduling_release <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM tenancy.tenants WHERE id='90000000-0000-4000-8000-000000000001' AND name='Release Exemplo') THEN RAISE EXCEPTION 'existing tenant was lost'; END IF;
 IF to_regnamespace('scheduling') IS NOT NULL THEN RAISE EXCEPTION 'rollback retained scheduling'; END IF;
END $$;
SQL
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling/up.sql
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling-audit/up.sql
psql_db scheduling_release -f /opt/app-sql/releases/002-appointment-scheduling-audit/verify.sql
signature scheduling_release > "$temporary/final.json"
compare "$temporary/canonical.json" "$temporary/final.json"
printf '%s\n' "Release validado: baseline $baseline -> v1 -> v2; dados v1 preservados, rollback incremental e original, reaplicação, grants e RLS equivalentes ao bootstrap v2."
