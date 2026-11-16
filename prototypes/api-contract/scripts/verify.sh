#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GOWORK=off
root="$(cd ../.. && pwd)"
scratch="$root/_scratch/m2/api-contract"
mkdir -p "$scratch/tmp"
export TMPDIR="$scratch/tmp"
go version
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
bash scripts/check-drift.sh
npm run typecheck
npm run test:client
go test -mod=readonly -count=1 -timeout=120s ./...
go test -mod=readonly -race -count=1 -timeout=120s ./...
go vet -mod=readonly ./...
go test -mod=readonly -count=1 -timeout=120s reichard.io/antholume/api
python3 scripts/fault-check.py
go list -mod=readonly -m all > "$scratch/resolved-modules.txt"
printf 'Bounded API proof passed; no production migration performed.\n'
