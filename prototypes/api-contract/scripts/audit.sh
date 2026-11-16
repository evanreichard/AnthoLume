#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GOWORK=off
root="$(cd ../.. && pwd)"
scratch="$root/_scratch/m2/api-contract"
mkdir -p "$scratch/tmp"
export TMPDIR="$scratch/tmp"
go version
go mod verify
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -json ./... > "$scratch/audit-prototype.json"
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -json reichard.io/antholume/api > "$scratch/audit-root-api.json"
python3 scripts/audit-summary.py "$scratch/audit-prototype.json" "$scratch/audit-root-api.json"
npm audit --json > "$scratch/npm-audit.json"
node --input-type=module -e 'import fs from "node:fs"; const audit = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (audit.metadata?.vulnerabilities?.total !== 0) process.exit(1); console.log("npm audit: zero advisories in lockfile inventory");' "$scratch/npm-audit.json"
