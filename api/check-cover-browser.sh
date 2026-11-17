#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p _scratch/m3/backend/tmp _scratch/m3/backend/cover-browser
ANTHOLUME_COVER_BROWSER=1 \
ANTHOLUME_COVER_EVIDENCE="$PWD/_scratch/m3/backend/cover-browser" \
TMPDIR="$PWD/_scratch/m3/backend/tmp" \
go test -mod=readonly -count=1 -timeout=120s -run '^TestCoverBrowserIsolation$' -v ./api
