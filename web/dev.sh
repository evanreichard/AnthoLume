#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -m 700 -p data
if [[ ! -d data || -L data ]]; then
  echo "Expected a local data directory at $PWD/data" >&2
  exit 1
fi
if ! command -v flock >/dev/null; then
  echo "Dev requires flock (util-linux)." >&2
  exit 1
fi

(umask 077; touch data/.dev.lock)
exec 9>>data/.dev.lock
if ! flock -n 9; then
  echo "Dev is running; stop it first." >&2
  exit 1
fi

case "${1:-}" in
  start) exec node web/dev.mjs ;;
  clean) exec go run ./tools/dev clean ;;
  *) echo 'Usage: bash web/dev.sh {start|clean}' >&2; exit 2 ;;
esac
