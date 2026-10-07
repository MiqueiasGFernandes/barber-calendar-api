#!/usr/bin/env sh
set -eu

pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm contract:check
pnpm schema:check
pnpm test:e2e
