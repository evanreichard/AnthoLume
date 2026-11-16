#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GOWORK=off
root="$(cd ../.. && pwd)"
scratch="$root/_scratch/m2/integration"
mkdir -p "$scratch/tmp" "$scratch/t"
export GOTMPDIR="$scratch/tmp"
# Chromium Socket Budget - A relative path still targets assigned scratch while staying below AF_UNIX's 108-byte pathname limit.
export TMPDIR="../../_scratch/m2/integration/t"
: "${CHROMIUM_PATH:?Set CHROMIUM_PATH to an existing Chromium executable}"
go version
node --version
npm --version
"$CHROMIUM_PATH" --version
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
sha256sum ../reader-storage/src/{storage,sync,wire,content-policy,archive-path,chapter-policy,css-policy,body-contract}.ts ../reader-storage/public/fixtures/synthetic.epub ../api-contract/client/schema.gen.ts ../api-contract/{server,store}.go > "$scratch/source-contract-hashes.txt"
go test -mod=readonly -count=1 -timeout=120s ./...
go vet -mod=readonly ./...
go build -mod=readonly -race -o "$scratch/fixture-server" ./cmd/fixture
npm run test:browser
go list -mod=readonly -m all > "$scratch/resolved-modules.txt"
printf 'Browser/Go proof passed; all listeners were test-owned.\n'
