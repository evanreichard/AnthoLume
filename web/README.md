# AnthoLume web

Production compact Folio React/TypeScript frontend at `/app/`. Shared books use the production HTTP API; local books, EPUB reading, durable events and service-worker registration belong to `src/reading`. Unported workflows link to the original SSR site.

Node **22.23.4** is build/dev-only.

```sh
npm ci
npm run build
npm test
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Build emits `../assets/app/` for Go packaging, including the compiled root worker/manifest. Reader and generated schema must exist before building; no stub fallbacks. Backend alone generates `src/api/schema.gen.ts` from `../api/openapi.yaml` (binary schema generation also requires its Blob transform).

For development, run Go with `PUBLIC_ORIGIN=http://127.0.0.1:5323`, then:

```sh
ANTHOLUME_BACKEND=http://127.0.0.1:5324 npm run dev
```

Vite binds loopback port 5323 and preserves browser Origin when proxying API/SSR/root worker requests to Go. `VITE_API_ORIGIN`, if set, must equal the browser public origin; a cross-origin backend URL is not a CSRF workaround.

Browser tests build a **test-only composition of the actual Go router**, serve compiled assets on loopback 5323, register real synthetic credentials over HTTP, and create isolated DB/public EPUB fixtures under `_scratch/m3/frontend/`. No fixture endpoints ship. `GO_BINARY` selects the approved Go toolchain; the locally verified scratch SDK is used when present. Tests always terminate owned processes, including full browser-process offline restarts. Do not run dev/tests on the same port or overwrite preview 5173/5175.

Full qualification and current integration blockers: [`m3-frontend.md`](../docs/evaluation/m3-frontend.md). Loopback tests do not qualify physical HTTPS installed PWAs.
