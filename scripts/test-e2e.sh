#!/usr/bin/env sh
set -eu
project="${COMPOSE_PROJECT_NAME:-barber-e2e}"
if [ -z "${BARBER_RUNTIME_PASSWORD:-}" ]; then
  BARBER_RUNTIME_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
fi
export BARBER_RUNTIME_PASSWORD
if [ -z "${POSTGRES_ADMIN_PASSWORD:-}" ]; then
  POSTGRES_ADMIN_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
fi
export POSTGRES_ADMIN_PASSWORD
cleanup() { docker compose -p "$project" -f compose.e2e.yaml down -v --remove-orphans; }
trap cleanup EXIT INT TERM
cleanup
docker compose -p "$project" -f compose.e2e.yaml up -d --wait
DATABASE_URL="postgres://barber_runtime:${BARBER_RUNTIME_PASSWORD}@localhost:${E2E_DB_PORT:-55432}/barber_calendar_e2e" yarn vitest run --config vitest.e2e.config.ts --no-file-parallelism
