#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p _scratch/m3/backend
output=_scratch/m3/backend/govulncheck.json
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -json ./... > "$output"
python3 - "$output" <<'PY'
import json, sys
text = open(sys.argv[1]).read()
decoder = json.JSONDecoder()
findings = []
configs = []
sboms = []
while text.strip():
    obj, end = decoder.raw_decode(text.lstrip())
    text = text.lstrip()[end:]
    if 'config' in obj:
        configs.append(obj['config'])
    if 'SBOM' in obj:
        sboms.append(obj['SBOM'])
    if 'finding' in obj:
        findings.append(obj['finding'])
expected_go = 'go' + next(line.split()[1] for line in open('go.mod') if line.startswith('go '))
if len(configs) != 1 or configs[0].get('go_version') != expected_go:
    raise SystemExit('missing scan configuration or wrong Go toolchain')
if not any(module.get('path') == 'reichard.io/antholume' for sbom in sboms for module in sbom.get('modules', [])):
    raise SystemExit('missing actual-root SBOM')
if findings:
    print(json.dumps(findings, indent=2))
    raise SystemExit('vulnerability findings in actual root graph')
print('govulncheck: zero finding records')
PY
