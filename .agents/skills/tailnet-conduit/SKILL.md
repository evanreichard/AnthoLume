---
name: tailnet-conduit
description: Run, update, or verify AnthoLume's private tailnet preview through Conduit. Use when asked whether the preview is live or whether it serves the current checkout.
---

# AnthoLume over Conduit

Conduit terminates HTTPS at the tailnet origin and forwards to AnthoLume on `http://127.0.0.1:8585`. Keep the app bound to loopback. `PUBLIC_ORIGIN` is the **external HTTPS origin**, not the tunnel target: browsers and OAuth callbacks use it.

## Existing preview (usual path)

Run from the checkout on the service host. For “is it up?”, **verify without restarting**:

```sh
bash .agents/skills/tailnet-conduit/verify.sh
```

The check reports user-unit status, fetches the matcher shell through the tunnel, compares its entry bundle to this checkout's built assets, and prints the running Go binary's revision separately. Matching assets do not prove the backend is current (or that unbuilt source changes are live).

- **Start:** `systemctl --user start antholume.service antholume-tunnel.service`. Use `enable --now` instead when persistence across user-manager starts is wanted.
- **Frontend change:** Verify `readlink -f "$HOME/.local/share/antholume/assets"` points at this checkout's `assets/`. Run `make build_web`, then verify. The default `develop` binary serves assets from its working directory; it needs no restart for asset-only changes. A release binary embeds assets and needs rebuilding.
- **Backend change:** From the repo root, with the frontend already built, run `go build -o "$HOME/.local/share/antholume/bin/antholume.next" . && mv -T "$HOME/.local/share/antholume/bin/antholume.next" "$HOME/.local/share/antholume/bin/antholume" && systemctl --user restart antholume.service`. Verify again. Keep the installed launcher, database, cookie key, and provider configuration intact.
- **Diagnose:** If `curl -fsS --max-time 5 http://127.0.0.1:8585/library/matcher -o /dev/null` fails, inspect `journalctl --user -u antholume.service -n 40`. If loopback works but HTTPS fails, check tailnet connectivity, the Conduit client profile, and `journalctl --user -u antholume-tunnel.service -n 40`. Redact secrets before sharing diagnostics.
- **Stop:** `systemctl --user stop antholume-tunnel.service antholume.service`. This preserves preview data.

## First-time setup on another host

1. Obtain a private HTTPS tunnel origin and an authenticated Conduit client profile from the tailnet operator. Use the profile for the **tunnel client**, not `conduit serve` (the relay). Keep credentials outside the repository.
2. Build the UI (`make build_web`) and Go binary (`go build -o "$HOME/.local/share/antholume/bin/antholume" .` after creating the `bin` directory). Use `$HOME/.local/share/antholume` as the working directory; link its `assets` to this checkout's absolute `assets/` path.
3. For a **new** preview, build `./tools/dev` into the preview's `bin/` directory and run the resulting executable with `prepare` **from the preview working directory** with `RESTORE` and `RESET_USER` unset. This creates private `data/dev` state and a persistent `cookie-auth.key`. On an existing installation reuse the configured data paths and key; do not run `clean`, seed, or restore as part of deployment.
4. Configure the `antholume.service` user unit with that working directory, `CONFIG_PATH` and `DATA_PATH` pointing at its absolute `data/dev`, `LISTEN_HOST=127.0.0.1`, `LISTEN_PORT=8585`, and `PUBLIC_ORIGIN` set to the assigned origin. Its private launcher exports `COOKIE_AUTH_KEY` from the key file, loads any configured provider secrets, then execs the absolute binary path with `serve`. Keep secret values out of command lines, Git, and logs.
5. Set `antholume-tunnel.service` to run after the app, with `ExecStart` using the absolute path from `command -v conduit` followed by `tunnel --name antholume --target http://127.0.0.1:8585` (use the assigned tunnel name if different). Run `systemctl --user daemon-reload`, start both units, then verify. Check reachability from a tailnet client; an active process alone is not an end-to-end check.
