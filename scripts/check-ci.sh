#!/usr/bin/env sh
set -eu

yarn lint
yarn typecheck
yarn build
yarn test:unit
yarn test:contract
yarn contract:check
yarn schema:check
yarn test:e2e
