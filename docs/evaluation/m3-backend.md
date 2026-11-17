# M3 backend — Production vertical slice

**All three independent backend review findings are closed: root qualification passes, actual Chromium cover isolation passes (also under race), and 21 behavioral mutations plus Go/TS drift are detected.** Authority: the complete `m3-boundaries.md`, migration design and M2 evaluation evidence. See [final tooling/root evidence](m3-backend-final.md) and [upstream KOSync recheck](kosync-compatibility.md) for current results and limits. This is backend qualification, not overall M3, physical-client or production approval.

## Boundary state

| Owner | Production state |
| --- | --- |
| HTTP contract | `api/openapi.yaml` → pinned strict Gin Go generation and `web/src/api/schema.gen.ts`. Thirteen real operations; closed DTOs, required nullable values, string revisions and Blob binary types. No proof bootstrap/admin/upload-validation endpoint. |
| Identity | `api/identity.go` owns shared credential verification, registration and bounded admission; `api/auth.go` owns session operations and SSR/KO/OPDS mapping. SSR and JSON use the same trimmed raw-password → MD5 → existing Argon2 verification; KO receives its existing MD5 header value, OPDS retains raw Basic-password hashing. No handler calls another handler. |
| Reading | `reading/reading.go` owns device ownership, authoritative state, progress/activity transactions and permanent event decisions. It imports neither Gin nor generated HTTP DTOs. Both real KO writers and strict web adapters call these operations. |
| SQLite | `database/manager.go` composes the existing base schema with the shared additive `migrations.ReadingSchema`; Goose executes the same extension and one-time seed. Historical migrations/tables/credits are not rewritten. |
| Composition/lifecycle | `api.NewAPI(db, config, fs)` returns an error without opening a listener; `Handler()` exposes the production router for real browser integration. Server composition owns DB closure, after HTTP/worker shutdown. Each scheduled refresh gets a fresh bounded context. |
| Application/build | SSR remains mounted. Known `/app/*` navigation and the exact anonymous retirement query serve the compiled shell; missing API/assets never fall through to HTML. Go embeds the existing assets tree, including `assets/app/`. Both containers build the frontend first; Node exists only in their build stages. |

Exclusive source writes stayed in the assigned backend/composition/packaging paths, generated schema exception and this report. `docker-compose.yml` received the necessary required-origin environment entry. No other web source/package/reader writes, prototype imports, subagents, staging or commits. **`flake.lock` and other-owner restore/preview state were untouched.** All qualification scratch is under `_scratch/m3/backend/`.

## Established contracts

- `/api/v1` requests have authentication/origin/CSRF/media/8,192-byte checks before retained schema validation. UTF-8, duplicate/escaped-duplicate, unknown and wrong-case JSON keys reject. Strict operations unwrap `Request.Context()`, never retain a pooled Gin context. Encoded IDs route and decode once; slash/plus/percent and 128-character Unicode IDs retain identity and decoded-character bounds.
- New event IDs validate UUID spelling without converting identity text; existing account/document/device IDs remain opaque strings. `format: uuid` alone did not enforce the selected validator's string boundary, so an explicit schema pattern protects it. This was found by an actual negative test, not waived.
- Signed cookie identity remains `token`. Current account, role, expiry and auth hash come from SQLite, not cached claims. Anonymous CSRF is random and signed-session-bound; login/register/logout rotate it. HTTPS origins force Secure/HttpOnly/SameSite Strict cookies; only explicit loopback HTTP is accepted for development. Production requires the exact browser-visible `PUBLIC_ORIGIN`, not Host/reflected Origin. Bad/expired cookies bootstrap anonymous; storage failures remain storage errors rather than expiring an identity.
- Credential admission: 10 explicit login/registration attempts or failed legacy checks/source/minute, at most 1,024 active source windows, four concurrent credential hash/verification operations. Successful KO/OPDS header checks refund their generation-bound reservation without clearing prior failures, so ordinary repeated sync/download authentication is not throttled as repeated login. Forwarded client-IP headers are not trusted. Overload is a safe 429/503 with Retry-After; request bodies/cookies/passwords/tokens are not logged, including panic recovery.
- First-user administration is decided in the registration transaction; credential hashing is shared and concurrency-bounded across registration/settings/admin paths. SSR password change rotates the auth hash and current session; settings updates do not overwrite roles. JSON adapters share these identity operations rather than form redirects. Continuing SSR form surfaces and external KO/OPDS authentication remain compatibility adapters, not newly ported M4 workflows.
- Versioned library count/items use one read transaction, stable ID ordering and literal title/author substring search. Detail DTOs allowlist public fields. Versioned cover GET serves existing image bytes without provider lookup or metadata mutation. All three cover aliases now share inert SVG/CSP, nosniff and private/no-store response policy, including retained fallback/provider branches. SSR/OPDS still retain their existing metadata lookup/fallback behavior; the earlier report's unqualified cover claim was too broad. Versioned managed and configured DIRECT file basepaths work; relative filenames/symlinks cannot escape their authorized root. Original files stream through conditional/Range serving, with safe attachment names, real MIME/length, 200/206/304/416 and safe Problems. Versioned protected metadata/binaries are private, no-store.
- Heads contain the complete accepted snapshot and bounded revision. Historical live account/document pairs seed at revision `"0"`, latest legacy timestamp then **device ID ascending**. Existing per-account evidence is retained even when a historical device collision left another current owner; new writes cannot take that device. Blank legacy KO names/positions remain representable; absent progress remains exactly `{}`. Neither client clock nor highest fraction selects the accepted head.
- Receipts are account/event scoped across kinds, retained without TTL, with payload version, normalized full payload, digest, UTC observation and immutable decision fields. Normalize UTC instants and signed zero; preserve opaque positions and IDs. Account/auth checks precede receipt access; receipt lookup precedes CAS/new-effect checks. Exact retry returns the original success/conflict after later writes/reopen; changed payload/kind conflicts. Head, legacy effect and receipt commit or roll back together. Exhaustion changes no reading effect. Activity is independent of progress conflict.
- See the [current KOSync recheck](kosync-compatibility.md) for persisted numeric timestamps, account-scoped external aliases, no-ID requests and declared F6/F7 gaps. KO activity uses the same credit persistence and original page/pages fraction arithmetic, without promising deduplication for legacy requests lacking event identity. OPDS discovery/search/download/Basic auth remain their real protocol.
- Derived statistics use the authoritative head for current percentage without rewriting credited history. The retained SSR reader maps that head back to its original empty-string/0–100 rounded display representation; KO and the versioned API retain exact 0–1 fractions. Zero-duration accepted activity produces zero WPM rather than aborting statistics refresh. Existing normal credit/streak/query tests remain intact.

## Independent backend review closure

Authority: `_scratch/m3/review-backend/review.md`, read in full; reviewer files were read-only. Fixes stay in API response/URL mapping and backend CI/tests. **OpenAPI, generated DTOs, module dependencies, frontend/reader sources, private snapshots and `flake.lock` are unchanged by this follow-up.**

| Finding | Closure / permanent evidence |
| --- | --- |
| **P1 stored SVG executes through SSR/OPDS aliases** | One `setCoverResponseHeaders` boundary is used by both retained aliases and the versioned binary responder. Sandbox has no script/same-origin allowances; CSP prohibits network subresources, document embedding and base rewriting while allowing inline styling/data images. HTTP tests cover actual SVG/raster bytes and MIME across all aliases, full/range/conditional responses and retained fallback images. No rasterization, attachment-only workaround or SVG rejection hides the defect. |
| **P2 unusable OPDS opaque hrefs** | Both acquisition and cover IDs use `url.PathEscape`; the existing XML encoder still owns attribute escaping. A real feed is parsed using the repository's `opds.Feed` definitions, then every published file/cover href is followed for ASCII, plus, slash, percent, Unicode and query/fragment-bearing IDs. Original bytes and retained OPDS media behavior are checked against a real ASCII control, not replaced with versioned-file MIME assumptions. |
| **P2 missing legacy Retry-After** | Shared 429/503 response policy is applied to JSON/SSR renderers and direct SSR credential rate rejections. Real typed registration work overload remains 503 instead of being collapsed into legacy registration 400. Twelve real HTTP rate/work cases cover KO auth/register, OPDS auth, SSR login/register/password paths; non-overload 401 has no retry header. Other legacy bodies/status behavior is preserved. |

`TestCoverBrowserIsolation` + `api/cover-browser.mjs` use the real Go router, signed-cookie/CSRF registration, OPDS Basic auth and synthetic stored SVG/PNG files. Chromium **157.0.8103.38** performs **18 top-level/image/iframe/object/embed checks** across the three aliases. Nine pixel checks establish visible raster/SVG output, including an internal SVG fragment reference. Active SVG cannot read the authenticated session/CSRF, change its parent or message credentials; actual Go-server counters observe **zero session, external-resource or external-credential requests**. The SVG also attempts same-origin image requests and cross-origin image/style/font/use resources. Chromium can emit request events for CSP-blocked loads, so assertions measure actual HTTP delivery rather than mistaking blocked attempts for network access. Fresh isolated contexts block service workers; this tests live response boundaries, not old cached-response retirement.

The cover-policy mutation is also replayed in actual Chromium: removing only the retained-alias policy restores app-origin execution and credential-bearing resource requests, and the named browser regression fails. The final counterexample records two session requests and four external requests, two carrying credentials; the fixed and race runs deliver zero. This verifies fault sensitivity rather than inferring safety from header presence alone. The shared checkout is never mutated. No browser process/listener remains. Browser tests are an explicit `api/check-cover-browser.sh` gate (CI installs the already-pinned Playwright Chromium tool); ordinary root tests deliberately skip that one opt-in test rather than silently claiming browser execution.

## Migration and downgrade evidence

Synthetic tests cover fresh initialization, the immediately preceding populated schema, deterministic ties, empty state, repeat open, deletion, revision bounds and refused Goose Down. No broad FK enforcement change or orphan purge.

A **new disposable copy** of the private backup DB was extracted only under own scratch; no document archive extraction, original snapshot changes or other-owner restore access. Before/after row digests matched for all six historical tables, including credentials, positions, timestamps and paths:

| Table/evidence | Unchanged aggregate |
| --- | ---: |
| Users / devices | 2 / 10 |
| Documents / metadata | 216 / 319 |
| Progress / activity | 230 / 151,593 |
| Original metadata FK orphans retained | 2 |
| External basepaths retained | 90 |
| Seeded heads / initial receipts | 174 / 0 |

Integrity check passed and repeated open was unchanged. This preserves external path values; it does **not** claim the private machine's original external files are available here. Real binary availability was tested with synthetic managed/DIRECT roots and the public Alice fixture.

Installed progress/activity write triggers require the new binary's `READING_WRITER()` capability function. An independent Python SQLite writer without it was actually rejected for both effects. Goose Down refuses this ledger migration. **Do not deploy an old writer or claim reversible downgrade:** stop writes and restore a compatible complete backup or forward-repair. This is a write gate, not a completed M5 restore/rollback rehearsal.

## Executed acceptance and dispositions

| Tests / module | Disposition | Contract/evidence |
| --- | --- | --- |
| Existing root API utility/upload tests | Preserve | Continuing classification, formatting, upload/security behavior; no SSR tests removed. |
| Existing database user/document/query/credit/streak tests | Preserve | Existing persistence and credit arithmetic remain requirements; no fixture adapters or expectation weakening. |
| Existing config, graph, metadata, utilities and pkg suites | Preserve | Full root graph tests/race/vet, not a nested proof module. |
| New identity/validation HTTP tests | Add | Real Argon2 registration/login/logout; random bound/rotated CSRF, exact configured origin, HTTPS cookie flags, first-admin concurrency, expiry/current role/hash revocation, actual SSR password change, rate/work limits, repeated real KO/OPDS header checks without throttling valid synchronization, safe storage failure and closed request/response negatives. |
| New reading/KO HTTP tests | Add | Actual MD5-header auth → PUT → GET; web-visible revision/backward choice; historical timestamp/ownership ties, null/blank/missing state, placeholders, collisions, durable conflicts/normalization, cross-kind identity, concurrent CAS/dedup, lost committed response and SQLite reopen, effect/receipt rollback, exhaustion/deletion. |
| New resources/OPDS/shell tests | Add | Real public EPUB and raster/SVG covers; managed/DIRECT serving, ranges/conditional/errors/private headers/path safety; real Basic/XML discovery/download; anonymous shell/retirement route, worker/manifest/cache policy, no API/asset SPA fallback. |
| New migration/lifecycle/statistics tests | Add | Historical rows/orphans/basepaths unchanged; seed/deletion/reopen/down gate; per-tick deadline and shutdown drain; shared backward percentage and zero-duration WPM without credit rewrite. |
| `TestTaskContextStartsAtEachTickAndShutdownDrains` draft setup | Adapt | A canceled modernc connection discarded an in-memory fixture's schema under race/load. Final setup uses production-like file-backed SQLite and 500ms ticks/300ms job deadlines; the first tick still occurs after a startup-created deadline would expire. Five repeated race runs and the final full-root race run pass; the deadline mutation still fails its named assertion. |
| Proof suites | Preserve, untouched | Evidence is deliberately promoted through production boundaries, not imported as fake runtime behavior. |

The review follow-up deliberately adapts the existing cover test below; no tests are removed or replaced. The lifecycle fixture adaptation remains explicit above. **Twenty-one behavioral mutations plus schema-only generation drift** are exercised in a disposable public-source copy: CAS, replay, signed zero, KO fraction, receipt kind, origin, duplicate JSON, auth revocation, escaped plus, timestamp/ownership seeding, rollback, worker deadline, head-derived percentage, zero-duration statistics, successful legacy authentication admission and retained SSR display-percentage units, plus cover-alias policy, OPDS href encoding, retry headers and registration work-overload status. Each must fail its named behavioral test, not compilation. Schema mutation must report both Go and TS drift. Source is restored only in that copy; shared source is never mutated by the fault runner.

Final root commands/evidence are retained under `_scratch/m3/backend/`: `tests.log`, `race.log`, `lifecycle-repeat.log`, `vet.log`, `mod-verify.log`, `audit.log`/`govulncheck.json`, `fault-summary.log`, `migration-summary.json`, `embed-summary.json`, container build/smoke logs. Root SDK **Go 1.26.11 linux/amd64**; actual graph includes Gin **1.12.0**, runtime **1.8.0**, middleware **1.2.1**, kin-openapi **0.152.0**, x/net **0.62.0**, x/crypto **0.59.0**. SQLC remains generated by pinned **1.29.0**; oapi-codegen is **2.8.2**. Go module verification and refreshed govulncheck **1.9.0** parse finding records and assert the actual root SBOM/toolchain; DB timestamp **2026-11-11T02:51:11Z**. This is a dated static scan, not a general exploit-safety claim.

### Follow-up test dispositions and evidence

| Test / module | Disposition | Reason |
| --- | --- | --- |
| `TestCoverServesRealSVGWithInertNavigationPolicy` | Adapt | The live contract applies to every cover alias, not only v1; preserve bytes/MIME/metadata assertions and extend setup to raster, Range/304 and retained fallback branches. |
| `TestCoverBrowserIsolation` | Add | Real authenticated Chromium top-level/image/embed execution, visibility and HTTP credential/subresource isolation; actual legacy-alias mutation must fail it. |
| `TestOPDSPublishedOpaqueLinksReachOriginalResources` | Add | Parse actual OPDS definitions/XML attributes and follow emitted links; no copied protocol models or independently guessed hrefs. |
| `TestLegacyCredentialOverloadRetryAfter` | Add | Preserve fail-closed auth/error bodies while asserting 429/503 status and retry guidance across rate/work paths. |
| All other API, reading/database, lifecycle/statistics, config and root suites | Preserve | Same contracts and assertions; full root tests/race/vet/build/module verification are refreshed. |

Follow-up logs are `_scratch/m3/backend/review-fixes/{targeted,browser,browser-race,tests,race,vet,generation,audit,fault-summary}.log`, `mod-verify.log` and `embed-summary.json`; public screenshot/browser JSON evidence is under `_scratch/m3/backend/cover-browser/`. Fault logs include the real-Chromium counterexample in `_scratch/m3/backend/faults/cover-alias-browser.log`. Browser executable selection is command-scoped `ANTHOLUME_CHROMIUM`; a relative child TMPDIR keeps Chromium's Unix socket within its length limit while all scratch remains in backend ownership.

## Build and integration

Frontend is the sole package/lock writer; use its locked install/build. Backend schema generation is **`bash api/generate.sh`**, not a bare TS CLI which would lose the Blob transform. `api/check-generation.sh` generates twice without modifying checked-in outputs and checks both artifacts.

```sh
mkdir -p _scratch/m3/backend/tmp
PATH="$PWD/_scratch/m2/api-contract/toolchains/go/bin:$PATH" \
GOTOOLCHAIN=local TMPDIR="$PWD/_scratch/m3/backend/tmp" bash -eu -c '
  bash api/check-generation.sh
  go test -mod=readonly -count=1 -timeout=180s ./...
  go test -mod=readonly -race -count=1 -timeout=180s ./...
  go vet -mod=readonly ./...
  go build -mod=readonly -ldflags "-X reichard.io/antholume/config.version=m3-qualification" -o _scratch/m3/backend/antholume .
  go mod verify
  python3 api/fault-check.py
  bash api/audit.sh
'
```

Make/CI and both containers require the frontend build before Go embed and fail if the new shell/worker/manifest are missing. The frontend build plugin consumes **root `assets/manifest.json`** to preserve inferred install identity; both Node stages copy it explicitly. Local native release embed verification found all **24 compiled files, 1,456,612 bytes**, byte-for-byte in the binary, with root manifest start/scope and no new ID.

The initial M3 baseline built both Dockerfiles for linux/amd64 through the installed Docker-compatible **Podman 5.8.9** CLI (Node **22.23.4**, Go **1.26.11**), not just reviewed. Bounded smoke testing used no external network or published host ports: release binary served embedded deep links, anonymous retirement bootstrap, compiled root worker with JS/no-cache, manifest and genuine API 404; final image had no Node/npm and SIGTERM drained cleanly. The two baseline build-file tags resolved to the same native image; only those qualification tags were removed afterward, and no test container/listener remains. Those native image builds/smoke predate this review repair; current source is requalified by the root release build and real-handler HTTP/Chromium checks, not falsely described as a new image build. Rebuild deployment images to receive the fix. This does not qualify Docker Buildx's multi-architecture execution or ARM hardware.

```sh
docker build -f Dockerfile --build-arg VERSION=m3-qualification -t localhost/antholume-m3-backend:qualification .
docker build -f Dockerfile-BuildKit --build-arg TARGETOS=linux --build-arg TARGETARCH=amd64 --build-arg VERSION=m3-qualification -t localhost/antholume-m3-backend:buildkit-qualification .
```

The review repair adds a mandatory Chromium cover CI gate using the existing locked Playwright installation. Locally, select installed Chromium without modifying the package manifest:

```sh
PATH="$PWD/_scratch/m2/api-contract/toolchains/go/bin:$PATH" GOTOOLCHAIN=local \
ANTHOLUME_CHROMIUM=/path/to/chromium bash api/check-cover-browser.sh
PATH="$PWD/_scratch/m2/api-contract/toolchains/go/bin:$PATH" GOTOOLCHAIN=local \
ANTHOLUME_CHROMIUM=/path/to/chromium ANTHOLUME_COVER_BROWSER_FAULTS=1 python3 api/fault-check.py
```

`PUBLIC_ORIGIN` is required at startup/Compose. HTTPS termination remains the deployment proxy's responsibility; loopback HTTP is the explicit test/dev exception. Configure a durable cookie signing key when sessions must survive server restarts. Nix/lock declarations were not regenerated; qualification used only command-scoped SDK selection.

## Cross-owner needs and remaining gates

1. **Previous frontend event-401 blocker is closed in current source/report:** `deliver` has no eager expiry side effect; the frontend report records real malformed/current/stale-lease 401 regressions. The reader report confirms that seam plus retirement intent and recovery coordination. These are cited owner results, not frontend tests rerun by backend.
2. Production router injection is ready: `api.NewAPI` + `Handler()`, actual test origin in `Config.PublicOrigin`, stable synthetic test signing key and real SQLite/files. Reconcile stale UUID/handler compile-gate notes: generated Go event IDs now retain string identity, final root/helper compilation and container frontend typecheck pass. No new provider endpoint/seam is needed.
3. The [current joint run](m3-integration-check.md) records 34/34 actual-Go browser and 40/40 unit; [reader/SW](m3-reader-final-check.md) records reader 70/71 and SW 6/6. See [checkpoint evidence](m3-boundaries.md#current-checkpoint-evidence) for the approved streaming target and scoped A/B/C/D results. These are not suites rerun by backend.
4. Physical HTTPS iOS/Android installed PWA and physical KOReader, broad corpus/performance/a11y, dormant-client upgrades, administrative restore/write exclusion, capacity/retention operations and M5 rollback remain unqualified. M4 dashboard/settings/admin/acquisition/upload React parity is intentionally unported; real SSR routes/links remain. Root SPA/SSR retirement remains M6.

### Task-end report

- **Assumptions:** deployment supplies trusted HTTPS termination and the exact browser-visible origin; private external file roots require separate deployment availability qualification.
- **Autonomous decisions:** bounded credential admission and safe backpressure; shared migration DDL and capability-function old-writer gate; decoded opaque-path validation and string-preserving UUID validation; head-derived statistics with a zero-time WPM guard. Review repair shares cover/retry response policies, keeps SVG/raster bytes and legacy MIME behavior, and promotes cover security to an explicit Chromium CI gate.
- **Compromises:** bounded backend/native-image qualification cannot establish physical, joint-browser, multi-architecture or rollback approval; those remain explicit gates rather than simulated successes. The repair does not re-run container image builds or claim stale cached responses are repaired; redeployment/rebuild and the owned worker-retirement gate remain necessary. Existing SSR workflows are retained, not prematurely replaced.

Knowledge captured in `api/AGENTS.md`, `database/AGENTS.md` and `reading/AGENTS.md`: strict-context/retained-validation ordering, opaque-path/UUID validation, normalized receipts, file-backed cancellation/lifecycle fixtures and shared transaction ownership. The root-manifest Node-stage dependency is captured in this build section and both Dockerfiles. The review's all-alias cover policy and legacy overload status/header invariants are recorded in `api/AGENTS.md` and executable HTTP/Chromium regressions.
