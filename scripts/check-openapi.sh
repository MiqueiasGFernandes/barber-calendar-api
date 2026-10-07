#!/usr/bin/env sh
set -eu
node --input-type=module -e "import fs from 'node:fs'; import YAML from 'yaml'; const source=fs.readFileSync('specs/001-tenant-authentication/contracts/openapi.yaml','utf8'); const api=YAML.parse(source); if(api.openapi!=='3.1.0'||!api.paths?.['/tenants/register']||!api.paths?.['/auth/otp-requests']||!api.paths?.['/auth/otp-verifications']) throw new Error('invalid OpenAPI contract');"

