# M3 joint current-source integration check

**PASS: 34/34 actual-Go browser tests, 40/40 web units, clean typechecked production build.** One fresh full batch completed after controller/layout and recovery-frame corrections. Zero failures, skips, retries or flaky results. This supersedes the previous 30/34 result; previous evidence remains in the parent scratch directory.

## Source identity and execution

Snapshot: **2026-11-17 19:19:44.967 UTC**, 428 files. Source content was hash-checked before/after copying and against the copy. Final comparison found **zero root source drift** throughout qualification. Current root/API sources include the KOSync timestamp/alias/errors/header corrections; current reader source includes short-sample protocol hashing, latest-access startup, integer-size/native-relocation layout correction and buffer-release worker. These are compiled source inclusions, not a claim that this suite independently exercises every KOSync error/header/hash edge.

Evidence root: `_scratch/m3/joint-current/final/`.

- `source-manifest.json`: exact per-file original SHA-256 identities, including production Go/frontend, helper, config and test sources.
- Manifest SHA-256: **`e9e4911efdbb83584d43d894de2c7f4b70d391ee911be6b462b854c52cac8ff8`**; also recorded in `source-manifest.sha256`.
- `final-verification.json`: final source-drift check, browser totals, build identity, exact generated-asset and compiled-Go-binary hashes.
- `owner-test-changes.diff`: comparison of the three previously failing test files with the prior snapshot.
- `build.log`, `unit.log`, `browser.log`, `browser-results.json`, `harness-overrides.json`, and owned synthetic artifacts.

Copied harness overrides are limited to owned artifact paths, loopback **5483/5493/5494**, and the installed Vite executable lookup. No assertions, production source, dependencies or build configuration were edited. All generated application assets are inside the owned source snapshot; original frontend logs/output and preview ports **5173/5175** remain untouched. No private books/data were accessed.

Commands, each executed once from the snapshot's `web`:

1. `npm run build` — strict `tsc --noEmit` once, then clean Vite production build.
2. `npm test` — actual full web unit suite.
3. `node node_modules/@playwright/test/cli.js test --config playwright.config.ts --global-timeout=780000` — all 34 cases, one worker, no grep/filter/retry. Command-scoped cached Go **1.26.11**, `GOTOOLCHAIN=local`, and Nix Chromium **157**; an outer bounded timeout protects cleanup.

The existing fixture freshly compiles `./web/tests/server` with `go build -mod=readonly` from that snapshot, then uses the real production `api.NewAPI(...).Handler()`, isolated SQLite and real HTTP credentials. No old binary/assets or additional route fakes were used. Existing file-controlled faults remain after the real production handler. Browser run: **182.231 seconds**, exit **0**, **34 expected / 0 unexpected / 0 skipped / 0 flaky**. Units: **40 passed**, six files.

## Claims established by the complete run

| Boundary | Result |
| --- | --- |
| Original 23-case seam cohort | **23/23 pass**. |
| Entire current browser suite | **34/34 pass**. |
| Fresh real authenticated-cookie/new reader DB startup | Pass; selected account survives startup. |
| Real registration/bootstrap/routes/paging/inert content | Pass. |
| Logout/A→B→A, retained server original and account privacy | Pass. |
| Cold server-book restart/replay | Pass; physically stop Go, close Chromium, launch new persistent-profile process offline before startup, retain immutable IDs, reopen same server database, exact replay without duplicate effects. |
| R2 state-only 503 and malformed-200 | **Both pass fully**: actual KO CAS; two durable needs-refresh progress conflicts; independent 30-second activity credited once; no extra posts/effects through retry, real Go stop/start and page restart; later explicit refresh/shared choice resolves pending progress. |
| Existing KO conflict/backward/shared resolution | Pass, including stale-choice invalidation and independent activity. |
| Event 401/current lease/late two-tab takeover | All pass. |
| Metadata/binary malformed vs validated 401 | All four pass. |
| Malformed-200 and server-error-500 receipts | Both pass: retain exact pending events after actual handler commits, then exact valid retry with unchanged effects. |
| Reader turn/checkpoint/Folio Resume/density | Pass; previous page-number failure is resolved. |
| Recovery denial and real worker update | Pass: storage retained, actual applyUpdate recovery, unforced controls and pointer geometry. |
| Anonymous bootstrap 503 recovery | Pass across 320/390/landscape: actual ready XHTML/Lato frame, Appearance/Contents/footer, nonoverlap, unforced Done/Reconnect and bounded details. |
| Search clear/filter draft/Cancel/Escape/Back | Both pass, including focus, 44px control and no draft API calls. |
| Local/shared removal focus | All three pass, including cancel opener and surviving destination focus. |
| Local import and actual streamed-download cancellation | Both pass: no partial publication or staged residue, earlier source IDs/backing retained, original actually opens, no events. |
| Retirement intent/privacy and legacy worker/update recovery | All pass. |
| Complete production precache/root identity/HTTP errors | Pass: all **24 entries** match actual directory membership, HTTP SHA-256, MIME/cache headers and worker-code build fingerprint. |

Current storage assertions inspect source metadata and integrity manifests, `sourceId`, complete received/size bounds, actual local source Blob or download chunk backing and cursor-counted chunk totals. They do **not** require old `BookRow.bytes`, concatenate whole originals or insert a whole-Blob compatibility shim. Cancellation assertions retain backing/identity and actually reopen the saved original. The production range/staging implementation is compiled; this small-fixture suite does not independently qualify large-book range/memory bounds.

Precached workers:

- `source.worker-HJJVV5XD.js`
- `staging.worker-BzBuWZUM.js`
- `buffer-release.worker-D_EvnKt4.js`

Build identity: **`d5c71f5b725c8f639d6de1dccb456742418a16874b84cf0a0f716cdc34d1464a`**. Unchanged worker content legitimately retains its content hash; changed application/controller output and the complete-shell build identity are freshly generated. Runtime chunk warning remains **819.26 KB / 244.81 KB gzip**.

## Test dispositions and correction validity

Authority: unchanged real-reader navigation, durability, independent R2 delivery, authentication/privacy and actual pointer-operability requirements.

| Scope | Disposition | Evidence |
| --- | --- | --- |
| Both `conflict-outage.spec.ts` cases | **Preserve** | File unchanged from previous snapshot; all original outage/activity/restart/no-duplicate/explicit-resolution assertions now reached and pass. |
| `density.spec.ts` | **Preserve** | File unchanged; original Next→page 2/checkpoint/Resume/density assertions now pass. |
| `recovery.spec.ts` frame readiness setup | **Adapt, owner change already present** | Adds public ready check after viewport resize and reacquires the current reader iframe on each font poll. Requires ready state, blob URL, real XHTML document and actually loaded Lato; null/replaced frames return false rather than throw. Existing geometry, pointer hit-testing, unforced clicks, details/reconnect and retained-source assertions remain intact. |
| All other current cases | **Preserve** | All 34 execute without skips, forced actions added here, or assertion changes by the qualifier. |

No test/source repair or mutation audit was performed. The four prior failures are resolved in this current-source batch, not hidden by filtering or weakened legacy expectations.

## Scope and cleanup

Bounded real-Go production-frontend integration is green. No full reader browser, standalone SW, private corpus, root full suite, containers, broad KOSync matrix, physical-device, native-memory or large-book acceptance was run or inferred. Build has the existing large-chunk warning.

Post-run checks found no listeners on **5483/5493/5494** and no remaining process referencing this qualification run. No git, commit, root/sibling authored-file, dependency or build-configuration edits were made.

- Assumptions: installed locked frontend dependencies may be reused read-only; the hash-verified stable snapshot is the compilation boundary.
- Autonomous decisions: preserve the previous batch and capture this batch in `joint-current/final`; verify root stability and compiled artifact hashes after completion.
- Compromises: browser composition uses filesystem-served production assets, not executable embedding/container qualification; separate corpus/device/memory suites remain outside scope.

Knowledge capture recommendation remains: give frontend fixture/config environment-overridable scratch paths and ports, documented in `web/AGENTS.md`, to avoid copied helpers in future qualification. No such authored change was made.
