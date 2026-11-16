# M2 proofs

Five discardable evaluation modules, not permanent parallel frontends/APIs. Root application, dependencies and toolchain remain unchanged. [Checkpoint and remaining gates](../docs/evaluation/README.md#m2-checkpoint-and-remaining-gates): technical proof scope accepted; selected **Folio** still needs the full human interaction walkthrough and M2 exit approval. No phone/PWA or production acceptance is implied.

| Module | Scope / declared evidence | Instructions |
| --- | --- | --- |
| Design | Synthetic Folio/Index UI; Folio selected. 53 browser tests, 84 layout checks, 2 static-preview tests; no EPUB/durable state | [Run/review](design/README.md) |
| API contract | Six schema-first operations, generated Go/TS, fixture HTTP/SQLite receipts/CAS, validation/drift and 12 fault checks | [Verify/audit](api-contract/README.md) |
| Reader/storage | Selected single-origin hardened EPUB.js; representative CSS/fonts/SVG/internal navigation, source-body preservation, lifecycle/codec/storage. Owner 20 unit/38 browser; independent 20 unit/11 targeted closure | [Run/test](reader-storage/README.md) |
| Integration | Actual browser↔Go HTTP using imported Repository/SyncCoordinator and generated bindings; 10 browser tests, race-enabled fixture server, dependency-isolated replay | [Verify/audit](integration/README.md) |
| Reader isolation | Retained falsification of opaque-outer/passive-inner topology: 3 unit, 13 development and 13 production browser tests. Green tests prove failure, not working reader acceptance | [Reproduce](reader-isolation/README.md) |

The failed opaque prototype is not a competing production design or unfinished required stronger boundary. The user explicitly selected **single-origin hardened EPUB.js**, no extra hostname, accepting trusted-renderer bug blast radius at the app origin. No scripted-book fallback is allowed. Wider EPUB/KO/platform compatibility, archive exhaustion and production integration remain later gates.

## Commands

From repository root; initial registry access and Node 22.23.4/npm 10.9.9 were used. Set `CHROMIUM_PATH` to an existing Chromium executable on NixOS (per-module instructions give browser setup). API/integration verification used a checksum-verified **isolated Go 1.26.11 SDK**; obtain/verify it if absent, then scope its PATH rather than changing the root toolchain:

```sh
PATH="$PWD/_scratch/m2/api-contract/toolchains/go/bin:$PATH" GOTOOLCHAIN=local bash prototypes/api-contract/scripts/verify.sh
npm --prefix prototypes/reader-storage ci && npm --prefix prototypes/reader-storage run typecheck && npm --prefix prototypes/reader-storage test && npm --prefix prototypes/reader-storage run test:browser
PATH="$PWD/_scratch/m2/api-contract/toolchains/go/bin:$PATH" GOTOOLCHAIN=local bash prototypes/integration/scripts/verify.sh
npm --prefix prototypes/reader-isolation ci && npm --prefix prototypes/reader-isolation run typecheck && npm --prefix prototypes/reader-isolation test && npm --prefix prototypes/reader-isolation run test:browser
# Only when the existing preview is absent:
npm --prefix prototypes/design ci && npm --prefix prototypes/design run audit && npm --prefix prototypes/design run build && npm --prefix prototypes/design run preview
```

## Safe preview and dependency boundaries

Reuse the running **127.0.0.1:5173** static [Folio preview](http://127.0.0.1:5173/?direction=folio&theme=light#/library); do not stop it or start another server over it. It serves built design `dist` only, without Vite dev middleware, repository fallback or directory listings; dotfiles/traversal/escaping symlinks reject. Keep it loopback-only; this is not public-hosting hardening. Other tests own separate temporary listeners and do not reuse 5173.

Each module owns its lockfile; differing exact pins are evaluation evidence, not a selected production graph. Go 1.26.11 and patched Gin/x/net/x/crypto remain nested/scoped; scans do not certify unchanged root Go/dependencies. Reader uses EPUB.js 0.3.93 with xmldom override, parsed CSS policy and a pinned lifecycle seam; zero advisories are not a security audit. Refresh audits and qualify root adoption before production.

The reader page retains an in-memory transport fake; integration separately proves fixture HTTP composition, not production login/KO/migrations or durable conflict history. Loaded-shell offline open is not cold offline restart. The [worker-retirement contract](../docs/evaluation/service-worker-contract.md) is defined, not runtime-tested; implementation/full restart/device qualification remain M3–M5 work.

Fixtures are public synthetic/adversarial packages, public font assets and the existing Alice hash vector. Commit intended fixtures/source only, never private snapshots, credentials, logs, screenshots, scratch outputs, `node_modules`, `dist` or temporary databases. Remove proofs or deliberately promote reviewed contracts into the sole production frontend.
