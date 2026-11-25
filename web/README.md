# AnthoLume web

Use Node 22.23.4. From `web/`:

```sh
npm ci
npm run lint
npm run format:check
npm run build
npm test
npm run test:browser
npm run test:reader
```

Use `npm run format` to apply Prettier to handwritten frontend files. Oxlint checks correctness, the Rules of Hooks, effect dependencies, and synchronous state updates in effects. Exceptions for browser-owned resources are documented at the affected line. Generated API bindings and generated reader fixtures are checked by their generators instead.

The build writes `../assets/app/` for Go packaging. Generate API bindings from the repository root with `make generate`.

## Development server

From the repository root, after `npm --prefix web ci`:

```sh
make dev                            # Build the app; offline features work on localhost
make dev-hot                        # Vite hot reload, no offline service worker
make dev SEED=0                     # Start empty if no dev library exists
make dev RESTORE=/path/to/backup.zip # Start from a backup instead of demo data
make clean-dev                      # Delete only the local dev library
```

The [shared demo loader](demo-data/seed.mjs) populates fresh dev libraries and screenshot runs. A fresh dev library includes six shared books and two readers with separate page-turn histories and resume positions. Sign in as `robin` or `sam` with password `antholume`. The first seeded run needs `curl` and network access unless the EPUBs are already cached. Existing libraries are reused without seeding; `SEED=0` does not remove demo data. If a crash interrupts seeding, the launcher refuses to serve the partial library. Inspect `data/dev/`, then run `make clean-dev` and `make dev` to start over.

`RESTORE` accepts a compatible AnthoLume ZIP backup (including packaged books and covers) or a database-only SQLite backup. It uses the same checks as Administration → Restore and requires a fresh `data/dev/`. `RESET_USER` optionally sets a dev account's password to `antholume`, invalidating its sessions. Stop the server with Ctrl-C before `make clean-dev`; cleanup removes only `data/dev/`, not the source backup.

Open [http://localhost:5323/login](http://localhost:5323/login) for the built app and service worker. To test a cold offline start, save a book, close the tab, go offline, and open `http://localhost:5323/` in the same browser profile. Restart `make dev` to rebuild; close all app tabs if the old service worker is still active. For hot reload, stop it and run `make dev-hot` at [http://localhost:5325/login](http://localhost:5325/login). The modes share the dev library (guarded by `flock`) but use separate browser origins; keep their `DEV_PORT` values distinct.

Both modes also listen on `127.0.0.1` and on the tailnet IPv4 address when available. Use plain HTTP on a trusted tailnet only; offline startup requires loopback HTTP or HTTPS. The internal Go backend stays on `127.0.0.1:5324`; use the frontend URL to sign in. Override occupied ports with `DEV_PORT` and `DEV_GO_PORT`.

Browser tests share port 5323 by default; stop dev before running them. Set `CHROMIUM_PATH` for a system Chromium or `GO_BINARY` to override `go` on `PATH`. Fixture binaries and databases use the OS temporary directory and are removed at teardown.

From the repository root, browser reports, logs, and screenshots are under `build/test-results/{app,reader}/`. The generated 300 MB EPUB and its reference hashes are cached in `build/test-cache/reader/`; delete that directory to regenerate them on the next reader test run.

## Brand assets

The app mark is `assets/icons/mark.svg`; `banner.svg` pairs the same mark with the wordmark. From the repository root, run `tools/render-brand.sh` with librsvg (`rsvg-convert`), ImageMagick 7, and Liberation Serif installed to rebuild the README banner, favicon, and home-screen icons. The maskable icon has extra padding for launcher crops.

## README screenshots

From the repository root, run `make screenshots` with Go, Node/npm, and curl installed. It builds the app and uses Playwright Chromium; set `CHROMIUM_PATH` to use a system Chromium instead. If Linux browser dependencies are missing, run `web/node_modules/.bin/playwright install --with-deps --only-shell chromium`.

The command starts a private server on a free loopback port with temporary SQLite and library directories. It uses the same [Project Gutenberg](https://www.gutenberg.org/) books, covers, and reading fixtures as `make dev`, and writes seven PNGs to `screenshots/mobile/` after all views pass their readiness checks. It never needs a running instance or access to your library.

The gallery uses a 390 × 844 viewport at 2×, light mode, and UTC. Each run seeds the past month relative to capture time, with a 30–60 second activity record per page turn and a saved position after each session. The README shows the populated Library, Insights overview, book details with synopsis, and resumed reader. The capture also saves the cover grid before reading history is added, the activity log, and saved progress.

[books.mjs](demo-data/books.mjs) lists the Gutenberg IDs and SHA-256 pins. Downloads are cached under `build/screenshot-books/` and verified on every run. If Gutenberg rebuilds an EPUB, review its text, cover, and [reading positions](demo-data/history.mjs) before updating its pin. Keep the cache for repeat captures without contacting Gutenberg.
