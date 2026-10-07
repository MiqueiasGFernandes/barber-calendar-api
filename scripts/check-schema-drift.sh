#!/usr/bin/env sh
set -eu
project="${COMPOSE_PROJECT_NAME:-barber-schema-check}"
export E2E_DB_PORT="${E2E_DB_PORT:-55433}"
temporary="$(mktemp -d)"
cleanup(){ docker compose -p "$project" -f compose.e2e.yaml down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$temporary"; }
trap cleanup EXIT INT TERM
docker compose -p "$project" -f compose.e2e.yaml up -d --wait db-e2e
docker compose -p "$project" -f compose.e2e.yaml exec -T db-e2e pg_dump --schema-only --no-owner --no-privileges -U postgres barber_calendar_e2e | sed '/^--/d;/^$/d;/^\\restrict /d;/^\\unrestrict /d' > "$temporary/actual.sql"
test -s "$temporary/actual.sql"
actual="$(sha256sum "$temporary/actual.sql" | cut -d ' ' -f 1)"
expected="$(cut -d ' ' -f 1 database/schema/schema.sha256)"
if [ "$actual" != "$expected" ]; then
  printf 'Schema drift detected: expected %s, received %s\n' "$expected" "$actual" >&2
  exit 1
fi
