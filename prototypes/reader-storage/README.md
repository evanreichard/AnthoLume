# M2 reader/storage proof

Standalone React/TypeScript/Vite contract harness for the selected **single-origin hardened EPUB.js reader**. EPUB.js is behind a disposable controller and KO path/CFI codec; Dexie owns original EPUB bytes, checkpoints, immutable events, and replay leases. Nothing connects to the production server. This is not a UI proposal or production PWA.

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

Stop with Ctrl-C. Open the synthetic, original representative (CSS/font/SVG), or real Alice EPUB; turn a page, follow an internal link, reflow, unmount, reopen its checkpoint, select TOC, or try an invalid saved position. The conflict panel demonstrates explicit local/server choice, including backward progress. `window.proof` exposes the bounded controller/repository/fakes for browser inspection; it is not an application API. Data uses the isolated `antholume-m2-reader-storage-v2` IndexedDB database. The incompatible initial proof v1 database is left untouched, not migrated; event payloads now use the API generated shape. To reset this proof only: `await window.proof.repository.db.delete()` then reload.

`npm run fixtures` deterministically regenerates own synthetic/adversarial EPUBs, copies `_test_files/alice.epub`, and copies the sibling isolation proof's original public benign package unchanged into this directory as `representative.epub`. The sibling is read-only; no isolation/integration/API/design files are changed. Included/copied fixtures suffice for tests, with no private archive. CSS Tree 3.2.1 supplies structural CSS parsing; no regex-URL sanitizer is used.

## Limits

- Element-level KO positions, not character/page-exact restoration. Reads preserve the production reader's child-axis XPath first, whole-path descendant fallback only on miss. The contradictory legacy descendant-index writer is not declared fixed: new writes that read back to a different element fail recoverably. Existing server IDs/positions are never rewritten as CFIs, new indices or full hashes.
- Trusted controller stays same-origin; chapters retain `allow-same-origin` **without scripts** across navigation. CSP is first before live parsing. Parsed CSS supports rgb/media/packaged font-face, inline/packaged SVG and archive-only assets; internal chapter/fragment links are controller-routed. Active/external/escaping references and role aliases reject. Original bytes and body tree/IDs remain unchanged; owned blob attributes are render-time replacements, not sanitization. XHTML style end-tag text rejects even in CSS comments/strings and after generation; an inert whole-document head/body check prevents head text from manufacturing body markup. AST generation alone is not an HTML safety boundary. TOC targets use the selected NAV/NCX document base while original hrefs remain unchanged.
- This is a defined subset, not all EPUBs: forms/audio/video, SVG foreignObject/animation, CSS import/var/local-font/image-set indirection, book-authored data/blob URLs, unsupported roles and HTML-repaired body trees still reject. The user accepted trusted-engine app-origin risk; no origin-exclusion claim or scripted-content fallback is made. Preallocation/CRC/duplicates/bomb hardening remains an M3 gate.
- Replay uses generated API event/receipt types, string revisions starting at `"0"`, shared CAS/receipt fake, exact receipt validation and epoch-fenced session effects. Stale progress is tested through durable outbox replay and stays blocked. Fakes remain **in-memory**, not current production server semantics; actual HTTP integration and durable conflict resolution remain pending. No production activity is sent; the existing measurement formula has isolated regression tests, not a new statistics policy.
- No service worker, installed/offline app-shell launch, full-process restart, physical iOS/Android, real KOReader, quota/eviction qualification, or production security approval. Reopening stored EPUB bytes with an expired session/offline is tested after the shell has loaded.
- EPUB.js still emits CFI range diagnostics and iframe ResizeObserver-loop notifications in Chromium. Tests do not suppress these; production suitability remains conditional.

Final-review regressions include the unchanged supplied raw-text/NAV EPUB copies in `public/fixtures/closure-review-*.epub`, mixed-case/delimiter/string variants, relocated NCX, and the benign SVG-style control. Tests/regeneration use included synthetic copies, not reviewer scratch. Current validation: 20 unit and 38 Chromium browser tests; focused closure logs are under `_scratch/m2/reader-storage/closure-*`.

See [the evidence report](../../docs/evaluation/m2-reader-storage.md) for architecture, exact assertions, mutations, dependencies, and remaining gates.
