#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
GOWORK=off go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2 --config oapi-codegen.yaml openapi.yaml
npm run generate
