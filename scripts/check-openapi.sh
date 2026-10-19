#!/usr/bin/env sh
set -eu
node --input-type=module -e "import fs from 'node:fs'; import YAML from 'yaml'; const auth=YAML.parse(fs.readFileSync('specs/001-tenant-authentication/contracts/openapi.yaml','utf8')); const scheduling=YAML.parse(fs.readFileSync('specs/002-appointment-scheduling/contracts/openapi.yaml','utf8')); if(auth.openapi!=='3.1.0'||!auth.paths?.['/tenants/register']||!auth.paths?.['/auth/otp-requests']||!auth.paths?.['/auth/otp-verifications']) throw new Error('invalid authentication OpenAPI contract'); if(scheduling.openapi!=='3.1.0'||!Object.keys(scheduling.paths??{}).length) throw new Error('invalid scheduling OpenAPI contract');"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT INT TERM
yarn openapi-typescript specs/001-tenant-authentication/contracts/openapi.yaml -o "$temporary/auth.ts"
yarn openapi-typescript specs/002-appointment-scheduling/contracts/openapi.yaml -o "$temporary/scheduling.ts"
for pair in "$temporary/auth.ts:src/shared/http/openapi-types.ts" "$temporary/scheduling.ts:src/modules/scheduling/infrastructure/http/openapi-types.ts"; do
  generated="${pair%%:*}"; checked="${pair#*:}"
  if ! cmp -s "$generated" "$checked"; then
    diff -u "$checked" "$generated" || true
    printf 'Generated OpenAPI types are out of date; run yarn contract:types.\n' >&2
    exit 1
  fi
done
