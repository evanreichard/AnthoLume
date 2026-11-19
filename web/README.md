# AnthoLume web

Use Node 22.23.4. From `web/`:

```sh
npm ci
npm run build
npm test
npm run test:browser
```

The build writes `../assets/app/` for Go packaging. Generate API bindings from the repository root with `make generate`.

For hot reload, run Go with `LISTEN_PORT=5324`, `PUBLIC_ORIGIN=http://127.0.0.1:5323`, and `COOKIE_SECURE=false`. Then run from `web/`:

```sh
ANTHOLUME_BACKEND=http://127.0.0.1:5324 npm run dev
```

Open `http://127.0.0.1:5323`. Browser tests use the actual Go router on the same port; stop the dev server first. Set `CHROMIUM_PATH` if using a system Chromium.
