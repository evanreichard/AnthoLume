# React Frontend Migration

Status: M1 and M2 complete. “Looks good. Proceed” confirms revised compact Folio and approves the real vertical slice; M3 is in progress under the [bounded implementation handoff](evaluation/m3-boundaries.md). Earlier technical proof acceptance is unchanged. Mobile web browsing and reading are accepted by user review. This is not production approval.

## Goal and Scope

Replace Go-template web rendering with a ground-up redesign of the surrounding application in React/TypeScript while retaining AnthoLume's functionality. Redesign its information architecture, navigation, layouts and visual system rather than translating templates into components. Apply compact Folio density throughout: smaller headings, controls, cards, padding and mobile chrome maximize browsing/reading space without sacrificing legibility or accessible touch targets. Preserve reader interaction continuity outside theming: full-viewport paginated reading, not a ground-up scrolling reader, with tap/swipe/keyboard navigation, TOC, font/theme controls and logical-anchor restoration after resizing or repagination. Online mobile usability and KOReader interoperability are first-class requirements. Offline reading and installed-PWA qualification are out of scope for this migration milestone and do not block cutover. Existing downloads and browser data are not being removed by this scope change. Existing application screens are functionality evidence; current reader behavior is a continuity contract.

The selected approach is a full architecture and behavior evaluation before implementation. Delivery can then be incremental, but the end state has one web frontend, not permanently maintained React and SSR applications.

This document is the durable design and milestone tracker. Confirmed observations, proposed decisions, and unresolved contracts are distinguished below. Update acceptance evidence here as work completes; link detailed specifications and test reports rather than growing an unstructured task log.

## Success Criteria

- Every inventoried capability is preserved or explicitly changed with approval; surrounding-app screen organization may change, while reader interaction continuity remains required.
- The default Library combines authorized shared and local-only books, with cover source icons independent of offline-availability indicators. A featured Resume precedes the compact search row, with Add and Filter icons beside the input and a simple divider before library items. Use “Resume” on both feature and detail. Omit “On the shelves” headings and visible provenance legends; cover badges retain accessible source names. The filter popup/sheet exposes source and availability without permanent ownership tabs.
- Search/filter state and library position survive detail/reader return and Back; closing the filter popup/sheet restores focus without unexpectedly leaving the Library. Logout/account switching cannot expose retained server metadata through results, counts, covers or source filters; local-only books remain accessible.
- Reading fills the available viewport with paginated content and no vertical book-text scrolling. Increasing or shrinking text and changing viewport/orientation repaginate around the same logical anchor; tap/swipe/keyboard navigation, TOC and theme/font controls retain current-reader behavior.
- A coherent, mobile-first design system and information architecture replace the existing frontend, with deliberate desktop adaptations rather than enlarged mobile layouts.
- React owns the web UI; production web pages do not require Go templates.
- A versioned web API exposes the functionality previously available through SSR.
- OpenAPI describes requests, responses, errors, security, and binary operations; generated frontend bindings remain synchronized with it.
- Shared books open online. Reuse server-revalidated EPUB bytes in a bounded, account-scoped IndexedDB cache. Index the ZIP and validate its package/navigation on a cold open; validate each chapter and its assets before rendering, without unpacking the rest of the book first. Existing React local-only books are exportable without signing in; offline launch and new local-only imports are retired.
- Large books use disk-backed originals, range indexing, incremental integrity/validation and bounded lazy chapter/assets, with no full-book buffers. A temporary whole-book size cap is not the approved streaming/lazy target.
- Pending activity and progress survive interrupted saves and synchronize safely, independently of the EPUB cache.
- External KOSync remains compatible with its normative upstream contract; opaque progress storage is separate from KOReader CRengine client position mapping. SyncNinja extensions and OPDS remain compatible.
- Existing server databases, document/cover files, and KOReader/OPDS integrations remain compatible, with explicit server migrations where necessary.
- Legacy browser data requires no backward compatibility: local books, preferences, cached downloads, and pending events may be discarded. New-frontend storage durability remains a requirement.
- Deployment remains practical for self-hosting, without requiring a production Node server.

## Current Architecture: Confirmed by Static Inspection

| Area | Current structure and ownership | Evidence |
| --- | --- | --- |
| HTTP composition | Gin registers web, KOReader, and OPDS routes; serves assets and installs cookie sessions | `api/api.go` |
| Web workflows | Handlers combine query orchestration, mutations, template variables, redirects, and rendering | `api/app-routes.go`, `api/app-admin-routes.go` |
| Persistence | SQLite schema and SQLC queries; document and cover files on disk | `database/schema.sql`, `database/query.sql`, `api/common.go` |
| Authentication | Cookie sessions for web; KO routes also accept sessions; compatibility-specific credentials for KOReader and OPDS | `api/auth.go` |
| Reader | EPUB.js-backed imperative class owns pagination, DOM listeners, themes, position conversion, and synchronization | `assets/reader/index.js` |
| Offline files | Local reader stores browser-resident EPUB data; service worker caches server book resources and reader assets | `assets/local/index.js`, `assets/common.js`, `assets/sw.js` |
| Offline mutations | IndexedDB progress/activity queues; page scripts attempt delivery at startup and on reconnect | `assets/index.js`, `assets/reader/index.js` |
| Packaging | Go embeds templates and assets; development can read them from disk | `main.go`, `Makefile`, `Dockerfile` |
| External protocols | Dedicated KOReader and OPDS adapters | `api/ko-routes.go`, `api/opds-routes.go`, `client/` |

Current dependency direction is HTTP handlers → database/query layer and supporting packages. Reader/page scripts reach directly into storage helpers, DOM structure, and multiple HTTP surfaces. Web contracts are distributed across Go request types, template variables, JavaScript payloads, and URL conventions rather than one schema.

Mutable server state lives in SQLite and data files. Browser state lives in IndexedDB, Cache Storage, localStorage, and reader runtime objects. The evaluation must identify their responsibilities and writers to design the replacement; legacy browser keys and formats do not require migration.

### Risks Already Identified

- `assets/index.js` does not check HTTP success before treating queued delivery as complete. A resolved HTTP error must not count as acknowledgement in the new design.
- Progress uploads write server state on receipt (`api/ko-routes.go`). Offline replay and multi-device ordering need an explicit contract rather than an accidental last-arrival policy.
- React cannot safely own the same DOM subtree as EPUB.js. Engine content and React controls need a clear ownership boundary and lifecycle cleanup.
- The existing service worker owns `/sw.js` and root-scoped caching. Cutover must retire stale app-shell caches so the new frontend loads reliably; it need not migrate or preserve legacy browser data.
- Reader content isolation needs review against actual EPUB.js behavior and existing CSP/sandbox workarounds; copying configuration is not a security evaluation.
- Browser storage eviction, account changes, and session expiry are part of offline correctness.

These are static findings, not completed runtime verification or a comprehensive security audit.

## Functionality Inventory

All rows require handler/template inspection, runtime verification, and mapped acceptance tests. This is the initial inventory, not yet a complete parity sign-off.

| Domain | Workflows to verify | Primary evidence |
| --- | --- | --- |
| Identity | Login, logout, registration, session expiry, password changes, administrator permissions | `api/auth.go`, settings/admin handlers |
| Home | Reading statistics, streaks, graphs, leaderboard, relevant timezone behavior | `appGetHome`, `graph/`, database statistics queries |
| Library | Listing, search/filter/sort/pagination, detail, cover, download, upload, edit, delete | document handlers and templates |
| Metadata | Identification, provider results, applying metadata and cover changes | `appIdentifyDocument`, `metadata/` |
| Acquisition | Optional external search and saving acquired documents | `appGetSearch`, `appSaveNewDocument`, `search/` |
| Reading history | Activity, progress/history views, devices, per-document reading data | activity/progress/device handlers |
| Reader | Navigation, table of contents, gestures/keys, themes/fonts, progress restoration, activity/word tracking, wake lock | reader script and HTML |
| Offline/local | Local EPUB import/delete, offline library, server downloads/cache removal, local and remote progress, replay | local scripts, service worker, reader |
| Preferences | Timezone, device settings, reader preferences, password changes | settings handlers, reader settings |
| Administration | Users, last-admin protections, logs, import/results, backup/restore and maintenance actions | `api/app-admin-routes.go` |
| Configuration | Registration/search flags, demo restrictions, secure-cookie settings | `config/config.go`, route registration |
| Compatibility | KOSync progress, plugin activity/document synchronization, OPDS discovery/search/download | KO/OPDS handlers and `client/` |

For each workflow record: actor/permission, inputs, outputs, side effects, errors, configuration conditions, offline behavior, target API operation, and test evidence. Preserve intentional behavior, not incidental template structure or known defects.

## Target Architecture: Approved Direction

### Boundaries

| Boundary | Owns | May depend on |
| --- | --- | --- |
| React application | Routes, accessible controls, responsive layout, transient UI state | Typed web client, reader controller, browser persistence/sync |
| Reader engine | EPUB.js lifecycle, bounded lazy rendition DOM/assets, navigation, client position conversion and engine events | Validated range-indexed source and narrowly scoped platform capabilities |
| Browser persistence/sync | Disk-backed original EPUB sources/indexes/integrity, local/downloaded records, preferences, durable outbox and replay | Range/chunk storage, incremental validation workers, typed API client and platform events |
| Web API adapter | HTTP parsing/validation, web authentication/authorization, DTO mapping, errors | Application operations and OpenAPI types |
| Application operations | Business rules shared by web and compatibility adapters | Existing persistence and supporting packages |
| Compatibility adapters | Existing KOReader/KOSync and OPDS wire formats/auth semantics | Application operations where behavior is genuinely shared |
| Persistence | Database transactions, queries, document/cover files | SQLite/SQLC and filesystem |

Extract application operations where transport-independent behavior exists; do not introduce a service/repository abstraction around every query. No HTTP adapter calls another adapter's handler.

### State Ownership and Invariants

- SQLite/files are authoritative for server data. React query caches are derived views, not an offline mutation queue.
- Browser persistence owns local-only books and unsent reading events. A unified library is a presentation view, not an identity merge: local-only and server-linked identities remain distinct, even for matching titles/content. Combining views never auto-uploads local books or sends local-only activity to the server. Provenance and offline availability are independent properties.
- The sync subsystem is the sole owner of replay policy and acknowledgement handling. Concurrent tabs and service-worker activity cannot independently acknowledge/delete the same mutable queue entry without coordination.
- An accepted local reading event is durable before the UI reports it saved. It remains queued until a valid server acknowledgement or explicit user action resolves it.
- Retrying activity delivery cannot create duplicate credited activity. Define durable event identity and server deduplication behavior before implementation.
- Progress uses internal account/document revisions shared by web and KO writers, without adding CAS/event/UUID/CSRF fields to published KOSync. Stale web progress is retained for explicit local-versus-server choice; activity synchronizes independently. Backward moves remain valid; neither highest percentage nor client clock selects the winner.
- Reader persistence separates compressed disk/cumulative validation capacity from bounded stream chunks, active-entry/DOM and asset/native-image memory. Complete original integrity/CRC, quota/cancellation and security remain mandatory; reopen is lazy, not a whole-book hash/inflate preload. Concrete budgets belong in the reader report, not duplicate contract constants.
- Server-linked browser data and pending mutations are account-scoped. Switching accounts cannot replay another account's events. Explicit logout retains downloaded server books but hides them until the same account signs in again, and pauses its queued events; this is application-level separation, not encrypted storage. Session expiry alone does not block offline reading, and local-only books remain independent of login.
- Initial activity-credit rules retain the existing forward-page-turn/WPM measurement semantics while delivery becomes durable and deduplicated. Changes to idle, reread, chapter-jump, or background/close credit require a separate evaluated contract; the migration does not silently change recorded statistics.
- React owns controls and application DOM; the reader engine exclusively owns its rendering container. Unmount releases engine resources, listeners, object URLs, and wake locks.
- Protected API requests return machine-readable errors, not login HTML or redirects.
- Offline-only reading does not depend on an authenticated API request.
- Feature flags and authorization are enforced on the server, not only through hidden UI controls.

### Deployment and Frontend Tooling

M3 uses React + TypeScript + Vite, React Router Data Mode, TanStack Query, CSS Modules/tokens/native controls, and reader-owned Dexie persistence. Exact pins, package single-writer ownership and production qualification are fixed in the [M3 handoff](evaluation/m3-boundaries.md#production-build-dependencies-and-worker).

Approved information architecture: Library, Offline, Insights, and More tabs with a desktop navigation rail. Library defaults to a combined shared/local view with source icons on covers; offline availability is indicated separately. Featured Resume sits above a compact search input with adjacent Add and Filter icons, then a simple divider before items. Feature/detail both use “Resume”; omit “On the shelves” and visible provenance legends, retaining accessible cover badges. Filter opens a source/availability popup or sheet. Offline manages stored books, downloads and removal rather than duplicating ownership tabs. Keep detail Resume early and the paginated reader full-viewport, close to current behavior outside compact Folio theming. Global density reduces heading/control/card/padding/chrome space while preserving legibility and touch targets. Revised compact Folio/editorial is user-confirmed; independent density verification and earlier technical proofs remain accepted.

Go serves the compiled application and API from the same origin; development uses a loopback frontend dev server/proxy. M3 temporarily mounts React at `/app/`, with explicit links to existing SSR for unported capabilities; root SPA cutover and SSR retirement remain M6. Ignored compiled output lives in `assets/app/` inside the existing Go-embedded assets tree. Production does not require Node. SPA navigation fallback applies only to frontend routes, never API errors or missing asset requests. Deep links, existing reader links, cache headers, and content-hashed assets need explicit tests.

### API and OpenAPI

Selected: schema-first OpenAPI with generated strict Go boundary interfaces/types and TypeScript bindings. M2 accepted the representative `oapi-codegen`/Gin proof; M3 promotes it through production auth, shared reading operations, migrations and runtime validation under the [exact endpoint/interface contract](evaluation/m3-boundaries.md#authoritative-web-wire-contract).

Choose based on contract fidelity, integration simplicity, supported OpenAPI version, runtime validation, generated code quality, and deterministic CI generation—not tool popularity. Pin generator versions and prove drift checks before expanding the schema.

The new `/api/v1` web namespace is separate from `/api/ko` and `/api/opds`. Public DTOs are intentional API models, not exported SQLC rows. Resource groups include:

- Session/authentication, current user, and server capabilities.
- Documents, covers/files, metadata identification, and acquisition.
- Dashboard/statistics, activity, progress, and devices.
- User preferences and password changes.
- Reading synchronization with explicit idempotency/conflict semantics.
- Administration: users, logs, import, backup/restore, maintenance.

The contract must define nullability, identifiers, timestamps/timezones, percentage units, pagination, sorting, validation, error envelopes, limits, and binary content types. Specify authorization per operation and CSRF protection for cookie-authenticated mutations. Long-running operations need an intentional synchronous/job/streaming decision based on actual runtime behavior; do not assume every admin action is a simple JSON request.

### External KOSync Authority

The published upstream [KOReader sync-server contract](https://github.com/koreader/koreader-sync-server) is normative for KOSync routes, auth, payloads and errors. Existing handlers/tests are baseline evidence, not the specification; audit against a recorded upstream schema/revision before changing behavior. Report evidenced timestamp deviations without inventing normative fields/types. Preserve valid server data and external interoperability; web API validation/Problem envelopes do not redefine KOSync.

KOSync stores/returns original progress strings opaquely. KOReader CRengine path syntax/XPointer mapping is separate client interoperability. Canonical child-axis source paths for new reader writes have bounded automated evidence; native KOReader round trips remain pending. This is never a historical string rewrite or KOSync API redesign. Preserve SyncNinja extended activity/document routes without claiming they are official KOSync schema; OPDS remains separate.

### Mobile Web and Reader Contracts

**Selected EPUB boundary — single origin:** the trusted EPUB.js renderer runs at the application origin; untrusted chapter frames have no script permission. Enforce strict CSP before chapter parsing, validated archive-only assets and controller-mediated internal navigation. No extra hostname is required. The user accepts that a trusted renderer bug can affect the application origin; a dedicated credential-free origin is optional future hardening, not an acceptance requirement. Never enable the unsafe `allowScriptedContent` workaround. The [opaque-frame experiment](evaluation/m2-reader-isolation.md) is retained falsification evidence, not a competing production design or an unfinished requirement for stronger isolation. The selected policy has [independently accepted representative compatibility/security evidence](evaluation/m2-reader-storage.md#independent-closure); broader production qualification remains required.

The offline storage and installed-PWA contracts below describe the existing implementation; they are not milestone acceptance requirements. Keep the reader isolation, pagination, position, and mobile web contracts.
- Offline availability is explicit and verifiable: publish complete validated disk-backed sources/index/integrity/checkpoint references atomically after staging; incomplete/quota-failed/cancelled sources are never available and earlier verified books survive.
- Expose pending sync, authentication-required, retryable failure, conflict, quota failure, and unavailable-book states.
- Support reopen after full termination, not only airplane mode in an already-open tab.
- Do not require Background Sync support for correctness; use startup, foreground, and reconnect replay as supported entry points.
- Define update behavior during active reading and queued mutations, including compatibility between frontend, service worker, browser schema, and server API versions.
- Review install identity (`manifest` ID/start URL/scope) before changing routes or names.
- Evaluate safe areas, dynamic viewport height, orientation, large text, keyboard focus, touch targets, reduced motion, and screen-reader navigation.
- Preserve original stored positions and document identity. Qualify KOReader CRengine client read/new-write mapping separately from opaque KOSync transport; React adaptation does not justify rewriting historical strings.
- Preserve full-viewport pagination without vertical book-text scrolling, tap/swipe/keyboard page turns, TOC and font/theme controls. Font growth/shrink, viewport resize and orientation changes repaginate while preserving the logical reading anchor; pagination must not substitute page-number equality for position continuity.
- Preserve installed-PWA reading behavior, including viewport/safe-area handling, background/resume and offline recovery; synthetic reader controls do not prove these contracts.
- Treat native wake-lock support and fallback behavior as browser-specific capabilities to verify, not assumptions inherited from historical workarounds.

## Architectural Delta

- Template rendering, template-only presentation helpers, and form/redirect-specific response handling disappear from the production web path.
- UI composition and interactive controls belong to React rather than templates or global DOM selectors.
- Transport-independent rules currently inside handlers belong to shared application operations where needed.
- Web request/response contracts belong to OpenAPI rather than implicit template variables.
- Reader rendering/conversion logic belongs to an engine/controller; React supplies its lifecycle and controls.
- Browser storage/replay behavior belongs to one explicit subsystem rather than duplicated page/reader functions.
- KOReader/OPDS protocol boundaries and persistent server data retain their identity; compatibility shims exist only where an explicit external contract requires them.

## Evaluation Environment and Evidence

Backup: `_scratch/AnthoLumeBackup_20261116191232.zip`. Archive inventory shows 402 entries, including a roughly 41 MB SQLite file, covers, and EPUBs; total uncompressed size is roughly 1.29 GB. Integrity and restored application behavior are unverified.

- Preserve the original archive; validate integrity and entry paths before extraction.
- Use an isolated disposable copy under `_scratch/` with separate config/data paths and local credentials. Do not modify the source snapshot or assume the existing `_scratch/db` directory is disposable.
- Bind locally, disable unintended outbound/import work, and avoid exposing real user data or password hashes in logs, documents, screenshots, or fixtures.
- Record schema/migration compatibility, aggregate dataset scale, representative EPUB characteristics, startup procedure, and baseline workflow evidence.
- Use synthetic small fixtures for committed automated tests; the private archive is an optional local realism dataset, not a CI dependency.
- Record browser/OS versions and whether evidence came from desktop emulation, automation, or a physical installed PWA.

## Milestones and Exit Gates

Milestones describe delivery order, not alternative target architectures. Checkboxes track satisfied deliverables and exit gates, not activity. A milestone is complete only when its evidence is linked here and unresolved contract changes are approved. Keep execution notes in the linked evaluation reports, not this end-state checklist.

### M1 — Baseline and Architecture Evaluation

Status: complete; approved for M2. See [evaluation summary and recommendations](evaluation/README.md).

Deliverables:
- [x] Verified isolated runtime using the snapshot; baseline build/test results. Evidence: [runtime baseline](evaluation/runtime-baseline.md), [backend verification](evaluation/architecture-tooling.md#confirmed-verification).
- [x] Source-backed workflow inventory with authorization, feature flags, errors, offline behavior, and runtime evidence gaps. Evidence: [capability matrix](evaluation/workflows-api.md#2-reading-the-capability-matrix). Full runtime acceptance remains an M4 gate.
- [x] Browser-storage responsibilities and reader-position inventory; proposed legacy service-worker retirement without browser-data preservation. Evidence: [reader/offline evaluation](evaluation/reader-offline.md).
- [x] Proposed target boundaries, state ownership, compatibility contracts, and focused risk register. Evidence: [architecture evaluation](evaluation/architecture-tooling.md), [workflow contracts](evaluation/workflows-api.md).
- [x] Decision proposals comparing OpenAPI generation, frontend foundations, reader reuse, and storage/sync approaches, with unresolved choices explicit. Evidence: [consolidated recommendations](evaluation/README.md#consolidated-recommendation).
- [x] Mobile-first information architecture and low-fidelity interaction proposals based on user tasks, including alternatives to the current screen organization. Evidence: [interaction design](evaluation/interaction-design.md).

- [x] Exit gate: target boundaries/invariants, preservation defaults, schema-first tooling direction, conservative progress conflicts, and M2 scope approved for execution. Detailed operational policies remain gated before the affected production workflows; exact tools and visual direction require M2 evidence and validation.

### M2 — Contract and Mobile Interaction Proofs

Status: complete. Bounded technical proofs are independently accepted; “Looks good. Proceed” confirms revised compact Folio and closes the remaining confirmation/exit gate. Single-origin hardened EPUB.js remains selected. Real reader adaptation/theming belongs to M3, not further mock-reader work. Proof modules are discardable or deliberately promoted, not permanent frontends. Phone/PWA and production qualification remain pending.

Deliverables:
- [x] Representative six-operation OpenAPI contract; reproducible strict Go/TypeScript generation, validation and drift checks, fixture HTTP/SQLite operations and scoped patched-toolchain verification. Evidence: [API/schema proof](evaluation/m2-api-contract.md#independent-closure).
- [x] Bounded tooling integration: generated TypeScript client/browser ↔ actual Go HTTP server, with representative reads, binary integrity, validation/error handling and runtime receipt gates. Evidence: [actual HTTP proof and independent acceptance — 10 browser tests](evaluation/m2-integration.md#independent-acceptance). Full runtime validation of every DTO is not claimed; production authentication, KO integration, migrations and deployment qualification remain subsequent gates.
- [x] Two proposed visual systems with typography, color, spacing, components and tested interaction states. Evidence: [Folio/Index design proof](evaluation/m2-design.md#independent-closure).
- [x] Mobile/desktop prototypes for library, detail, sample reader controls, offline library and synchronization states on the approved information architecture. Evidence: [interaction scope](evaluation/m2-design.md#changed-interaction-contracts). These are synthetic interactions, not EPUB/offline implementation; [refinement checks and independent closure](evaluation/m2-design.md#independent-closure) cover the revised prototype target.
- [x] User selection of Folio/editorial in structured browser review, retaining four tabs, desktop rail and early detail Resume. This is creative selection, not full interaction or phone/PWA validation.
- [x] User approval of the rest of the Folio flow and requested revised mobile/reader presentation, confirmed by “Looks good. Proceed”; no repeat of all flows is required.
- [x] Revised prototype verification: combined shared/local Library, separate cover provenance/availability, compact search/filter, Back/focus/state/privacy, full-viewport no-scroll pagination and logical-anchor continuity on text resize/reflow. Evidence: [independent closure](evaluation/m2-design.md#independent-closure), current 89 browser + 2 static checks include the preserved mobile cases; both original mobile findings remain closed. Synthetic text pagination does not prove EPUB or installed-PWA behavior.
- [x] Compact Folio density verification: featured Resume before search, adjacent Add/Filter icons, simple item divider, consistent feature/detail Resume labels, accessible cover badges without visible provenance key or shelf heading, and compact app/reader chrome with preserved touch targets, text size and interactions. Evidence: [independent closure](evaluation/m2-design.md#independent-closure), 89 browser + 2 static checks; no bounded blocker remains.
- [x] User confirmation of revised compact Folio and requested refinements: “Looks good. Proceed.” No repeat of all workflows or further mock-reader development is required; this does not approve phone/PWA behavior.
- [x] Focused reader lifecycle, element-level KO codec/restore, transactional storage, account/lease fencing, exact acknowledgements and conservative shared-revision conflict proofs against a typed fake. Evidence: [reader/storage proof](evaluation/m2-reader-storage.md#independent-closure).
- [x] Representative reader compatibility/security proof for selected single-origin hardened EPUB.js: ordinary parsed CSS, packaged fonts, inline/packaged SVG, validated internal navigation, before-parse CSP/no-script chapters and source-body/byte preservation. Evidence: [reader proof and independent closure](evaluation/m2-reader-storage.md#independent-closure): owner 20 unit/38 browser tests; independent 20 unit/11 targeted browser tests plus original-reproduction/source/lifecycle probes. Trusted-renderer app-origin blast radius is explicitly accepted; no extra hostname or stronger boundary is required. Broader corpus/security/platform parity remains M3–M5 qualification.
- [x] Representative replay/CAS proof over real Go↔browser HTTP: exact acknowledgements, lost-response retry/deduplication, durable outbox retention and explicit backward choice with stale-choice rejection. Evidence: [HTTP contracts](evaluation/m2-integration.md#executed-named-contracts), [independent acceptance — 10 browser tests](evaluation/m2-integration.md#independent-acceptance). Production resolution ownership/history, real KO protocol and restart qualification remain pending.
- [x] Legacy worker-retirement/reset contract defined: `/sw.js` replacement, exact allowlisted cleanup, bounded client coordination/reload, failure recovery and unrelated/new-schema preservation. Evidence: [retirement contract and unexecuted acceptance matrix](evaluation/service-worker-contract.md). Runtime cutover, cold restart and installed-device qualification remain M3/M5 gates.
- [x] Acceptance-test definitions and preserve/adapt/add dispositions for the declared proof scope; no production tests retired. Evidence: [API](evaluation/m2-api-contract.md#test-disposition-and-promotion-decision), [reader/storage](evaluation/m2-reader-storage.md#test-dispositions-and-fault-sensitivity), [design](evaluation/m2-design.md#test-dispositions).

- [x] Exit gate — complete under “Looks good. Proceed”: revised Folio confirmed and real M3 vertical slice authorized. Independently accepted technical/interaction proofs remain bounded; worker retirement is contract-defined, not runtime-proved. Proofs are removed or deliberately promoted, never permanent parallel frontends. No phone/PWA or production approval is implied.

M2 proves the selected tools and boundary contracts support representative real operations; it is not narrowed to passing existing fixtures. Production auth/CSRF, shared KO writers, migrations/deployment compatibility, broad real EPUB/KOReader compatibility and cold-restart workflows remain M3–M5 promotion gates below, not prerequisites to starting those milestones. Full workflow/parity and platform acceptance remain M4/M5 requirements; none is waived by M2 closure.

### M3 — End-to-End Reader Vertical Slice

Status: code checkpoint, not production rollout. [Earlier automated evidence](evaluation/m3-boundaries.md#current-checkpoint-evidence) is historical; remaining online reader failures still need triage. User review accepts mobile web browsing and reading; no separate device/PWA signoff is required for M3.

Promotion blockers (retain as acceptance requirements, not waived by bounded M2 closure):
- [ ] Qualify the selected single-origin hardened EPUB.js boundary and broad benign-content compatibility, including validated controller internal navigation; restrictive passive fixtures are not production parity. A dedicated reader origin is optional future hardening, not a promotion requirement.
- [ ] Qualify the selected ideal large-book architecture: disk-backed originals/range index, incremental full integrity/CRC/validation, bounded stream chunks and lazy active DOM/assets, no whole-book buffers. Distinguish disk/cumulative validation capacities from active/native memory; qualify ZIP bombs, duplicates, quota, cancellation, repeated cold opens, visible images/anchors and measured worker/native memory. A temporary whole-book cap is not acceptance.
- [x] Classic KOSync upstream recheck passes F1–F5, explicit-header precedence and account-scoped aliases; [short-read partial-MD5 and opaque-string compatibility evidence](evaluation/kosync-compatibility.md) preserves server IDs and history.
- [ ] Resolve declared upstream KOSync F6 limits/coercion and F7 additional-route scope before claiming full reference parity. Separately qualify native KOReader CRengine mapping/new-writer child-axis behavior and recoverable historical ambiguity without historical rewrite.
- [x] Production HTTP/auth/CSRF, runtime response validation, durable receipts/shared revisions including real KO writers, and persistent explicit conflict resolution: [backend final](evaluation/m3-backend-final.md), [actual Go↔React 34/34](evaluation/m3-integration-check.md).
- [x] Automated cold offline shell launch/full termination recovery and legacy `/sw.js` retirement with new-schema outbox preservation: [actual Go↔React](evaluation/m3-integration-check.md) and [production SW 6/6](evaluation/m3-reader-final-check.md). This does not cover manual or physical-device acceptance.

Evidence and additional promotion limits: [API](evaluation/m2-api-contract.md#proved-versus-pending), [reader/storage](evaluation/m2-reader-storage.md#explicit-limits--not-solved). Real-device/security/compatibility qualification remains required in M4/M5; restrictive proof behavior does not silently retire parity requirements.

Deliverables:
- [x] Authentication, library/detail, server-book download, actual EPUB.js reader and offline library at `/app/`, compact Folio controls and bounded automated navigation/reflow evidence: [actual Go↔React integration](evaluation/m3-integration-check.md). Full platform/native parity remains open above.
- [x] Local-only EPUB import/reading on disk-backed lazy sources, with zero local server events: [public streaming](evaluation/m3-streaming-final.md) and bounded [A](evaluation/m3-large-book-A-check.md), [B](evaluation/m3-large-book-B-check.md), [C](evaluation/m3-large-book-C-check.md), [D](evaluation/m3-large-book-D-check.md) workflows. D combines earlier warm evidence with current-controller cold evidence; this is not unrestricted corpus/native acceptance.
- [x] Durable activity/progress replay, deduplication, account isolation and visible sync states: [34/34 actual-Go browser and 40/40 web units](evaluation/m3-integration-check.md).
- [x] Initial additive browser schema and automated legacy worker/cache retirement with new-data preservation: [integration evidence](evaluation/m3-integration-check.md). No legacy browser-data migration.
- [x] Root Go 1.26.11 tests (79 + 52 subtests), race, vet, build/module verification and zero vulnerability findings; deterministic Go/TS generation and all 21 behavioral mutations plus drift detection: [backend final](evaluation/m3-backend-final.md).
- [x] Production service-worker regression: [6/6](evaluation/m3-reader-final-check.md), including both cold-process scenarios and retirement/update/failure fencing.
- [ ] Rerun online reader and Go↔React coverage. Keep large-book rendering and saved-position regressions in scope; do not count offline-only or installed-PWA cases against M3.

- [ ] Exit gate: browse the shared library, open and navigate an EPUB, save and resume the same position, and verify online progress/activity synchronization without lost or duplicate credit, including KOReader compatibility. User review covers browsing and reading on mobile web. Download, cold offline restart, local-only reading without sign-in, and installed-PWA testing are not gates.

### M4 — Complete Application Coverage

Status: in progress. Native Insights includes the personal 30-day overview, activity, saved progress, and rankings. The personal overview reads acknowledged records directly, using the account timezone and assigning each interval to its local start day. Rankings use separate UTC windows and label estimated words and pace.

Deliverables:
- [ ] Remaining library mutations, metadata/acquisition, dashboard/statistics, activity/progress, preferences/devices, and all administration workflows.
- [ ] Complete OpenAPI coverage, permissions, feature flags, and error states.
- [ ] Compatibility regression coverage for KOReader/plugin and OPDS workflows affected by shared code changes.

- [ ] Exit gate: every in-scope feature-inventory row has passing acceptance evidence or an approved behavior change. Offline and installed-PWA workflows are explicitly excluded; admin and acquisition remain in scope.

### M5 — Upgrade and Failure Qualification

Status: not started.

Deliverables:
- [ ] Online browser regression coverage, including desktop; use the completed user review for ordinary mobile viewing and reading.
- [ ] Fault testing for online workflows: interrupted uploads, duplicate submissions, multiple tabs/devices, clock skew, and auth failure.
- [ ] Server upgrade checks using the existing snapshot, preserving database records, document/cover files, and external protocol compatibility.
- [ ] Legacy frontend cutover checks confirm that stale caches cannot keep serving the old application; legacy browser books, preferences, and pending state may be cleared.
- [ ] Accessibility review, EPUB content-isolation review, performance measurements on the representative dataset, and agreed budgets.
- [ ] Server recovery/rollback rehearsal, including any irreversible database or file changes. Post-cutover frontend update tests protect data created by the new application, not legacy browser state.

- [ ] Exit gate: all approved critical contracts pass; unsupported platform behavior and remaining limitations are explicitly accepted. Installed-PWA qualification is out of scope.

### M6 — Cutover and Retire SSR

Status: not started.

Deliverables:
- [ ] Reproducible frontend/API builds integrated into Go packaging, containers, and CI.
- [ ] Production SPA routing/caching/security headers and stable external protocol routes.
- [ ] Removal of obsolete templates, SSR handlers/helpers, old scripts, dependencies, and obsolete tests after parity approval.
- [ ] Updated installation/development documentation, published OpenAPI artifact, and operational recovery instructions.

- [ ] Exit gate: fresh deployment and upgrade deployment both pass smoke tests; React is the sole production web frontend; no temporary migration bridge remains without an explicit external compatibility requirement.

## Validation and Test Disposition

Existing tests are evidence, not the specification for retired rendering internals.

- Preserve persistence, security, upload, statistics, and compatibility tests that assert continuing contracts.
- Adapt tests whose requirement holds but whose HTTP response or ownership boundary intentionally changes.
- Replace/remove template/SSR-only tests alongside their retired structures rather than adding adapters to keep them green.
- Add API contract/integration tests, focused reader position/lifecycle tests, storage/sync failure tests, and browser end-to-end workflows.
- Record preserve/adapt/replace/remove/investigate dispositions when implementation touches more than a couple of tests, with the protected contract and reason for changed expectations.
- Keep server acknowledgement/deduplication correctness independently testable from browser UI automation.

Evidence tracker:

| Evidence | Status | Report/test location |
| --- | --- | --- |
| Static architectural inspection and proposals | Available for review | [Evaluation reports](evaluation/README.md#evidence-map) |
| Snapshot integrity and isolated restore | Passed, existing FK violations documented | [Runtime baseline](evaluation/runtime-baseline.md) |
| Baseline build/tests and representative HTTP smoke checks | Passed; full runtime parity pending | [Backend verification](evaluation/architecture-tooling.md#confirmed-verification), [runtime baseline](evaluation/runtime-baseline.md) |
| Architecture direction and M1/M2 execution approval | Approved; not creative selection or production promotion | [Approved defaults](evaluation/README.md#product-decisions-for-m2) |
| OpenAPI/tooling proof | Bounded proof passed; independently accepted, production integration pending | [API closure](evaluation/m2-api-contract.md#independent-closure) |
| Reader/storage/conflict proof | Bounded desktop Chromium proof passed; real KO/PWA pending | [Reader closure](evaluation/m2-reader-storage.md#independent-closure) |
| Actual HTTP and replay/CAS composition | Independently accepted; 10 browser tests, bounded fixture scope | [HTTP report/acceptance](evaluation/m2-integration.md#independent-acceptance) |
| Selected single-origin reader boundary | Representative proof independently accepted; user accepts trusted-renderer blast radius, no extra hostname | [Reader closure](evaluation/m2-reader-storage.md#independent-closure), [retained topology falsification](evaluation/m2-reader-isolation.md) |
| Legacy worker retirement | Automated production SW and actual-Go subsets pass; physical-device and upgrade/cutover qualification open | [Contract/test matrix](evaluation/service-worker-contract.md), [production SW check](evaluation/m3-reader-final-check.md) |
| Proposed visual systems/interaction prototypes | Bounded automated proof accepted; not human interaction approval | [Design closure](evaluation/m2-design.md#independent-closure) |
| Human visual selection | Folio/editorial selected in structured browser review; four tabs/desktop rail/early detail Resume retained | [Selected direction](evaluation/README.md#product-decisions-for-m2) |
| Refined interaction validation and M2 exit | Complete: revised Folio confirmed by “Looks good. Proceed”; independent 89 browser + 2 static checks retained; no phone/PWA approval | [M3 authorization/handoff](evaluation/m3-boundaries.md) |
| Offline vertical-slice proof | Actual-Go 34/34 browser + 40/40 unit PASS, including startup/access and cold replay; SW 6/6, reader red (70/71), manual exit open | [Current integration](evaluation/m3-integration-check.md) |
| Actual large-original qualification | Bounded A/B/C/D workflows PASS (D mixed warm/current-cold provenance); broad memory/native qualification remains open | [Current checkpoint evidence](evaluation/m3-boundaries.md#current-checkpoint-evidence) |
| Full functionality acceptance | Pending | — |
| Real-device, server upgrade, and legacy cache-retirement qualification | Pending | — |
| Cutover/rollback qualification | Pending | — |

## Decisions Requiring Evaluation or Approval

1. Production validation of the [M3 conflict/re-authentication interface](evaluation/m3-boundaries.md): retain stale local progress for explicit choice, allow intentional backward moves, and synchronize activity independently.
2. Production validation of account-switch and re-authentication isolation: logout and expiry pause the original account’s events, and another account cannot replay them or access retained private data.
3. Deployment verification that [legacy worker retirement](evaluation/service-worker-contract.md) cannot leave stale frontend assets active. Offline and installed-PWA validation are not gates.
4. Supported browser/OS floor and available physical-device validation coverage.
5. Production qualification of the selected [M3 schema/toolchain/dependency pins](evaluation/m3-boundaries.md#production-build-dependencies-and-worker), including root Go 1.26.11; user-staged `flake.lock` remains untouched.
6. Online accessibility and performance qualification. Revised compact Folio is confirmed; that presentation approval does not close these later gates.
7. Which existing behavior is defective and intentionally changes; no blanket permission to change functionality.
8. Qualify the bounded `/app/` + SSR coexistence and rollback constraints in the M3 handoff; old binaries cannot safely bypass new receipt/shared-head participation. Root SPA/SSR retirement stays M6.

## Scope Guardrails

- A ground-up redesign of the surrounding app is required; a cosmetic template-to-React port is insufficient. Preserve capabilities and compatibility contracts, with current-reader pagination/input continuity outside theming as explicitly required.
- No permanent dual frontend.
- No database rewrite, backend framework replacement, or general-purpose architecture expansion without a concrete requirement.
- Preserve valid server data and external integration contracts; upstream KOSync is normative, existing handler tests are evidence, and SyncNinja extensions are distinct. Introduce only necessary server migrations. No compatibility layer or migration for legacy browser-stored books, preferences, downloads, or pending events.
- No production rollout before approved online compatibility and upgrade gates.
- No reliance on the private backup as the only test fixture.
- No implementation estimates until M1 establishes the inventory and risk boundaries.
