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
make dev                            # Start with demo data on first run
make dev SEED=0                     # Start empty if no dev library exists
make dev RESTORE=/path/to/backup.zip # Start from a backup instead of demo data
make clean-dev                      # Delete only the local dev library
```

A fresh dev library includes six books, recent sample reading activity and a resume point. Sign in as `robin` with password `antholume`. The first seeded run needs `curl` and network access unless the EPUBs are already cached. Existing libraries are reused without seeding; `SEED=0` does not remove demo data. If a crash interrupts seeding, the launcher refuses to serve the partial library. Inspect `data/dev/`, then run `make clean-dev` and `make dev` to start over.

`RESTORE` accepts a compatible AnthoLume ZIP backup (including packaged books and covers) or a database-only SQLite backup. It uses the same checks as Administration → Restore and requires a fresh `data/dev/`. `RESET_USER` optionally sets a dev account's password to `antholume`, invalidating its sessions. Stop the server with Ctrl-C before `make clean-dev`; cleanup removes only `data/dev/`, not the source backup.

The launcher uses `flock` to guard dev state. Vite serves hot reload at `http://127.0.0.1:5323` and automatically listens on the tailnet IPv4 address when available. Registration is open on both addresses, so use this plain-HTTP setup only on a trusted tailnet. The Go backend stays on `127.0.0.1:5324`. Override occupied ports with `DEV_PORT` and `DEV_GO_PORT`.

Browser tests share port 5323 by default; stop dev before running them. Set `CHROMIUM_PATH` for a system Chromium or `GO_BINARY` to override `go` on `PATH`. Fixture binaries and databases use the OS temporary directory and are removed at teardown.

From the repository root, browser reports, logs, and screenshots are under `build/test-results/{app,reader}/`. The generated 300 MB EPUB and its reference hashes are cached in `build/test-cache/reader/`; delete that directory to regenerate them on the next reader test run.

## Brand assets

The app mark is `assets/icons/mark.svg`; `banner.svg` pairs the same mark with the wordmark. From the repository root, run `tools/render-brand.sh` with librsvg (`rsvg-convert`), ImageMagick 7, and Liberation Serif installed to rebuild the README banner, favicon, and home-screen icons. The maskable icon has extra padding for launcher crops.

## README screenshots

From the repository root, run `make screenshots` with Go, Node/npm, and curl installed. It builds the app and uses Playwright Chromium; set `CHROMIUM_PATH` to use a system Chromium instead. If Linux browser dependencies are missing, run `web/node_modules/.bin/playwright install --with-deps --only-shell chromium`.

The command starts a private server on a free loopback port with temporary SQLite and library directories. It uses the same [Project Gutenberg](https://www.gutenberg.org/) books, covers, and reading fixtures as `make dev`, and writes four PNGs to `screenshots/mobile/` after all views pass their readiness checks. It never needs a running instance or access to your library.

The gallery uses a 390 × 844 viewport at 2×, light mode, UTC, and a fixed March 2025 reading journal. The home view is the Library with **Continue reading**; the cover grid is the Library before activity. The Insights image uses the historical Activity tab rather than the rolling 30-day overview.

[books.mjs](screenshots/books.mjs) lists the Gutenberg IDs and SHA-256 pins. Downloads are cached under `build/screenshot-books/` and verified on every run. If Gutenberg rebuilds an EPUB, review its text, cover, and (for Alice) the chapter anchor before updating its pin. Keep the cache for repeat captures without contacting Gutenberg.
