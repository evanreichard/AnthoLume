# M2 — Actual browser/Go HTTP integration

**Ten actual Chromium tests pass against the SQLite-backed Go proof using the existing reader Repository, SyncCoordinator and generated API bindings.** This closes the bounded socket-composition gap, not production migration, SW/PWA qualification or real KO protocol compatibility. Implementation: [`prototypes/integration`](../../prototypes/integration/README.md).

Authority: approved M1/proposed architecture, M2 contract proofs and the subsequent bounded integration authorization. Read the latest reader `storage.ts`, `sync.ts`, `wire.ts` and [report](m2-reader-storage.md). No reader/design implementation, production/root dependency/toolchain/flake, private data or git state was modified; no commits were made.

## Target boundaries and ownership

| Boundary | Actual composition / owner |
| --- | --- |
| Browser durability | **Imported, not copied** `reader-storage/src/storage.ts`: Dexie Repository owns book bytes/checkpoints/events/access/leases in isolated `antholume-m2-http-integration-v1` namespace. Import now traverses the latest content/archive/chapter/CSS/body-policy closure, including CSS Tree parsing and inert body-tree stability validation |
| Replay/acknowledgement | **Imported** `SyncCoordinator` and `wire.receiptFor`: frozen lease snapshot, HTTP status handling, exact ID/kind/fields/activity-null/progress-base+1 checks and transactional deletion |
| HTTP client | Integration `HTTPTransport` uses `openapi-fetch<paths>` from the actual generated API schema for individual progress/activity calls; existing API `proofClient` performs list/download/CSRF probe. Receipt JSON remains untrusted at runtime |
| Server adapter | Actual API generated strict Gin/request validator/session/CSRF/limits/DTO mapping; minimal `NewRouterWithOrigin` takes one trusted configured origin and preserves the original default constructor |
| Server state | Actual API `Store`, existing root SQLC through local module replacements, and file-backed SQLite fixture receipts/CAS. Same `alice/book-a/a-device/a-second` identities as prior proofs |
| Test composition | One test-owned Go process serves compiled Vite assets and API on its actual `http://127.0.0.1:<ephemeral>` origin; no dev proxy or fixed preview listener |
| Fault/control boundary | Separate `/__fixture` routes require an unguessable per-process key; mutations also require the exact configured Origin. Bootstrap signs a real fixture cookie and returns its bound CSRF token. Reopen/KO/loss/corruption are explicitly disposable test controls |

The dependency direction remains browser storage/sync → typed HTTP adapter → application/SQLite operations. No production API handler calls another handler. Vite preserves source symlinks and deduplicates CSS Tree/Dexie/JSZip/openapi-fetch from the integration lockfile; a build guard rejects resolved dependency files outside integration's own `node_modules`. Actual sibling source is imported, never copied or edited. Type-only generated schema imports are not a replacement receipt schema.

**Ideal:** promote reviewed operations through production authentication, migrations, a public storage conflict-resolution operation and full browser/deployment qualification. **Pragmatic:** preserve this small executable harness as evidence for the same boundaries; it is neither a parallel application nor general test infrastructure.

### Minimal API delta

`NewRouter` still defaults to `https://proof.invalid`, preserving every original test. New `NewRouterWithOrigin` rejects wildcard/null/non-HTTP(S)/credential/path/query/fragment configurations and compares unsafe requests against exactly one configured origin. Integration supplies the actual listener origin; it never reflects or rewrites an incoming Origin. `TestConfiguredOrigin` asserts invalid configurations and missing/wrong/default/actual request origins with schema-validated responses and no rejected-write receipts.

## Reproduction and resolved environment

```sh
CHROMIUM_PATH=/path/to/chromium bash prototypes/integration/scripts/verify.sh
CHROMIUM_PATH=/path/to/chromium python3 prototypes/integration/scripts/verify-hermetic.py
bash prototypes/integration/scripts/audit.sh
```

The executed commands used command-scoped PATH to `_scratch/m2/api-contract/toolchains/go/bin` and `GOTOOLCHAIN=local`: **Go 1.26.11 linux/amd64**. Root/default Nix Go remains untouched. Node **22.23.4**, npm **10.9.9**, headless desktop **Chromium 157.0.8103.38**, Playwright **1.65.1**, TypeScript **5.9.3**, Vite **8.3.8**, Dexie **4.4.7**, JSZip **3.10.1**, openapi-fetch **0.17.0**, and now **CSS Tree 3.2.1** / **@types/css-tree 3.2.0**. Its locked transitive runtime packages resolve to **mdn-data 2.27.1** and **source-map-js 1.2.2**. Python **3.13.18** runs the dependency-isolated checkout verification. Go retains Gin **1.12.0**, sessions **1.0.4**, kin-openapi **0.152.0**, oapi runtime **1.8.0**/middleware **1.2.1**, modernc SQLite **1.38.2**, x/net **0.62.0**, x/crypto **0.59.0**. Nested module/lockfiles only; full resolved graph is in scratch.

`verify.sh` installs the locked package graph with scripts disabled, typechecks, builds the production bundle, compiles/vets Go, builds the fixture server **with the race detector**, and runs Chromium against it. Server teardown asserts a clean exit, so a Go race-detector exit fails the fixture. The integration Go package has no separate unit tests; its server behavior is exercised by these browser tests. The refreshed import closure builds **146 modules**, with approximately **429 kB JS / 127 kB gzip** (formerly 220/69 kB before the parsed CSS policy). This is not a performance budget result. `dist/dependency-closure.json` records 132 resolved dependency-module IDs, all below the integration dependency root; these are module files, not 132 npm packages.

The test worker allocates `127.0.0.1:0`, receives origin/key over a private child-process handshake, resets synthetic rows per test and terminates/waits for the server. No existing 5173/5313/5314 listener is reused or touched. Server temporary directories are removed on normal teardown. Logs, traces, database parent, source contract hashes, build output and audit JSON stay under `_scratch/m2/integration/`.

Public reader fixture: 3,741 bytes, SHA-256 `c0c7818088412d6a57ad17c8552a8ae7d943466253e6dd58133532b080196df6`. Browser download and reopened stored Blob hashes are compared with the source-file hash calculated in Node, not merely a server claim. This synthetic book uses the existing server fixture ID `book-a`, not an invented production identity migration.

### Latest-source dependency closure check

The refreshed source closure is Repository → `content-policy` → `archive-path`, `chapter-policy`/`css-policy`, and `body-contract`, plus the unchanged sync/wire owners. The latest inert body-tree check runs during every synthetic book import in these HTTP tests. The controller/EPUB.js and their React/engine dependencies are **not** imported by this harness; their benign rendering evidence remains the reader owner's separate suite.

The integration lock now owns the newly required CSS parser and declarations rather than discovering them in the installed reader checkout. `verify-hermetic.py` copies only integration-owned frontend files into assigned scratch, symlinks actual reader `src`/`public` and API `client` directories, and deliberately leaves both sibling `node_modules` directories absent. It performs fresh `npm ci`, typecheck, build and the same ten HTTP tests against a race-instrumented server. Preserved symlink identities plus Vite dedupe/TypeScript paths resolve dependencies from that scratch integration install; the build guard rejects any dependency-module path outside it. Hiding only its CSS parser makes build fail with unresolved `css-tree`, not fall back to the real sibling install; restoration builds successfully. Evidence: `hermetic-missing-css.log` and `hermetic-summary.json`.

This is **frontend package-resolution isolation**, not an OS sandbox, an offline install or a hermetic Go toolchain. The Go fixture compiles the actual owned module and read-only local replacements; the sibling source links still point at the checkout. No sibling source, fixture or dependency directory is renamed/removed/installed into. Tested lock SHA-256: `4391f7fc33ce76062dd10412922fb52c2be706f7fc3b793cb7bec373b9f0bc70`. The complete imported-source/API/fixture hash manifest is `source-contract-hashes.txt` (SHA-256 `db6e13612a11aadadd9cdce1df912c7562ecd47002bdd780fa7419508e2c6845`); `hermetic-summary.json` also records individual reader/fixture hashes. The original synthetic fixture bytes/hash above are unchanged; no fixture regeneration was needed.

### Final localized-reader smoke

After the reader owner's raw-style/NAV/NCX fixes, the **unchanged** dependency-isolated recipe passed fresh locked install, strict typecheck, production build and **10/10 actual Chromium HTTP tests** against the final linked sources and race-instrumented Go server. The existing missing-parser negative check still fails as intended, followed by a successful restored build. Evidence: `_scratch/m2/integration/verification-final-reader-smoke.log`, `hermetic-summary.json`, and `hermetic-checkout/_scratch/m2/integration/browser-results.json`. This compiles the final policy/body code and exercises the existing synthetic import/HTTP contracts; it does not add independent raw-style, NAV, NCX or renderer feature qualification.

Final changed imported-file SHA-256 values:

| Reader source | SHA-256 |
| --- | --- |
| `content-policy.ts` | `b65acb851dfc3ade0fb13b5a9c86e95e9cb94362c5f78c5a09e98fb5bdcb1d41` |
| `chapter-policy.ts` | `e88805f27f6631228c116b729986ba7b97af95274026dd0af28ab7c529157496` |
| `body-contract.ts` | `4647c4c7e8c3fa78d320b502a0d9dab2911d6c845f8cc81b1fea6bb5021c3fa3` |

Other imported reader/API hashes, fixture hash and lock SHA remain as recorded in the final manifests above. No integration application/configuration/dependency or API implementation change was needed. Audits and broader API/root regressions were not repeated for this smoke; unchanged-lock/source evidence below is cited from their prior runs. Test-managed fixture processes exited cleanly; no integration listener remained, and parent preview 5173 was left untouched.

## Executed named contracts

All cases are in `tests/http.spec.ts`; no Playwright network routing/mock fetch is used.

| Named browser test | Boundary assertion |
| --- | --- |
| `same-origin signed cookie, nullable generated list, exact EPUB bytes and real CSRF denial` | Anonymous list gives problem+JSON 401; bootstrap sets signed HttpOnly/SameSite Strict cookie; generated list returns intentional nullable metadata; download media/disposition/full hash match public source; wrong CSRF gives actual 403 with zero receipts. Server sees the browser's actual configured Origin, cookie and CSRF header. Unkeyed bootstrap is denied |
| `durable browser append/reload then real progress and activity receipts remove only their IDs` | Repository transaction appends full generated events, page reload retains IDs/checkpoint, same-account bootstrap restores replay. Actual POSTs return original receipt shapes; imported coordinator/repository remove exact acknowledged IDs. SQLite shows head `1`, one 30-second activity and both correct durable receipts |
| `actual expired cookie 401 retains events and pauses replay; same-account restore resumes` | Fixture expires the actual browser cookie through Set-Cookie, not a fake delivery status. Next HTTP activity returns 401; coordinator retains event and marks access unauthenticated but visible. Another replay makes no API call. Stored bytes remain readable. Same-account signed bootstrap resumes and credits once |
| `lost HTTP response after partial-batch commit, SQLite reopen and browser reload retry once` | Progress commits first; activity then commits but its HTTP response is lost. Both IDs remain because the batch lacks complete receipts. Browser observes a real failed request; SQLite already has two receipts/head `1`/one activity. Close/reopen that SQLite database and reload page, then retry through generated HTTP client; receipts are identical, IDs retire, head/activity/seconds do not increment |
| `KO-style operation advances actual head; real CAS conflict retains outbox until explicit new backward choice` | Test-only KO operation writes `a-second` fraction `.8`/unchanged position and shared revision `1`. Stale browser event hits actual 409/current revision and remains queued. Same-ID resolution is refused. Explicit new-ID choice at revision `1` moves backward to `.1`; accepted receipt advances head to `2`; previous immutable conflict receipt and KO row remain unchanged |
| `another KO write invalidates an explicit choice before replay without silently rebasing it` | Another accepted KO-style operation advances head after the explicit choice is queued. Its real stale CAS response leaves the new event queued; neither percentage nor arrival clock silently rebases it |
| Four `malicious HTTP 200 receipt … cannot delete either queued event` cases | Server response-only faults inject wrong activity kind, wrong progress revision, unsent ID or unexpected field. Both individual requests return HTTP 200 and both durable server effects/receipts exist, but imported runtime receipt gates return blocked and retain both events. Reload preserves them; uncorrupted original receipts on retry acknowledge once, without another revision/activity |

### Explicit resolution versus acknowledgement

The reader Repository has no public conflict-resolution method. This harness therefore supplies a narrow **explicit user-resolution transaction**, not an alternate acknowledgement path: it requires the named observed conflict, a new event ID and its observed base revision; rejects active leases; atomically calls actual `Repository.accept`, removes only the explicitly superseded conflict and fences any old lease. The new event still requires a runtime-validated server receipt to be acknowledged. Unresolved conflicts are retained.

Thus automated replay deletes only validated acknowledgements; **explicit user supersession is a separate intentional deletion**. No claim is made that the current reader module already owns a production-ready resolution API/UI/history. Promotion must move this operation into its durable storage owner, with explicit discard/supersession audit semantics and fresh reading-state retrieval. An intervening server write already invalidates the choice through CAS here.

### Fault and workflow findings

- Chromium transparently retried the first deliberately closed HTTP connection, making the initial single-drop test return acknowledged. The retained fault now drops matching **post-commit responses until the explicit SQLite reopen control**. This produces an actual fetch failure even with browser retries; server receipt lookup deduplicates every repeated attempt. This is not a fabricated fetch rejection or modified request Origin.
- Keeping an absolute long repository TMPDIR made Chromium abort before tests because its Unix socket path exceeded 108 bytes. `verify.sh` uses an absolute Go temp directory and a **relative path into assigned scratch** for Chromium, preserving ownership and fitting the socket budget. That launch failure was not application evidence.
- The API uses the same request-context unwrapping established by its race-tested proof. The final race-instrumented integration server exits cleanly after actual browser traffic.

## Regression and security verification

- **Final reader composition:** fresh locked install, strict typecheck, Vite production build and race-instrumented server passed **10/10 Chromium tests** in the sibling-dependency-absent checkout after the raw-style/NAV/NCX changes. Final evidence: `verification-final-reader-smoke.log`, `hermetic-summary.json`, `source-contract-hashes.txt` and the hermetic checkout's browser JSON/dependency closure. The earlier normal/full Go compile-vet and isolated **10/10** runs in `verification-latest-reader.log` / `verification-hermetic.log` predate those localized reader fixes; they are historical, not additional final-source passes.
- **API/root regressions:** cite the prior original Go/race/vet, Go/TS deterministic drift, TS/client, read-only root API and **12** fault-check pass in `_scratch/m2/api-contract/verification-integration-origin.log`. They were not rerun for this dependency-only refresh: API server/store/generated-client hashes match that run (`1b91a742…`, `32495629…`, `e371b98b…`, with full hashes in `source-contract-hashes.txt`); API/Go files and integration Go graph are unchanged. Root tests remain utility/upload-error/compile evidence, not production auth/KO parity.
- **Prior audits (locks unchanged; not rerun for final smoke):** integration `go mod verify`; pinned govulncheck **1.9.0**, DB timestamp **2026-11-11T02:51:11Z**, **zero finding records** in the integration graph. Full/runtime npm audits report zero advisories. The prior unchanged API/root graph scans reported zero findings and are cited rather than rerun for this frontend-only refresh. JSON finding records are inspected, not inferred from exit zero. Refreshed evidence: integration `audit-latest-reader.log`, `audit-go.json`, `npm-audit*.json`. Prior unchanged-API/root scan: API `audit-integration-origin.log`. These are dated dependency scans, not a complete security assessment.

## Independent acceptance

Independent review accepts the bounded integration proof unconditionally: **10/10 actual-HTTP browser tests**, API/default/configured-origin/root regressions and all 12 API fault checks passed. Ten copied-source mutants failed named browser assertions; three additional reviewer HTTP counterexamples passed (schema 400, control-Origin/auth separation, and valid receipt JSON on HTTP 500), with two further negative mutants. Nested-graph audits were clean at the declared scan date. No bounded blocker remains; optional retention of reviewer-only cases is not an M2 prerequisite.

That review predates the final localized reader serialization/navigation fixes; the dependency-isolated **10/10 final-source smoke** above confirms unchanged HTTP composition afterward, while the [reader's independent final closure](m2-reader-storage.md#independent-closure) qualifies those renderer seams. Neither result establishes production authentication/KO/migrations, full restart or SW behavior.

## Test dispositions

| Existing/new tests | Disposition | Requirement |
| --- | --- | --- |
| Original API proof and root API tests | Preserve; prior pass cited with unchanged API hashes | Default constructor, security, receipt/CAS/validation and compatibility compile contracts are unchanged |
| `TestConfiguredOrigin` | Preserve; introduced by the original origin extension | Actual configured single-origin policy without reflection or auth bypass |
| Integration Chromium tests | Preserve; final dependency-isolated smoke | Same ten HTTP contracts, now importing parsed CSS/body policy through actual Repository |
| Dependency-isolated checkout/build guard | Preserve; repeated unchanged | No sibling `node_modules` required; every resolved build dependency belongs to the integration install; hiding owned CSS parser must fail |
| Reader-storage/design tests | Preserve, not changed or rerun as their complete suites | Imported reader storage/sync/wire are exercised here; reader engine, content-policy and design suites retain their separate evidence |

No production tests are retired/adapted, generated outputs are not manually edited, and no browser implementation is copied into the integration module.

## Limits / promotion gates

1. **Fixture authentication only.** Random signing key and session-bound CSRF are real, but a key-protected synthetic bootstrap is not password login, revocation, registration, role administration or a production CSRF bootstrap design. Cookie expiry is explicit browser-cookie invalidation, not elapsed-time expiry. Plain loopback HTTP uses `Secure=false`; TLS/Secure cookies, proxies, CORS/deployment and real account-switch flows remain unqualified.
2. **Fixture persistence, not production upgrade.** Actual SQLite receipts/head and root SQLC are used; fixture schema, single connection/serialized harness controls and small synthetic events are unchanged. Reopen is not a process/power failure, disk-full or old/populated database migration. No private dataset was accessed. Every production writer must participate before shared revision guarantees hold.
3. **KO-style operation only.** `/__fixture/ko` directly invokes the accepted shared write under the private test key; it is not the real `/api/ko` protocol, credentials or receipt-time GET implementation. Real KOReader/OPDS compatibility and current-state read/timestamp tie fixes remain pending.
4. **Bounded browser adapter.** Coordinator models a batch but API accepts events individually. Partial commits are retried safely, not atomic cross-event transactions. Fixture conflict metadata and explicit selection state are in memory; no production conflict dialog, durable resolution history, retry/backoff UI, cancellation or long-running operation design is supplied. Full runtime validation of every read/error DTO is not established by generated TS alone; critical receipt gates are exercised.
5. **No reader/SW/M5 expansion.** Repository import validates and stores the unchanged synthetic EPUB through the latest CSS/chapter/archive/body policies, but this harness does not import/render the controller or EPUB.js, exercise benign font/SVG/link rendering, drive real page-turn measurement or prove EPUB isolation. Existing reader evidence remains separate. No cold offline shell, legacy SW retirement, installed PWA, eviction/quota/power-loss, full browser termination, Safari/iOS/Android, real device, large-file streaming/ranges or accessibility/performance qualification is claimed.
6. **Harness only.** Private fixture reset/reopen/fault/state endpoints and the tiny window-driven page must never ship. The server buffers its bounded responses for fault injection, has one synthetic account, and serializes HTTP operation diagnostics. It is deliberately not general production infrastructure.

## Task-end report

- **Assumptions:** sibling source/API bindings/public synthetic EPUB remain available read-only, not sibling dependency installs; same-origin per-event HTTP semantics govern integration; existing fixture IDs remain opaque.
- **Autonomous decisions:** serve compiled Vite output from a dynamic Go listener; own the complete imported dependency closure, preserve linked source identities and reject foreign dependency resolution; verify a sibling-dependency-absent checkout plus missing-parser sensitivity; retain response-only faults and explicit conflict supersession.
- **Compromises:** loopback fixture authentication/cookie invalidation, SQLite reopen rather than process kill, and harness-only explicit conflict resolution; these keep evidence bounded without claiming production/SW/real-KO/M5 readiness.

**Knowledge capture:** retain the executable closed-connection retry, relative-TMPDIR and absent-sibling dependency checks here; keep new sibling-import dependencies pinned/deduplicated in this package and the build-resolution guard. Before promotion, document individual-event partial-commit replay and explicit conflict supersession in the storage/API package contracts, not global agent guidance.
