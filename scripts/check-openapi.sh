#!/usr/bin/env sh
set -eu
node --input-type=module -e "import fs from 'node:fs'; import YAML from 'yaml'; const source=fs.readFileSync('specs/001-tenant-authentication/contracts/openapi.yaml','utf8'); const api=YAML.parse(source); if(api.openapi!=='3.1.0'||!api.paths?.['/tenants/register']||!api.paths?.['/auth/otp-requests']||!api.paths?.['/auth/otp-verifications']) throw new Error('invalid OpenAPI contract');"
temporary="$(mktemp)"
trap 'rm -f "$temporary"' EXIT INT TERM
yarn openapi-typescript specs/001-tenant-authentication/contracts/openapi.yaml -o "$temporary"
if ! cmp -s "$temporary" src/shared/http/openapi-types.ts; then
  diff -u src/shared/http/openapi-types.ts "$temporary" || true
  printf 'Generated OpenAPI types are out of date; run yarn contract:types.\n' >&2
  exit 1
fi
