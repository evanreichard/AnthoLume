#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
systemctl --user is-active antholume.service antholume-tunnel.service
pid=$(systemctl --user show antholume.service -p MainPID --value)
origin=$(tr '\0' '\n' <"/proc/$pid/environ" | sed -n 's/^PUBLIC_ORIGIN=//p')
[[ $origin == https://* ]] || { echo 'Expected an HTTPS PUBLIC_ORIGIN on the running app.' >&2; exit 1; }
origin=${origin%/}
printf 'Preview: %s\nCheckout: %s\nRunning backend:\n' "$origin" "$(git rev-parse --short HEAD)"
go version -m "/proc/$pid/exe" | awk '/vcs\.(modified|revision)=/ {print $2; found=1} END {if (!found) print "revision unavailable"}'
entry() { grep -oE 'src="/assets/app/assets/[a-zA-Z0-9._-]+\.js"' | cut -d'"' -f2; }
local_entry=$(entry <assets/app/index.html)
served_entry=$(curl -fsS --max-time 10 "$origin/library/matcher" | entry)
[[ -n $local_entry && $served_entry == "$local_entry" ]] || { echo 'Preview and checkout have different frontend entry points.' >&2; exit 1; }
served_hash=$(curl -fsS --max-time 15 "$origin$served_entry" | sha256sum | cut -d' ' -f1)
local_hash=$(sha256sum ".$local_entry" | cut -d' ' -f1)
[[ $served_hash == "$local_hash" ]] || { echo 'Preview and checkout have different bundle contents.' >&2; exit 1; }
printf 'Verified frontend: %s (%s)\n' "$served_entry" "$served_hash"
