#!/usr/bin/env sh
set -eu
project="${COMPOSE_PROJECT_NAME:-barber-e2e}"
cleanup() { docker compose -p "$project" -f compose.e2e.yaml down -v --remove-orphans; }
trap cleanup EXIT INT TERM
cleanup
docker compose -p "$project" -f compose.e2e.yaml up -d --wait
DATABASE_URL="postgres://barber_runtime:barber_runtime@localhost:${E2E_DB_PORT:-55432}/barber_calendar_e2e" pnpm vitest run --config vitest.e2e.config.ts --no-file-parallelism

