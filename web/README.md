# AnthoLume web

Use Node 22.23.4. From `web/`:

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run test:reader
```

The build writes `../assets/app/` for Go packaging. Generate API bindings from the repository root with `make generate`.

## Development server

From the repository root, after `npm --prefix web ci`:

```sh
make dev RESTORE=/path/to/backup.zip RESET_USER=evan
make dev
make dev RESET_USER=evan
make clean-dev
```

`RESTORE` accepts a compatible AnthoLume ZIP backup (including packaged books and covers) or a database-only SQLite backup. It uses the same format and schema checks as Administration → Restore; pre-migration backups may need upgrading first. It seeds `data/dev/` and never replaces existing state. Without `RESTORE`, an existing `data/dev/antholume.db` is required. `RESET_USER` is optional and sets only that dev account's password to `antholume`, invalidating its existing sessions. Stop the server with Ctrl-C before running `make clean-dev`; cleanup removes only `data/dev/`, not the source backup.

The launcher uses `flock` to guard dev state through setup and shutdown. Vite serves hot reload at `http://127.0.0.1:5323` and, when available, the printed Tailscale IPv4 URL. The normal `antholume serve` backend runs with `LISTEN_HOST=127.0.0.1` on port 5324. Override occupied ports with `DEV_PORT` and `DEV_GO_PORT`. Use this plain-HTTP setup only on a trusted tailnet. `make dev-tailnet` and `make clean-dev-tailnet` are aliases.

Browser tests share port 5323 by default; stop dev before running them. Set `CHROMIUM_PATH` if using a system Chromium.
