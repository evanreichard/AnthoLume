# M2 reader/storage proof

Standalone React/TypeScript/Vite contract harness. EPUB.js is behind a disposable controller and KO path/CFI codec; Dexie owns original EPUB bytes, checkpoints, immutable events, and replay leases. Nothing connects to the production server. This is not a UI proposal or production PWA.

## Run

Node 22.12+ required (tested 22.23.4). Typechecking reads `../api-contract/client/schema.gen.ts` from the same checkout; no API runtime/dependency installation is needed or modified. From this directory:

```sh
npm ci
npm run typecheck
npm test
npm run build
CHROMIUM_PATH=/absolute/path/to/chromium npm run test:browser
```

Playwright starts/stops Vite on **127.0.0.1:5314**, refuses an occupied port, and writes results/traces under `_scratch/m2/reader-storage/`. `CHROMIUM_PATH` selects an existing Chromium; otherwise provision Playwright's matching browser. On NixOS, prefer provisioning Chromium with `nix run nixpkgs#chromium -- --version`, then set `CHROMIUM_PATH="$(nix eval --raw nixpkgs#chromium.outPath)/bin/chromium"`. The tested system Chromium was 157.0.8103.38. Do not leave a separate test server running.

For **manual** inspection only:

```sh
npm run dev       # http://127.0.0.1:5174; development StrictMode replay
# or, after npm run build:
npm run preview   # http://127.0.0.1:5174; production build, no dev effect replay
```

Stop with Ctrl-C. Open the synthetic EPUB, turn a page, reflow, unmount, reopen its checkpoint, select TOC Two, or try an invalid saved position. The conflict panel demonstrates explicit local/server choice, including backward progress. `window.proof` exposes the bounded controller/repository/fakes for browser inspection; it is not an application API. Data uses the isolated `antholume-m2-reader-storage-v2` IndexedDB database. The incompatible initial proof v1 database is left untouched, not migrated; event payloads now use the API generated shape. To reset this proof only: `await window.proof.repository.db.delete()` then reload.

`npm run fixtures` deterministically regenerates synthetic/adversarial EPUBs and copies `_test_files/alice.epub` into `public/fixtures/`. Included/copied fixtures are sufficient to run the tests; no private data is used. Alice is the unchanged server hash vector, while the small two-chapter synthetic book is the rendering fixture.

## Limits

- Element-level KO positions, not character/page-exact restoration. Reads preserve the production reader's child-axis XPath first, whole-path descendant fallback only on miss. The contradictory legacy descendant-index writer is not declared fixed: new writes that read back to a different element fail recoverably. Existing server IDs/positions are never rewritten as CFIs, new indices or full hashes.
- Conservative lowercase passive-XHTML subset: reject active/outbound content instead of rewriting element structure. Container/OPF/manifest/spine must resolve to validated XHTML. CSS roles require manifested `.css` targets with consistent media type; functions, at-rules, escapes, aliases and unmanifested stylesheets reject. Even benign EPUB features are deliberately excluded. No `allowScriptedContent` fallback. Same-origin sandbox is weaker than separate-origin isolation; archive resource exhaustion is not solved.
- Replay uses generated API event/receipt types, string revisions starting at `"0"`, shared CAS/receipt fake, exact receipt validation and epoch-fenced session effects. Stale progress is tested through durable outbox replay and stays blocked. Fakes remain **in-memory**, not current production server semantics; actual HTTP integration and durable conflict resolution remain pending. No production activity is sent; the existing measurement formula has isolated regression tests, not a new statistics policy.
- No service worker, installed/offline app-shell launch, full-process restart, physical iOS/Android, real KOReader, quota/eviction qualification, or production security approval. Reopening stored EPUB bytes with an expired session/offline is tested after the shell has loaded.
- EPUB.js still emits CFI range diagnostics and iframe ResizeObserver-loop notifications in Chromium. Tests do not suppress these; production suitability remains conditional.

See [the evidence report](../../docs/evaluation/m2-reader-storage.md) for architecture, exact assertions, mutations, dependencies, and remaining gates.
