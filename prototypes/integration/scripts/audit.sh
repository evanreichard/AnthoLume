#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GOWORK=off
root="$(cd ../.. && pwd)"
scratch="$root/_scratch/m2/integration"
mkdir -p "$scratch/tmp"
export TMPDIR="$scratch/tmp"
go version
go mod verify
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -json ./... > "$scratch/audit-go.json"
python3 ../api-contract/scripts/audit-summary.py "$scratch/audit-go.json"
npm audit --json > "$scratch/npm-audit.json"
npm audit --omit=dev --json > "$scratch/npm-audit-runtime.json"
node --input-type=module -e 'import fs from "node:fs"; for (const file of process.argv.slice(1)) { const audit = JSON.parse(fs.readFileSync(file, "utf8")); if (audit.metadata?.vulnerabilities?.total !== 0) process.exit(1); } console.log("npm full/runtime audits: zero advisories");' "$scratch/npm-audit.json" "$scratch/npm-audit-runtime.json"
