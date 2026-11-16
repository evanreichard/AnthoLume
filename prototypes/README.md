# M2 proofs

Three discardable evaluation modules, not production frontends/APIs. Root application, dependency and toolchain files remain unchanged. Remove or deliberately promote reviewed contracts; do not maintain permanent parallel frontends. [Evidence and remaining gates](../docs/evaluation/README.md#m2-checkpoint-and-remaining-gates).

## Run / test

From repository root, three command groups (initial registry/module access required):

```sh
# API: isolated Go 1.26.11 SDK; verify generation, HTTP/SQLite contracts and faults.
PATH="$PWD/_scratch/m2/api-contract/toolchains/go/bin:$PATH" GOTOOLCHAIN=local bash prototypes/api-contract/scripts/verify.sh

# Reader/storage: unit + real Chromium tests; provide CHROMIUM_PATH on NixOS.
npm --prefix prototypes/reader-storage ci && npm --prefix prototypes/reader-storage run typecheck && npm --prefix prototypes/reader-storage test && npm --prefix prototypes/reader-storage run test:browser

# Design: audit/build, then dist-only loopback preview (Ctrl-C to stop).
npm --prefix prototypes/design ci && npm --prefix prototypes/design run audit && npm --prefix prototypes/design run build && npm --prefix prototypes/design run preview
```

The design preview currently runs on **127.0.0.1:5173**; reuse it rather than starting another server. Compare [Folio](http://127.0.0.1:5173/?direction=folio&theme=light#/library) and [Index](http://127.0.0.1:5173/?direction=index&theme=light#/library). User validation and visual choice remain open. Static preview serves only built design `dist`, rejects repository/dotfile/traversal/escaping-symlink access, and has no Vite dev middleware. Keep it loopback-only; this is not public-hosting hardening.

## Dependencies and limits

- Node 22.23.4/npm 10.9.9 were verified; use each module's lockfile. Direct pins differ intentionally between independent proofs, not as a production stack decision. Browser setup, ports and additional test commands: [API](api-contract/README.md), [reader/storage](reader-storage/README.md), [design](design/README.md).
- API requires **Go 1.26.11+**. The reviewed SDK was isolated under scratch and checksum-verified; obtain/verify that SDK if absent, or use Go's supported toolchain selection. The command above fails closed with an older local SDK. Root/default Go remains unchanged. Nested patched Gin/x/net/x/crypto graph scans do not certify production's graph. Run `scripts/audit.sh` with the same scoped SDK; refresh audits before promotion.
- Reader uses EPUB.js 0.3.93 with an explicit xmldom override, conservative passive-content rejection and a pinned lifecycle seam. Zero advisory findings do not establish content security. Archive exhaustion, benign EPUB compatibility and real KO parity remain blockers.
- Reader typechecking references the API's generated schema, but its runtime transport is an in-memory fake, not Go HTTP. Loaded-shell offline open is not cold offline launch or service-worker retirement. Design is synthetic UI only, not an EPUB engine or durable store.
- Committed EPUB fixtures are synthetic/adversarial generators plus the existing public Alice hash vector. No private snapshots, credentials, logs, screenshots, scratch outputs, `node_modules` or build artifacts belong in commits.
