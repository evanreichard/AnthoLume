# M1 — Backend Architecture, Tests, and Tooling Evaluation

**Recommendation (not approval): retain Gin/SQLite/SQLC, introduce an intentional `/api/v1` web boundary, and prove schema-first generation before adopting it.** React, browser persistence, and compatibility adapters need distinct owners; replacing templates does not require a database or framework rewrite.

This report evaluates the direction in `docs/frontend-migration.md:3`, `docs/frontend-migration.md:78`, and `docs/frontend-migration.md:114`. Direction is approved; contracts, tooling, and security policies below remain proposals unless explicitly labeled **confirmed**. This is not a generator spike, implementation authorization, full parity inventory, or M1 completion. Legacy browser-data preservation is excluded; existing server data and KOReader/OPDS compatibility are not.

## 1. Evidence and Limits

### Confirmed verification

- Read the architecture-review and test-disposition skills, the migration direction, Go composition/handlers/authentication, SQL/schema/migrations, all existing test files, and build/deployment/CI definitions. Evidence citations refer to repository source lines, not a private dataset.
- Existing `go test -count=1 -timeout=120s ./...`, `go vet ./...`, `go test -race -count=1 -timeout=120s ./...`, and a native embedded production-mode `go build -trimpath` all exited 0. Build used `-X reichard.io/antholume/config.version=evaluation` and wrote only a scratch binary.
- Environment: Go 1.26.10, Node 22.23.4, npm 10.9.9. Repository minimum is Go 1.26.0 (`go.mod:3`); containers/CI select 1.26.8 (`Dockerfile:6`, `.gitea/workflows/ci.yaml:19`). This is not verification on the exact CI patch or all release architectures.
- Commands, logs, isolated Go caches, test config/data, and public package metadata are under `_scratch/evaluation/backend-tooling/` (`validate.sh`, `go-test.log`, `vet.log`, `race.log`, `build.log`, `versions.json`). Tests used checked-in/synthetic fixtures, isolated config/data/temp paths, and read-only module resolution. No server was started, snapshot accessed, production code changed, or git operation performed.

### Evidence limitations

The green suite is a baseline, not migration confidence. No HTTP authentication/authorization integration tests, browser/PWA tests, old-schema upgrade tests, or compatibility wire tests were found in the existing suite. `api` tests cover formatting and an error mapper, not a running router (`api/utils_test.go:9`, `api/upload_test.go:12`). Database suites create new in-memory databases (`database/manager_test.go:40`, `database/users_test.go:30`, `database/documents_test.go:22`), so they do not establish existing-database migration safety. Race success does not exercise concurrent HTTP authentication.

Test dispositions below are static, proposed decisions against the approved direction. Mutation verification was **not performed**: production edits are forbidden and no implementation proof is authorized. Preserve means the test has a live contract worth retaining, not that fault sensitivity was experimentally established. No private fixtures or snapshot facts are needed for these conclusions.

## 2. Current Boundaries and State Ownership — Confirmed

| Boundary | Current responsibility and coupling | Mutable state / contracts | Evidence |
| --- | --- | --- | --- |
| Composition | CLI selects embedded versus disk assets; server constructs DB/API and runs periodic statistics work | Process lifecycle and worker cancellation | `main.go:16`, `main.go:39`, `server/server.go:25`, `server/server.go:37` |
| HTTP/API object | Owns router/server, templates, DB/config/assets and auth cache; installs sessions globally and registers all transports | Gin route signatures, handler request structs, implicit template/JS payloads; shared unsynchronized auth map | `api/api.go:26`, `api/api.go:37`, `api/api.go:94`, `api/api.go:130`, `api/ko-routes.go:21` |
| Web handlers | Query orchestration, business rules, file writes, metadata calls, form binding, redirects and HTML rendering coexist | Public workflow policy is inside presentation handlers; list GET also computes missing word counts | `api/app-routes.go:105`, `api/app-routes.go:429`, `api/app-routes.go:647`, `api/app-routes.go:863`, `api/app-routes.go:945` |
| Administrative handlers | User privileges, import, backup/restore, database reload and credential invalidation | Filesystem plus live DB/process state; separate check/update for last administrator | `api/app-admin-routes.go:99`, `api/app-admin-routes.go:373`, `api/app-admin-routes.go:536`, `api/app-admin-routes.go:796`, `api/app-admin-routes.go:859` |
| Compatibility adapters | KOReader/KOSync JSON and headers; OPDS feeds/Basic auth; share file/cover handlers with web | KO progress and activity write directly through SQLC; OPDS response models are separate | `api/api.go:191`, `api/api.go:215`, `api/auth.go:52`, `api/auth.go:91`, `api/ko-routes.go:80`, `api/opds-routes.go:30`, `api/common.go:15` |
| Persistence | SQLite manager, SQLC queries, statistics refresh, embedded schema/Goose migrations | DB is authoritative; derived statistics are persistent tables, not a separate service; one open DB connection | `database/manager.go:20`, `database/manager.go:85`, `database/manager.go:142`, `database/schema.sql:122`, `database/query.sql:1` |
| Document storage | Handler-local document/cover writes and downloads; linked imports can retain an external base path | SQLite identifies files; file contents reside outside SQLite; GET cover can acquire/cache metadata | `api/common.go:39`, `api/common.go:101`, `api/app-admin-routes.go:426`, `api/app-admin-routes.go:491` |
| Supporting packages | Metadata/archive validation/provider calls, acquisition search, graph generation, hash utilities | Useful existing domain capabilities; not all are transport-independent application operations | `metadata/metadata.go:63`, `metadata/archive.go:30`, `utils/utils.go:13`, `graph/graph.go:29` |
| Browser | Global scripts, imperative EPUB renderer, IndexedDB queues and root service-worker caches | Browser formats have no migration requirement; reader runtime and durable event ownership are currently distributed | `assets/reader/index.js:150`, `assets/reader/index.js:335`, `assets/common.js:35`, `assets/sw.js:3` |

Dependency direction is mostly HTTP → SQLC/support packages. There is no existing application layer that centrally owns sync, file publication, administrator invariants, or session invalidation. Keep useful direct queries; avoid inventing a repository interface for every SQLC method.

Important existing semantics:

- Documents form a shared library, not a per-user ownership model: `documents` has no owner column and its list joins per-user statistics (`database/schema.sql:18`, `database/query.sql:182`). Authentication is not evidence of private document ownership. Preserve shared-library behavior unless explicitly changed.
- User activity/progress is user-scoped, but device IDs are globally keyed (`database/schema.sql:64`, `database/schema.sql:77`, `database/schema.sql:93`). `UpsertDevice` updates name/time without changing the existing owner (`database/query.sql:353`); cross-account ID collisions need rejection, not implicit reuse.
- Progress is per user/document/device, replaced on receipt with a new default timestamp; latest timestamp is used when reading across devices (`database/query.sql:152`, `database/query.sql:323`). There is no durable web event ID/deduplication ledger (`database/schema.sql:93`, `api/ko-routes.go:229`).
- Web login/OPDS turn raw passwords into MD5 strings before Argon2 verification; KOReader sends its credential representation directly (`api/auth.go:32`, `api/auth.go:91`, `api/auth.go:143`). MD5 here is a compatibility representation, **not** the password-storage hash or a substitute for TLS.

## 3. Target Boundaries — Proposed End State

This describes ownership, not delivery order. Package names are illustrative; boundaries do not require a new package per row.

| Owner | Owns | Dependencies and boundary contract |
| --- | --- | --- |
| Composition root | Config, HTTP router, workers, shutdown, asset filesystem | Instantiates adapters/operations/persistence; terminates workers before closing DB. No workflow policy. |
| Web API adapter | `/api/v1`, OpenAPI DTOs, request limits/validation, identity/authorization, CSRF, HTTP errors and binary headers | Calls operations or simple SQLC reads; never another HTTP handler. Generated types stay here, not in SQLC or domain signatures. |
| Identity operations | Credential verification, current privileges, revocation, first/last-admin invariants | SQLite and existing Argon2/KO credential representation. Session roles cannot override authoritative roles. No React dependency. |
| Library operations | Shared-library mutations, metadata/acquisition application, document identity and atomic file publication | SQLC, bounded provider clients, document/cover storage. Downloads never disclose arbitrary stored/requested paths. |
| Reading operations | Activity acceptance, receipt deduplication, progress revisions, device-owner checks | One DB transaction owns each accepted event and its receipt. Both web and KO writers participate in progress revision tracking without changing KO wire shape. |
| Maintenance operations | Import, backup/restore, refresh; exclusive maintenance state when replacing data | Owns coordination with workers and DB lifecycle; no request goroutine mutates a DB being restored. Job/stream policy remains a decision, not an assumed generic job framework. |
| KOReader / OPDS adapters | Existing external routes, credential semantics, JSON/XML/status/content-type contracts | Reuse operations only where behavior is genuinely shared. Versioned web DTOs do not become external-protocol DTOs. |
| Persistence | SQLC/SQLite transactions, schema/migrations, safe files and derived statistics | Does not import Gin, generated web DTOs, or React. File publication has compensation/reconciliation because SQLite and filesystem are not one transaction. |
| React application | Navigation, accessible responsive UI, route/search state, transient interaction state | Typed HTTP client, reader controller, browser persistence facade. No direct IndexedDB or service-worker writes from arbitrary components. |
| Reader controller | EPUB lifecycle, rendition subtree, KO-compatible position conversion, engine listeners/resources | Publishes reading observations to the persistence owner; React owns surrounding controls, never rendition DOM. |
| Browser persistence/sync | New-schema local books, server downloads, preferences, immutable events, replay leases and acknowledgement | IndexedDB/Cache API and typed client. Query cache is derived server state, not a second queue. Local-only reading has no login prerequisite. |

### Invariants and delta

1. **One authoritative owner per state.** SQLite/files own server data; IndexedDB owns accepted local events; sync alone acknowledges/removes outbox entries. UI/query cache cannot claim durable save before the storage transaction commits.
2. **Identity isolation.** User identity comes from authenticated context, never payload `user_id`. Browser remote records are keyed by server identity + account identity; local-only documents are separate. Device ownership is checked on every relevant mutation.
3. **Replay safety.** Repeated accepted web event IDs have one credited effect and a stable acknowledgement. Same ID with different normalized payload is an explicit conflict. Receipt and effect commit together, including after process restart. This does not claim deduplication of old KO events that carry no event ID.
4. **Progress is not monotonic percentage.** Moving backward remains possible. A proposed server revision/precondition prevents stale web replay overwriting newer progress; conflict retains the browser event until explicit resolution. KO arrival-based behavior is externally preserved while its writes advance the same revision. Detailed conflict UX/policy needs approval.
5. **Protocol separation.** Protected web API errors are machine-readable, never redirects/login HTML. Existing KO/OPDS wire/auth contracts remain compatible. Unknown API paths/missing assets do not return the SPA shell.
6. **Server constraints are authoritative.** Registration/search/demo/admin rules apply server-side regardless of UI capability flags. Shared-library behavior remains shared unless separately approved.
7. **Resource lifetime is explicit.** Reader unmount destroys engine/listeners/URLs/wake locks. Server shutdown/restore drains or excludes work before DB/file replacement. Request cancellation reaches SQL/provider operations.

The delta is the removal of production templates, template helpers, HTML streaming and redirect/form response handling; workflow policy moves out of those handlers only where it needs a shared owner. No permanent React-to-SSR bridge, web-to-KO-handler calls, general-purpose service/repository hierarchy, or database rewrite. Invariants above are **acceptance requirements, not verified properties of the current system**.

## 4. Minimum Server Schema Changes and Upgrade Risks

### Minimum justified changes — proposed

**Serving React and a read/write JSON API alone requires zero database changes.** The approved durability/idempotency goals justify small additive sync state, not changing document IDs, progress strings, credential storage, or existing activity IDs.

| Addition | Minimum role | Constraints / alternatives |
| --- | --- | --- |
| Web sync receipt table | `(user_id, event_id)` unique key; operation kind, canonical payload digest, accepted result/reference/revision, acceptance time | Receipt + activity/progress effect in one transaction. An immutable event identity survives retries/restarts. Account deletion must clear receipts. Retention cannot expire before the supported replay horizon; indefinite retention is the simplest correct initial policy but needs growth limits/approval. |
| Progress revision table | `(user_id, document_id)` key and monotonic revision shared by all progress writers | Lazy initial revision can represent existing state without rewriting positions; web preconditions compare atomically, KO mutations advance revision without new required KO fields. A revision column on progress rows is an alternative, but per-device rows still need a document-wide concurrency rule. |

A receipt side table avoids making legacy KO activity inserts invent event IDs. Do not add global uniqueness to legacy activity timestamps/page tuples: distinct legitimate events can match. Do not derive cross-device ordering solely from client wall clocks. Proposed batch delivery acknowledges individual immutable events; either specify per-event transactional outcomes or explicitly document atomic whole-batch semantics. Never treat an HTTP error or a partially accepted batch as complete delivery.

No initial database changes for browser reader preferences/local books/downloads. Timezone already belongs to users (`database/schema.sql:12`). Add server-side preference or durable job tables only if the evaluated workflow requires cross-device settings or restart-resilient jobs. Browser schema versioning is independent of server SQL migrations; no legacy browser migration is needed.

### Confirmed risks and required qualification

| Finding | Evidence | Required upgrade/recovery evidence (proposed) |
| --- | --- | --- |
| Latest schema executes before Goose migrations; `CREATE TABLE IF NOT EXISTS` does not alter old tables | `database/manager.go:88-108`, `database/migrations/README.md:9` | Fresh and populated old-schema fixtures both reach equivalent structure. New-schema indexes/triggers referencing newly added columns must not execute against old tables before ALTER migrations. Side tables reduce this hazard. |
| Existing migrations branch on `isNew`; timezone migration rewrites user tables/defaults; down SQL includes forms such as `ALTER documents DROP COLUMN` | `database/migrations/20240311121111_user_timezone.go:14`, `database/migrations/20240510123707_import_basepath.go:31`, `database/migrations/20240128012356_user_auth_hash.go:82` | Do not promise Goose Down as rollback. Test supported upgrade origins, partial-failure restart, integrity/foreign-key checks, and restoration of a verified backup. |
| SQLite has one connection and WAL enabled; PRAGMA setup occurs after migration execution | `database/manager.go:85`, `database/manager.go:103`, `database/manager.go:160` | Avoid fetching through the base DB while holding its sole transaction connection. Establish FK behavior during migration; test with file-backed WAL databases, not only `:memory:`. No pool expansion/WAL tuning without need. |
| Import holds one transaction across directory traversal, metadata parsing and file copies, while the DB allows only one connection | `api/app-admin-routes.go:395-514`, `database/manager.go:85` | Measure blocking/cancellation and partial filesystem failures. Prefer bounded import units or an explicitly approved maintenance window; do not assume an async wrapper makes the DB available. |
| Backup VACUUMs then copies the live main DB file, without a demonstrated coherent snapshot across DB/files | `api/app-admin-routes.go:721-793` | Use a supported SQLite snapshot/backup approach plus coordinated file manifest or maintenance lock. Verify WAL-visible records, archive close/flush errors, nested import paths, and round-trip consistency. |
| Restore accepts prefix-shaped ZIP names, stops validation when it finds the DB, joins entry names to data path, deletes live data before complete replacement | `api/app-admin-routes.go:594-610`, `api/app-admin-routes.go:638-716` | Reject traversal/absolute/duplicate/symlink/unbounded entries; validate every entry/schema before destructive work; stage then publish under exclusive maintenance. Failure leaves original installation recoverable. This is a static hazard, not an exploit demonstration. |
| DB opens under ConfigPath/DBName, but restore/removal targets DataPath and a hard-coded DB name | `database/manager.go:69`, `api/app-admin-routes.go:681`, `api/app-admin-routes.go:699`, `api/app-admin-routes.go:763` | Synthetic round trips with separate config/data roots and non-default DB name; preserve linked-import basepaths or explicitly report unavailable external files. |
| Worker context expires five minutes after worker startup, before first fifteen-minute tick; shutdown closes DB before stopping worker | `server/server.go:53-61`, `server/server.go:73-84`, `api/api.go:117` | Give each refresh its own bounded context; test periodic refresh and shutdown/restore exclusion. Existing tests do not protect these lifecycle requirements. |

**Upgrade gate:** compare synthetic old/new DB counts/identities/positions/credentials and file digests, exercise KO/OPDS, interrupt migration/backup/restore, and rehearse rollback with matching binary + DB + files. Added revision/receipt tables can be ignored by old binaries, but old writers bypass revision tracking; binary downgrade with new-browser pending events is not automatically safe. Define support/version gating and a recovery procedure before rollout. Existing production dataset qualification is deferred; none was accessed here.

## 5. OpenAPI: Schema-First Versus Code-First

### Two viable options

- **Ideal: schema-first OpenAPI + generated strict Gin adapter/types + generated TS types.** Public contract review is independent of handler/SQL structure; binary/security/error semantics are explicit. This best matches the approved direction. More tooling and separate runtime validation are the cost.
- **Pragmatic fallback: Huma code-first on the existing Gin router**, exporting a deterministic reviewed OpenAPI artifact and generating the same frontend bindings. It can satisfy the same public contract and later hand ownership to a schema-first spec; route/DTO review and drift checks must prevent Go internals becoming the contract. This is an alternative source of truth, not a second maintained schema.

Do not replace Gin just to get a schema. Do not use comment-only Swagger generation as the source of truth: annotations that document handlers without enforcing bodies/responses leave the existing contract problem in place. Huma is the meaningful code-first comparison because it ties typed inputs/outputs and validation to registration.

| Criterion | `oapi-codegen` schema-first | Huma code-first |
| --- | --- | --- |
| Contract authority | Reviewed OpenAPI; generated Go interface makes missing operations compile-visible | Go operation registration/input/output structs generate OpenAPI; review exported artifact as public API |
| Existing Gin integration | `models`, `gin-server`, `strict-server`, `embedded-spec`; isolated route group | `humagin.NewWithGroup` wraps existing Gin engine/group; no framework replacement required [H2] |
| OpenAPI versions | Released 2.8.2 documents **3.0 and 3.1 support**, including 3.1 nullability; old blanket claims of “3.0 only” are obsolete [O1] | Produces 3.1 and exposes a 3.0.3 downgrade [H1] |
| Runtime validation | Strict response/request Go types are not full runtime validation or authentication. Add Gin/kin-openapi request validation and application authorization [O1, O2] | Built-in request validation from typed schema/tags; security declaration still needs actual authentication/authorization; customize default errors if choosing a common envelope [H1, H3] |
| Binary/multipart | Strict server supports readers/multipart and non-JSON responses; prove bounded streaming, headers, ranges and rejection paths, not merely generated compilation [O1] | `huma.StreamResponse` provides callback-based streaming [H4]; uploads and explicit response schemas/headers need the same proof. Avoid undocumented output merely because streaming bypasses ordinary response encoding |
| Maintainability | Explicit DTO mapping; verbose generated code is acceptable; avoid template overrides and speculative split-spec packages | Less generator glue, but schema semantics can be distributed across tags, registration hooks and custom schema code |
| CI | Pin schema/generator/runtime/validator together, regenerate Go+TS, fail drift, validate live traffic | Export schema without starting a production server/DB, fail artifact drift/breaking changes, generate TS, validate live traffic |

**Proposed starting format: OpenAPI 3.0.3**, with named DTOs and uncomplicated composition. This is the smallest sufficient contract, **not** an assertion that current `oapi-codegen` cannot handle 3.1. Choose 3.1 only if a present schema requirement needs it and the entire pinned generator + validator + TS toolchain proves it. Do not assume JSON Schema 2020-12 features work identically across generators and runtime validators.

### Concrete backend candidate set and compatibility trap

- `github.com/oapi-codegen/oapi-codegen/v2` **v2.8.2** (declares Go 1.25.0); `github.com/oapi-codegen/runtime` **v1.8.0** (declares Go 1.24.0); `github.com/oapi-codegen/gin-middleware` **v1.2.1** (declares Go 1.25.0). These are proposed proof pins, not installed dependencies [O1–O4].
- **Adding that middleware selects Gin 1.12.0 and kin-openapi 0.152.0**, not the repository's Gin 1.10.1. `oapi-codegen`'s module lists kin-openapi 0.142.0; Go's module selection must be examined as one resolved graph. This is a real backend upgrade surface, not “just a dev generator” [O2, O3; `go.mod:11`].
- The released generator documents a case-insensitive second-decode validation bypass and its fix: strict binding of the retained validated value needs runtime ≥1.8.0, kin-openapi ≥0.151.0 and appropriate middleware (`gin-middleware` ≥1.2.1). Keep limits/body wrappers **before** validation; replacing the body afterward loses the validated value. Include mixed-case and duplicate-key adversarial requests in acceptance [O1].
- Explicitly set `allow-remote-refs-from: []`: the released 2.8 line defaults to permitting remote references; deterministic CI must not fetch arbitrary schema URLs [O1].
- Avoid loading the generator into the application module merely for convenience if that expands production dependency selection. An isolated pinned tools module/executable is reasonable; runtime + validator still belong to the application graph and cannot be isolated away. Do not manually force Gin 1.10.1 under a dependency requiring 1.12.0.
- Alternative Huma **v2.40.0** declares Go 1.26.0 and Gin 1.12.0; it does **not** avoid that Gin upgrade [H2]. Upgrade session/middleware/OPDS behavior must be tested for either option.

Use released/tagged docs, not `main`: upstream `main` already describes different Go requirements. A source-level compatibility matrix is not proof that the resolved project compiles or behaves correctly.

### Public contract requirements — proposed

- `/api/v1` is distinct from `/api/ko` and `/api/opds`. Declare relative deployment paths/servers consistently and prove prefix/host handling behind a proxy. Gin middleware warns that schema `servers` can accidentally reject valid requests by Host [O2].
- Intentional request/response DTOs; do not export SQLC user rows, auth hashes, stored basepaths or query-internal types. Identifiers are opaque strings; do not assume UUIDs or replace existing partial-MD5 book identity. Large integer identifiers/revisions need an explicit JSON/JS-safe representation, preferably opaque decimal strings if unbounded.
- UTC RFC3339 timestamps; separate occurrence and acceptance times; IANA timezone names for settings/statistics. Progress ratios use **0–1** on the wire (matching stored KO values), with UI percentage conversion; reject non-finite/out-of-range numbers and invalid durations.
- Declare absent versus null versus empty distinctly. For PATCH, prove omitted/no-change versus explicit-clear across Go and TS rather than relying on a pointer that collapses both. Do not globally skip optional pointers for nicer generated code.
- Stable operation IDs, documented pagination/sort/filter bounds and tie-break ordering, bounded batches/uploads, allowed content types, unknown-field policy, and no implicit framework defaults becoming API policy.
- Proposed common error response: `application/problem+json` with status, stable application `code`, safe detail, optional field errors/request ID. Return 401 unauthenticated, 403 forbidden, 404 unknown resource, 409 conflict (or explicitly chosen 412 for preconditions), 413 oversized, 415 unsupported media, and deliberate validation status. No stack/path/credential leaks. Validation's 400 versus 422 and conflict's 409 versus 412 need one decision for both tool options.
- Explicit cookie security scheme and per-operation authorization. Authentication runs early enough to emit correct 401/403; validator `AuthenticationFunc` must enforce/reuse the authenticated principal, not be a success-only placeholder. Middleware defaults can flatten security failures into 400 [O2]. Never rely on generated scope context alone.
- Binary contracts cover EPUB/cover/backup content types, `Content-Disposition`, `Content-Length` when known, range/conditional responses where supported, cancellation and JSON errors **before** streaming begins. Never buffer a whole backup just to satisfy a generated type.
- Resource coverage includes sessions/current user/capabilities, library/files/covers/uploads/edit/delete/metadata/acquisition, dashboard/statistics/history/devices/settings, reading events/progress/conflicts, and admin users/logs/import/backup/restore/maintenance. A generated library GET is not parity for all these workflows (`docs/frontend-migration.md:57`).

### Generator proof acceptance — definition only; not run

Use synthetic files/SQLite and a minimal standalone harness only after approval. Test both options against the same contract, not separate “hello world” demos.

| Representative operation | Required evidence |
| --- | --- |
| Paginated document read | Authenticated same-origin cookie call; nullable metadata; stable pagination/sorting; no SQL/private fields; anonymous 401, unknown ID 404; TS request and success/error narrowing compile without casts |
| Reading mutation | Durable event ID, device ownership, ratio/time validation, transactionally accepted activity/progress, stable duplicate acknowledgement, changed-payload conflict, stale revision, intentional backward move, DB reopen/retry |
| Validation/error path | Missing/unknown/wrong-case/duplicate fields, absent/null/empty, invalid enums/timezones/bounds, malformed JSON, wrong media, too-large body, expired session, CSRF/admin denial; zero mutation on rejection; one safe error envelope |
| Binary operations | Download known synthetic EPUB and compare bytes; cover and backup headers; multipart upload with metadata; 206/304/416 if promised; pre-stream 401/404/413/415; interrupted/slow transfer and memory ceiling; content-type-correct client Blob/stream path |
| Tooling integration | Exact version/tool graph recorded; Gin/session integration and cancellation pass; no generated-file edits/template overrides/`any` casts to hide type gaps; generation twice byte-identical; deliberate schema drift fails CI; intentional response violation fails contract test |

Accept only if Go+TS compile, request validation and authentication really run, response validation tests catch drift, application invariants hold after retry/restart, and binary paths remain bounded. Generated compile-time types alone do not validate outbound schema constraints or runtime TS responses. If a binary route must use a handwritten adapter, it still belongs to the same schema/authorization/contract tests; quantify that exception before accepting the generator. No proof is complete merely because a generator supports a feature in documentation.

## 6. Frontend Foundations — Concrete Proposals, Not Installed Packages

Package versions below were read from public registry/release metadata during this evaluation (`_scratch/evaluation/backend-tooling/versions.json`). Pin exact versions in the eventual lockfile; no `@latest` in reproducible builds. Recheck peer/engine/security compatibility at approval because these are candidate versions, not a tested install.

### Recommended small stack

| Concern | Proposed choice | Reason / tradeoff |
| --- | --- | --- |
| React | `react` + `react-dom` **19.3.1**, matching React 19 type packages | Current matched pair; ReactDOM's peer requires React `^19.3.1`. Reader imperative effects must tolerate development StrictMode setup/cleanup repetition. No React Server Components or production Node needed. |
| TypeScript | **5.9.3**, strict, `noUncheckedIndexedAccess`, deliberate optional-property semantics | **Do not blindly select current TS 7.0.2**: `openapi-typescript` 7.13.0 declares TS `^5.x`. TS 5.9.3 is a compatible candidate rather than an unproved major upgrade [F1]. |
| Build | Vite **8.3.8**, `@vitejs/plugin-react` **6.3.0**, pinned Node **22.23.4** candidate | Vite/plugin require Node `^20.19.0 || >=22.12.0`; plugin requires Vite `^8.0.0`. Inspect optional peer metadata before lock. Local Node satisfies these engines; this is not a build proof [F2]. |
| Router | React Router **8.5.1**, **Data Mode**, explicit lazy route modules | Retains control over Vite/static Go hosting; useful error boundaries, navigation and scroll handling without a full-stack framework. This release requires Node ≥22.22.0 and React/DOM ≥19.2.7, satisfied by candidate pins. Loaders may prefetch Query, not maintain another server cache [F3]. |
| Server state | `@tanstack/react-query` **5.107.1** | React 18/19 peer range includes candidate. Keys include server/account/filter inputs; cancel/clear on identity change, set deliberate retry/stale policy. The transport wrapper must throw/map HTTP errors—an `openapi-fetch` resolved `{ error }` is not query success. Never use persisted query mutations as the durable reading outbox [F4]. |
| API binding | `openapi-typescript` **7.13.0** + `openapi-fetch` **0.17.0** | OpenAPI 3.0/3.1 types plus small fetch client; one wrapper supplies credentials, CSRF, cancellation, problem mapping and binary parsing. Generated types are runtime-free; validate server responses in contract tests and critical client envelopes as necessary, not with unsafe casts [F1]. |
| UI | Native semantic controls first; Radix Dialog **1.3.1** and only required sibling primitives; CSS Modules + shared CSS custom-property tokens | Unstyled accessible primitives support a ground-up design without a theme imposed by a component framework. Pin/update Radix primitives together; portal/focus/reader-iframe interaction still needs tests. CSS Modules require more design work but avoid a new CSS browser floor [F5]. |
| Persistence | Dexie **4.4.7** over IndexedDB; EPUB blobs and metadata/outbox in the same durable owner | Transactions/indexes/schema upgrades and cross-tab observations fit the requirements. Prefer one IDB transaction for book blob + availability metadata, avoiding a cross-API atomicity problem. No Dexie Cloud or third-party sync service [F6]. |
| PWA build | `vite-plugin-pwa` **2.0.0**, custom `injectManifest` worker; compatible Workbox **7.4.1** candidate pins | Plugin peer includes Vite 8. Precache app assets only; no blanket authenticated GET caching or automatic reload during reading. Custom worker makes routing/book/update policy reviewable [F7]. |
| Tests | Vitest **5.1.0**, Testing Library, Playwright **1.65.1** candidates | Vitest peer includes Vite 8 and engine includes Node ≥22.12 within the 22 line. DOM tests for controls, real browser tests for EPUB/IDB/SW; pin matching browser binaries and coverage packages. Testing Library/remaining primitive versions still need lock resolution. |

**Two options for frontend scope:**

- **Ideal:** the stack above with tested account-scoped persistence, coordinated replay, accessible design tokens/components, and a custom worker whose update behavior is qualified on real devices.
- **Pragmatic:** start with the same React/Vite/router/query/API/persistence boundaries, CSS Modules/native controls and only one needed Radix primitive; defer optional UI/worker automation until its acceptance tests exist. This reduces initial dependency surface without replacing the required durability architecture. A “query cache plus localStorage queue” is not an acceptable shortcut.

### Alternatives and compatibility tradeoffs

- **TanStack Router 1.170.46** is the credible router alternative: typed path/search parameters and code/file routing suit complex library filters. Its React ≥18 and Node ≥20.19 metadata fits the candidates. Cost: additional route typing/conventions and possibly a router plugin/version coupling; its loader cache must not compete with Query. React Router Data Mode is the simpler proposed default; decide based on evaluated navigation/filter needs, not brand consistency with Query [F3].
- **Tailwind 4.3.5 + targeted Radix/shadcn** is viable if the approved design team prefers utility styling. Tailwind v4's documented core floor is Safari 16.4, Chrome 111, Firefox 128; Vite transpilation cannot fix unsupported CSS. shadcn distributes application-owned component source, not a maintenance-free UI binary. Do not import a dashboard kit as the information architecture or mix two styling foundations without a concrete need [F5].
- **idb 8.0.4** is the smaller persistence alternative: close to native IndexedDB and sufficient for transactions, but the team owns more schema/query/subscription plumbing. Dexie earns its extra API only if indexed outbox/library queries and cross-tab reactivity are used. Neither solves eviction, replay correctness, or account policy.
- **MUI/Mantine** would accelerate broad CRUD/admin widgets but add a stronger visual system and larger surface; no observed need yet justifies them over a small unstyled foundation. Redux/Zustand, Axios, and universal form/schema libraries are not baseline requirements: React local state + router + Query + persistence have named owners already.
- No framework mode/SSR server is required, but React Router framework mode can also build static SPAs; reject it for unnecessary conventions here, not on the false premise that it always needs Node in production [F3].

### Storage/update policy requirements — proposed

1. New browser DB starts at version 1 with typed local-only versus server-linked identity. Store EPUB blobs, download lifecycle (`downloading`, `available`, `failed`), local position and immutable events. Make complete bytes + availability publication atomic where possible. Cache Storage owns hashed app shell, not authoritative reading state.
2. Outbox includes immutable event ID, origin/account/document/device, schema version, occurrence time/sequence, payload and replay state. Claim batches transactionally with an expiring/fenced lease; Web Locks may optimize but cannot be the only correctness mechanism. A stale replay response cannot delete a changed/new event. BroadcastChannel is notification, not durable locking.
3. Retry startup/foreground/reconnect with bounded backoff; distinguish auth-required, retryable transport/server failure, permanent invalid event and progress conflict. Commit valid acknowledgements before deleting individual events; pause account replay on 401/403. Background Sync is optional acceleration.
4. `navigator.storage.estimate()` and `persist()` are advisory capabilities, not guarantees. Surface quota failures and missing blobs; do not promise indefinite durability against user clearing, private-mode deletion or browser eviction. New local-only books/unsent events need an export/recovery policy because they may have no server copy [F6].
5. Logout/account switch stops claims/in-flight delivery and removes derived Query data. Whether downloaded remote books and queued events are retained, deleted or explicitly resolved needs approval; no silent cross-account replay or loss. Do not expose cached remote books to another account just because cookies changed.
6. Separate app-shell update, book download, browser DB upgrade and server API compatibility. Prompt/defer activation during active reading; avoid unconditional `skipWaiting`/forced reload. Record schema/API compatibility in capability checks; a stale app must not send incompatible events silently.
7. Legacy worker cleanup is a one-time retirement/reset, **not data migration**. Existing `/sw.js` and root registration must deliver a working replacement/retirement path and remove known legacy app caches (`assets/common.js:35`, `assets/sw.js:3`). Avoid indiscriminate ongoing cache/IDB deletion that could destroy data created by the new app. Preserve installed identity/deep links only as approved navigation contracts, not legacy browser state.

Browser floor remains unapproved. Propose initially qualifying iOS/iPadOS 17+ installed Safari, supported Android Chromium, and current desktop Safari/Chromium/Firefox, then record exact versions and physical devices. Tool transpilation targets, CSS floor, installed-PWA behavior and storage API support are separate constraints; desktop Playwright WebKit is not a physical iOS PWA result.

## 7. Security Requirements and Static Findings

These findings are static evidence, not a penetration-test report. Fixing known defects is not automatically an approved public behavior change; proposed corrections must be named and tested.

| Area | Confirmed finding | Proposed requirement / acceptance |
| --- | --- | --- |
| Session authenticity and lifetime | Signed cookie store, optional encryption, seven-day max age, strict SameSite; random signing key if config absent (`api/api.go:69-100`). `getSession` refreshes near expiry but does not explicitly reject its stored expired timestamp (`api/auth.go:351-395`). | Production TLS, Secure/HttpOnly, host-only cookie/path, stable strong key with intentional rotation; authoritative expiry/revocation independent of browser cooperation. Do not store auth secrets in JS/localStorage. Test restart, expired/tampered cookies, key rotation and refresh. |
| Key handling | Config lowercases/trims signing/encryption keys (`config/config.go:67-68`) | New code preserves secret bytes; diagnose weak/invalid keys. Changing this normalization can invalidate existing sessions: document intentional re-login/rotation, not DB/password migration. |
| Privilege freshness/cache | `userAuthCache` is an ordinary map read/written in request paths (`api/api.go:32`, `api/auth.go:43`, `api/auth.go:397`). Cookie carries admin flag; admin-only changes do not necessarily rotate auth hash; admin password update rotates DB hash without updating that map (`api/app-admin-routes.go:859-917`). | Race-free principal lookup/cache and coherent invalidation on password, role, delete, restore. Prefer authoritative DB role/revocation checks initially over an unnecessary cache. Test demotion/deletion/password change with already-authenticated concurrent requests. |
| Self-service password | New password changes password hash without auth-hash rotation (`api/app-routes.go:885-914`) | Require current password as appropriate; revoke/rotate sessions under an approved policy; do not change KO credential representation silently. Login throttling and bounded Argon2 concurrency protect resource use. |
| Administrator invariants | First-user/last-admin checks and changes are separate DB calls (`api/auth.go:212-234`, `api/auth.go:313-335`, `api/app-admin-routes.go:796-810`, `api/app-admin-routes.go:881`) | Transactional first-admin creation and last-admin protection, including concurrent requests; DB row is authority. Avoid self-service settings rewriting a stale cookie role. |
| CSRF | Global session middleware, SameSite Strict, GET logout; no CSRF middleware is installed in the inspected composition (`api/api.go:56-100`, `api/api.go:156`) | POST logout and explicit CSRF protection for cookie-authenticated mutations, including login/registration and multipart/admin operations. Proposed session-bound token/custom header plus origin/fetch-metadata checks; never blanket CORS. Go 1.26 also has `http.CrossOriginProtection`; evaluate as a simpler modern-browser option with explicit proxy/origin policy rather than assuming SameSite suffices. The standard guard permits safe methods and requests missing both headers; sensitive-operation fallback policy must be explicit [S1, S2]. |
| KO browser access | KO middleware accepts cookie sessions before credential headers (`api/auth.go:52-81`) | New web writes use `/api/v1`, not KO endpoints. Protect cookie-authenticated compatibility writes against browser CSRF without requiring browser-only tokens from real KO clients; distinguish explicit credential auth and qualify unchanged external clients. This is an unresolved policy surface, not permission to disable KO auth compatibility. |
| Authorization | Web mutations are authenticated but library is shared; device IDs global; feature gates registered per transport (`api/api.go:169-211`, `database/query.sql:353`) | Check operation/role/feature/device ownership server-side. Never infer private-book ownership or admin rights from client data. Audit demo restrictions across **all** new admin/search/sync operations; decide gaps explicitly. |
| Content isolation | EPUB renderer allows scripted content and injects CSP via a spine hook to work around Safari sandbox/listener issues (`assets/reader/index.js:150`, `assets/reader/index.js:335-362`) | Treat EPUBs/metadata as untrusted. Prove scripts/event handlers/links/remote loads cannot access app cookies/storage/parent DOM or mutate API state. Late meta-CSP is not evidence of sandbox isolation. Prefer disabled content scripting and restricted/sandboxed document context; if same-origin engine access is unavoidable, prove safe pre-render sanitization/CSP and real Safari behavior or choose stronger origin/controller isolation. |
| Upload/archive safety | Web upload has MaxBytesReader and metadata/archive checks; tests cover malformed/oversized/forged archives (`api/app-routes.go:429-460`, `metadata/archive.go:21`, `metadata/archive_test.go:80`). KO parses multipart before document-reader limit (`api/ko-routes.go:462`, `api/ko-routes.go:489`). | Uniform pre-parse HTTP limits and bounded decompression/entry counts/CPU/temp storage across web/KO/import/restore; multipart memory threshold is not a body-size limit. Verify rejection causes no partial published file/row. |
| Path safety/restore | Linked basepath downloads are supported; restore path validation/destructive order is unsafe as described above (`api/common.go:39-45`, `api/app-admin-routes.go:594-716`) | Resolve paths inside approved managed/import roots, handle symlinks/traversal, sanitize attachment names, stage file writes; privileged import roots remain intentional capabilities. Never blanket restrict linked imports to DataPath and silently break existing books. |
| Outbound operations | Provider/cover code calls default `http.Get` (`metadata/gbooks.go:140`, `metadata/olib.go:43`) | Bounded context-aware HTTP clients, response/redirect/size limits; restrict acquisition/provider URLs and block unintended private-network access where URLs are user/provider controlled. Log safe classifications, not credentials/full private URLs. |
| HTTP hardening | `gin.New` installs custom logging/sessions but no recovery middleware; `http.Server` only sets Handler/Addr (`api/api.go:47-56`) | Panic recovery with safe errors, trusted-proxy policy, header/read/idle limits and operation-specific streaming deadlines. TLS termination/HSTS policy, CSP, `nosniff`, frame/referrer policy; no global short WriteTimeout that breaks backups/uploads. Redact auth/cookies/log data. |

No auth/storage policy should make local-only reading depend on a session. Same-origin deployment reduces CORS complexity but does not remove CSRF/XSS/content-isolation requirements.

## 8. Existing Tests: Disposition by Protected Contract

Authority: the approved direction preserves server persistence/security/upload/statistics/compatibility, not SSR markup or exact display formatting (`docs/frontend-migration.md:245`). Proposed disposition applies when the owning structure changes; **nothing is deleted or adapted in this evaluation**. Until then existing tests remain active. New contract tests supplement preserved tests rather than replacing them with mocks of internal collaborator calls.

### Preserve — module-level decisions

| Module/tests | Protected contract and evidence | Limits / required additions |
| --- | --- | --- |
| Database document suite (all six methods) | Query lookup/upsert, soft delete, deleted/wanted/missing document discovery (`database/documents_test.go:45-115`) | Keep persistence assertions. Missing-ID/empty-input cases, deleted filtering, stable ordering and import basepath compatibility need more tests; commented empty-slice case is not coverage. |
| Database manager suite (`TestDevice`, `TestActivity`, `TestGetDailyReadStats`) | Device persistence, user/document activity filtering, daily minute buckets (`database/manager_test.go:107-171`) | Does not test cross-account device collisions, idempotency, old migrations or DST/day boundary behavior. Time-relative fixtures need deterministic edge cases. |
| Database user suite (all seven methods) | CRUD, missing-row deletion result, statistics participation and daily/weekly streaks (`database/users_test.go:65-205`) | `TestGetUserStatistics` checks row count, not aggregate accuracy; preserve intent and add exact totals/timezone boundaries. CRUD is not password verification/admin/security coverage. |
| Metadata EPUB/type tests (four) | Checked-in Alice fixture metadata/type/word count and reader-based type detection (`metadata/metadata_test.go:10-45`) | Exact count is an extraction regression, not permission to reject other valid EPUB layouts. Add synthetic international/malformed content; avoid private fixtures. |
| Metadata archive tests (seven) | Valid mimetype placement, unsupported/malformed rejection, compression/count/size/forged-size limits (`metadata/archive_test.go:48-161`) | Useful error assertions, not just success booleans. Some limits use internal archive objects (`metadata/archive_test.go:106`); retain focused limit tests and add actual HTTP archive boundaries. No proof of browser content isolation. |
| Google Books tests (three) | Provider ID/ISBN/title query encoding and decoded title/author/description/ISBNs (`metadata/gbooks_test.go:62-124`) | URL interception is not their only assertion. Add timeout/rate/error/empty-body cases; no real-network tests in CI. |
| Document hash utility tests (two) | Stable partial/full MD5 identities for interoperability (`utils/utils_test.go:8-25`) | Preserve both identities. Add position/book fixtures and small/large-file edge cases; do not replace identity with random frontend IDs. |
| Config `TestGetEnvDefault`, `TestTrimLowerString` | Environment fallback and normalization helper behavior (`config/config_test.go:15-27`) | Keep helper semantics for booleans/names; secret fields must stop using that helper. Add separate secret-byte preservation tests. |
| `pkg/ptr.TestOf`, `pkg/sliceutils.TestFirst` | Value pointer and first/empty slice semantics used by current callers (`pkg/ptr/ptr_test.go:7`, `pkg/sliceutils/sliceutils_test.go:7`, `database/documents.go:21`) | Retain while production callers exist. These are not API/domain acceptance tests. |

### Proposed changes — one row per changed test

| Test | Decision | Protected contract / reason and replacement owner |
| --- | --- | --- |
| `api.TestDocumentUploadError` (`api/upload_test.go:12`) | **Adapt** | Unsupported/invalid/oversized/internal failures retain deliberate HTTP classes. Move shared error classification out of SSR handler internals; assert stable problem codes and add HTTP multipart tests for both accepted files and no-side-effect rejections. Existing non-empty-message check does not validate correct reason. |
| `api.TestNiceSeconds` (`api/utils_test.go:9`) | **Replace** | Duration display belongs to new frontend formatting; test zero/unknown and accessible duration output there. Exact old `22d…`/`N/A` spelling is not approved UI parity. Delete old helper when SSR has no caller. |
| `api.TestNiceNumbers` (`api/utils_test.go:20`) | **Replace** | Numeric display/units/accessibility belong to frontend formatter tests; API returns raw numeric values. Do not keep backend abbreviated strings to preserve this test. |
| `graph.TestGetSVGGraphData` (`graph/graph_test.go:7`) | **Replace** | Exact generated SVG path is SSR geometry, called via template helper (`api/utils.go:110`, `templates/pages/home.tmpl:13`). New chart tests protect accurate series/labels and accessible equivalent data; preserve SQL statistics tests, not obsolete curve strings. Remove unused graph package with retired caller. |
| `config.TestLoadConfig` (`config/config_test.go:10`) | **Adapt** | Configuration defaults remain a requirement, but test currently calls global logger/directory setup and asserts only DB type. Isolate env and temp config/data paths, assert security defaults/paths/flags and explicit bad-key behavior at config seam. |
| `config.TestPrettyCaller` (`config/config_test.go:29`) | **Adapt** | Diagnostic package/function identification remains; literal test-file line 30 is incidental. Assert useful sanitized package/file/function structure without a fixed source line. |
| `pkg/formatters.TestFormatDuration` (`pkg/formatters/duration_test.go:8`) | **Remove** | No production callers found; presentation formatting belongs to frontend. Deliberately drop this unused Go API and its helper, with frontend duration requirement covered by the replacement of `TestNiceSeconds`. Deprecation comments naming it are not callers. |
| `pkg/formatters.TestFormatNumber` (`pkg/formatters/numbers_test.go:7`) | **Remove** | No production callers found; frontend number-format contract replaces it with `TestNiceNumbers` replacement. Remove unused Go helper, not introduce an adapter to use it. |
| `pkg/utils.TestTernary` (`pkg/utils/utils_test.go:7`) | **Remove** | No production caller found for generic helper. Deliberately drop unused helper contract; no application behavior/coverage replacement needed. Optional adjacent cleanup, not a migration blocker. |
| `pkg/utils.TestFirstNonZero` (`pkg/utils/utils_test.go:21`) | **Remove** | Same unused-helper finding; remove subject and test together, not preserve speculative utility. No live application requirement dropped. |
| `pkg/ptr.TestDeref` (`pkg/ptr/ptr_test.go:28`) | **Remove** | No production `Deref` caller found; retain used `Of`, remove unused `Deref` with its tests. No live application requirement dropped. |
| `pkg/ptr.TestDerefZeroValue` (`pkg/ptr/ptr_test.go:60`) | **Remove** | Duplicates nil cases in `TestDeref` and has no live caller. Deliberately drop unused helper contract with subject; do not count duplicate assertions as migration coverage. |
| `pkg/sliceutils.TestMap` (`pkg/sliceutils/sliceutils_test.go:29`) | **Remove** | No production `Map` caller found; retain used `First`. Drop unused generic helper/test together; no live application requirement dropped. |

Call-site searches are static and must be repeated at the implementation boundary because other work may add a real caller. No `Investigate` row is used to disguise an unapproved policy as a test decision: new error/conflict/auth contracts remain explicitly pending approval. Adapt/replace assertions inherit their final shape from that approval, not this green baseline.

### Missing contract tests with highest value

- Router-level sessions, password/role/delete revocation, first/last-admin concurrency, CSRF including login/logout/upload, demo/search/registration gates, two-account device isolation, and safe error redaction.
- Shared reading operation transactions: duplicate delivery after lost acknowledgement/restart; changed-payload ID reuse; partial-batch handling; stale progress versus KO write; backward movement; invalid event leaves no credited activity.
- File-backed fresh/old schema upgrades, WAL backup/restore, separate config/data roots, linked imports, malicious archive paths, interrupted publication/restore, rollback and worker shutdown.
- KOReader/KOSync and OPDS HTTP wire fixtures: headers/credentials, response/status/content type, missing-progress behavior, position payloads, feed links/search/download/ranges. Neither passing SQL tests nor TS-generated client tests establish external compatibility.
- New API conformance tests validate actual successful/error responses against OpenAPI; frontend transport tests fail non-2xx rather than acknowledge them; generated contract changes fail drift checks.
- Browser renderer lifecycle/position round trips, quota/failure/restart durability, multiple tabs, account switch/auth expiry, interrupted downloads, stale service worker and API/browser-schema upgrades; physical iOS/Android installed-PWA qualification and accessible mobile controls.

Before declaring the redesigned suite trustworthy, introduce approved faults at the owning seam (or in disposable scratch copies): bypass auth, remove receipt uniqueness, acknowledge 500, skip file availability commit, overwrite stale progress, omit migration, permit archive traversal. Each named contract test must fail for its fault. Record survivors; no coverage-percentage target substitutes for this evidence.

## 9. Packaging, Deployment and CI

### Confirmed baseline

- Go embeds `templates/* assets/*`; development reads repository filesystem (`main.go:16`, `main.go:44`). The root npm package only has a Go-template Prettier plugin (`package.json:1-7`). No React build/TS check/OpenAPI generator exists. SQLC is already configured separately (`sqlc.yaml:1`); generated query code identifies SQLC 1.29.0 (`database/query.sql.go:1-4`). Pin and drift-check that existing generator too; OpenAPI does not replace SQLC.
- Make builds Tailwind before local/container targets; Dockerfiles themselves compile Go without a frontend build stage (`Makefile:1`, `Makefile:36`, `Dockerfile:13`, `Dockerfile-BuildKit:16`). A clean Docker build cannot be assumed to run a future Vite build implicitly.
- Runtime images are BusyBox with certificates/timezones copied in, no Node, no explicit non-root `USER` (`Dockerfile:1-28`). Preserve CA/timezone support for provider TLS and user statistics.
- Gitea CI runs `make tests` then builds/pushes linux/amd64; same-repository PRs can publish PR-tagged images; fork PR publishing is excluded (`.gitea/workflows/ci.yaml:8-31`, `.gitea/workflows/ci.yaml:66`). Local release Make targets advertise amd64/arm64 and native Darwin binaries (`Makefile:6-9`, `Makefile:14-32`), a wider matrix than CI proves.

### Proposed target packaging

**Ideal:** a clean checkout produces pinned npm assets, checked/verified generated Go+TS, an embedded Go binary, and a multi-stage OCI image with no runtime Node. One dependency graph/lock per frontend and explicit build order: contract generation/check → frontend typecheck/tests/build → Go embed/build. Native and container release paths consume the same dist layout. Build output is absent or invalid → build fails, not a successful binary with stale assets.

**Pragmatic:** retain the existing Make/Docker entry points, add a pinned Node builder stage and a dist prerequisite for native builds, and keep generated Go/TS in source control with drift checks. This reaches the same packaging end state without introducing Nix-only builds or a separate asset service. Generated files are never edited by hand; dist need not be committed. No production Node server/CDN dependency.

- Version source should be explicit/reproducible (release metadata/build arg), not require `.git` inside Docker. Pin build/runtime images or digests and refresh deliberately; record Go/Node/npm/generator versions in artifacts.
- Preserve certificates, timezone data, writable config/data/temp directories and expected volume layout. Qualify non-root UID/GID and existing volume permissions before changing defaults. Prove static/pure-Go cross-build assumptions on release architectures rather than inferring them from modernc SQLite alone.
- Go serves `/api/v1`, `/api/ko`, `/api/opds`, binary resources and compiled app under one origin. Allowlisted frontend GET/HEAD navigations can fall back to `index.html`; unknown API routes/methods and missing assets return appropriate 404/405, never 200 HTML. Test `/reader`/existing document links and proxy/base-path policy explicitly.
- Hashed immutable assets: long immutable caching. HTML, manifest/update metadata and `/sw.js`: revalidate/no-cache as appropriate; `/sw.js` keeps its root scope. Auth/session/admin responses: `no-store`; downloaded books are persisted deliberately in account-scoped browser storage, not by a generic API cache.
- Development Vite proxy preserves same-origin request semantics without enabling permissive production CORS. Use local-only credentials/config and disable production SW registration during ordinary HMR; real worker behavior belongs to a production-build browser test.

### Proposed CI gates

1. Unprivileged PR job: pinned `npm ci`, schema lint/bundle (local refs only), deterministic OpenAPI/SQLC generation, generated-artifact drift and OpenAPI breaking-change checks. Explicitly include new/untracked outputs in drift detection, not only `git diff` of existing files. A clean generated scratch tree comparison can avoid mutating checkout state.
2. Go unit/integration/race/vet + frontend `tsc --noEmit`, lint, Vitest/Testing Library, production frontend build. Vite transpilation alone is not typechecking [F1]. Add `govulncheck`, npm dependency/security/license checks and secret scanning under an approved failure/exception policy.
3. HTTP schema/security/KO/OPDS tests plus synthetic old-schema/file-backed migration/recovery fixtures. E2E launches the embedded production binary, not only Vite's dev server; browser tests cover deep links, assets/404s, headers, offline reopen and SW upgrades.
4. Build smoke tests on published architectures and a cold source checkout; container starts under its intended user and serves embedded assets with correct headers. Publish OpenAPI artifact, checksums, SBOM and build provenance as approved release outputs.
5. Registry credentials/publishing isolated from untrusted PRs; review existing same-repo PR publishing trust, pin actions, minimize job/token permissions. Do not couple correctness tests to access to package-publish secrets or private snapshots.

Do not declare M1 exit from these proposed gates. Container builds, release cross-compilation, package install, generated drift, runtime security and browser qualification remain unexecuted here.

## 10. Decisions Still Requiring Approval

| Decision | Proposed default | What prevents final acceptance |
| --- | --- | --- |
| Contract authority/tool pins | Schema-first 3.0.3 + strict Gin + TS types/fetch; Huma fallback | Representative generator proof; resolved Gin/runtime/validator graph and binary/error fidelity |
| Gin/dependency upgrade | Accept only the measured upgrade needed by selected runtime/validator | Current Gin 1.10.1 versus candidate 1.12.0; session/KO/OPDS/security regression evidence |
| Errors/unknown fields/nullability | Problem envelope, explicit required fields and PATCH clear semantics | Approve 400/422, 409/412, unknown/duplicate-field policy and bounded validation behavior |
| Progress conflict | Shared server revision, web preconditions, retain stale event for resolution; KO wire unchanged | Multi-device/KO ordering, deliberate backward move, user resolution and initial-version semantics |
| Activity idempotency/retention | Immutable web event IDs + transactional durable receipts | Batch atomicity, replay horizon/retention/storage limits and changed-payload behavior |
| Auth/session/CSRF | Cookie web auth, fresh roles/revocation, explicit CSRF defense, TLS | Key normalization/rotation/re-login, exact expiry/revocation and cookie-authenticated KO CSRF policy |
| Authorization/feature scope | Existing shared library and server-side capability gates | Explicit demo/admin/acquisition restrictions; no accidental per-user library redesign |
| Browser foundations | React 19.3.1, TS 5.9.3, Vite 8.3.8, React Router Data Mode, Query 5, CSS Modules/Radix, Dexie 4 | Lock/install proof and mobile interaction/design acceptance; TanStack Router/Tailwind are alternatives, not dual foundations |
| Account/logout storage | Account-scoped remote state, independent local-only books | Retain/delete/export pending events and downloaded books; identity changes/recreated accounts |
| Worker/browser floor | Custom worker, prompt/deferred activation, no legacy data migration | Concrete reset/update compatibility policy, physical iOS/Android coverage and supported OS/browser floor |
| EPUB isolation | Disable untrusted scripting and prove isolation before reuse | Real EPUB.js/Safari behavior; origin/DOM/CSP constraints; no inherited workaround approval |
| Maintenance operations | Exclusive safe restore; bounded cancellable import; streaming backup | Actual runtime durations, job vs stream/poll policy and crash recovery; do not invent a generic job system prematurely |
| Server upgrade/rollback | Additive side tables, preserve IDs/files/credentials, verified backup recovery | Supported old schemas, interrupted migrations, old writer/version policy; snapshot qualification deferred |
| Packaging/CI policy | Embedded same-origin Go binary, pinned frontend build, unprivileged tests | Release architecture matrix, non-root permissions, provenance/security gates, publishing trust |

No questions or implementation estimates are introduced here. These are approval dependencies for a future proof/implementation, not decisions silently taken by this report.

## Authoritative References

Versioned source takes precedence over changing “latest” documentation. Registry engine/peer metadata establishes declared compatibility only; it does not prove a successful project install/build.

- **O1:** [`oapi-codegen` v2.8.2 README](https://github.com/oapi-codegen/oapi-codegen/blob/v2.8.2/README.md): strict server, validation/security, 3.1 support, retained-value binding/security caveat and remote-ref configuration. [Tagged Gin docs](https://github.com/oapi-codegen/oapi-codegen/blob/v2.8.2/docs/gin-server.md).
- **O2:** [Gin middleware v1.2.1 module](https://github.com/oapi-codegen/gin-middleware/blob/v1.2.1/go.mod) and [validator implementation](https://github.com/oapi-codegen/gin-middleware/blob/v1.2.1/oapi_validate.go): dependencies, validated body, server-host matching, error handling.
- **O3:** [Generator v2.8.2 module](https://github.com/oapi-codegen/oapi-codegen/blob/v2.8.2/go.mod).
- **O4:** [Runtime v1.8.0 module](https://github.com/oapi-codegen/runtime/blob/v1.8.0/go.mod).
- **H1:** [Huma OpenAPI generation](https://huma.rocks/features/openapi-generation/).
- **H2:** [Huma v2.40.0 module](https://github.com/danielgtaylor/huma/blob/v2.40.0/go.mod), [Gin adapter](https://github.com/danielgtaylor/huma/blob/v2.40.0/adapters/humagin/humagin.go).
- **H4:** [Huma streaming responses](https://huma.rocks/features/response-streaming/).
- **H3:** [Huma v2.40.0 validation](https://github.com/danielgtaylor/huma/blob/v2.40.0/docs/docs/features/request-validation.md).
- **F1:** [openapi-typescript introduction](https://openapi-ts.dev/introduction), [openapi-fetch](https://openapi-ts.dev/openapi-fetch/), [7.13.0 registry metadata](https://registry.npmjs.org/openapi-typescript/7.13.0), [TS 5.9.3 metadata](https://registry.npmjs.org/typescript/5.9.3).
- **F2:** [Vite guide/engine and browser support](https://vite.dev/guide/), [Vite 8.3.8 metadata](https://registry.npmjs.org/vite/8.3.8), [React plugin 6.3.0 metadata](https://registry.npmjs.org/@vitejs/plugin-react/6.3.0).
- **F3:** [React Router modes](https://reactrouter.com/start/modes), [8.5.1 metadata](https://registry.npmjs.org/react-router/8.5.1), [TanStack Router comparison](https://tanstack.com/router/latest/docs/framework/react/comparison) (vendor-authored comparison; evaluate claims against actual needs), [1.170.46 metadata](https://registry.npmjs.org/@tanstack/react-router/1.170.46).
- **F4:** [TanStack Query installation/React support](https://tanstack.com/query/latest/docs/framework/react/installation), [5.107.1 metadata](https://registry.npmjs.org/@tanstack/react-query/5.107.1).
- **F5:** [Radix principles/accessibility](https://www.radix-ui.com/primitives/docs/overview/introduction), [Tailwind compatibility](https://tailwindcss.com/docs/compatibility).
- **F6:** [Dexie React/transactions and observation](https://dexie.org/docs/Tutorial/React), [MDN quotas/eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- **F7:** [Vite PWA injectManifest/update behavior](https://vite-pwa-org.netlify.app/guide/inject-manifest), [2.0.0 metadata](https://registry.npmjs.org/vite-plugin-pwa/2.0.0).
- **S2:** [Go CrossOriginProtection](https://pkg.go.dev/net/http#CrossOriginProtection): safe methods and missing-header behavior require explicit policy.
- **S1:** [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): cookies, tokens, fetch metadata, origin/proxy handling and Go cross-origin protection.

## Task-End Report

- **Assumptions made:** approved direction, not unapproved detailed policy, governs dispositions; shared library/KO credential and position identity remain contracts; checked-in and synthetic fixtures suffice for this static/tooling evaluation.
- **Decisions made autonomously:** selected representative proof candidates and conservative schema/TS compatibility defaults; ran existing tests/race/vet and a native embedded build only, with all outputs isolated to assigned scratch space.
- **Compromises and reasons:** no mutation, generator, install, runtime, snapshot, container, cross-architecture or physical-device proof; this task forbids implementation spikes/snapshot access and does not authorize changes. Accordingly, proposals are not acceptance evidence and M1 remains incomplete.

**Knowledge capture recommendation:** after tooling approval, capture the paired generator/runtime/validator dependency and body-validation invariant in project `AGENTS.md`; capture fresh-versus-existing schema ordering and backup/restore qualification in `database/migrations/README.md`. They are non-obvious correctness constraints, not generic style guidance.
