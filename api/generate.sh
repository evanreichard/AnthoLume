#!/usr/bin/env bash
set -euo pipefail
# Optional destination has the same layout as the checkout (used by check-generation).
destination=${1:-$(dirname "$0")/..}
mkdir -p "$destination"
out=$(cd "$destination" && pwd)
cd "$(dirname "$0")/.."
mkdir -p "$out/api" "$out/web/src/api"
GOWORK=off go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2 \
  --config api/oapi-codegen.yaml -o "$out/api/contract.gen.go" api/openapi.yaml
node api/generate-ts.mjs "$out/web/src/api/schema.gen.ts"
node api/generate-guards.mjs "$out/web/src/api"
