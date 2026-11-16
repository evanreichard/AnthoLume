# React Frontend Migration

Status: evaluation direction approved; detailed policies and tooling remain subject to evaluation. Milestone 1 is in progress; implementation is not approved by this document.

## Goal and Scope

Replace Go-template web rendering with a ground-up frontend redesign implemented in React/TypeScript while retaining AnthoLume's functionality. Redesign the information architecture, navigation, layouts, visual system, and interaction patterns rather than translating existing templates into components. Mobile usability, installed-PWA behavior, offline reading, and KOReader interoperability are first-class requirements. Existing screens are evidence of functionality, not design specifications.

The selected approach is a full architecture and behavior evaluation before implementation. Delivery can then be incremental, but the end state has one web frontend, not permanently maintained React and SSR applications.

This document is the durable design and milestone tracker. Confirmed observations, proposed decisions, and unresolved contracts are distinguished below. Update acceptance evidence here as work completes; link detailed specifications and test reports rather than growing an unstructured task log.

## Success Criteria

- Every inventoried capability is preserved or explicitly changed with approval; existing screen organization and interaction sequences are not parity requirements.
- A coherent, mobile-first design system and information architecture replace the existing frontend, with deliberate desktop adaptations rather than enlarged mobile layouts.
- React owns the web UI; production web pages do not require Go templates.
- A versioned web API exposes the functionality previously available through SSR.
- OpenAPI describes requests, responses, errors, security, and binary operations; generated frontend bindings remain synchronized with it.
- Local-only books remain usable without a server account.
- Downloaded server books can be reopened after an offline app restart.
- Offline activity and progress survive interruption and synchronize safely.
- Existing KOReader/KOSync and OPDS clients remain compatible.
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

## Target Architecture: Proposed

### Boundaries

| Boundary | Owns | May depend on |
| --- | --- | --- |
| React application | Routes, accessible controls, responsive layout, transient UI state | Typed web client, reader controller, browser persistence/sync |
| Reader engine | EPUB.js lifecycle, rendition DOM, navigation, position conversion, engine events | EPUB.js and narrowly scoped platform capabilities |
| Browser persistence/sync | Local EPUBs, downloaded-book records, preferences, durable outbox, replay coordination | IndexedDB/Cache Storage, typed API client, platform events |
| Web API adapter | HTTP parsing/validation, web authentication/authorization, DTO mapping, errors | Application operations and OpenAPI types |
| Application operations | Business rules shared by web and compatibility adapters | Existing persistence and supporting packages |
| Compatibility adapters | Existing KOReader/KOSync and OPDS wire formats/auth semantics | Application operations where behavior is genuinely shared |
| Persistence | Database transactions, queries, document/cover files | SQLite/SQLC and filesystem |

Extract application operations where transport-independent behavior exists; do not introduce a service/repository abstraction around every query. No HTTP adapter calls another adapter's handler.

### State Ownership and Invariants

- SQLite/files are authoritative for server data. React query caches are derived views, not an offline mutation queue.
- Browser persistence owns local-only books and unsent reading events. It distinguishes local-only and server-linked documents explicitly.
- The sync subsystem is the sole owner of replay policy and acknowledgement handling. Concurrent tabs and service-worker activity cannot independently acknowledge/delete the same mutable queue entry without coordination.
- An accepted local reading event is durable before the UI reports it saved. It remains queued until a valid server acknowledgement or explicit user action resolves it.
- Retrying activity delivery cannot create duplicate credited activity. Define durable event identity and server deduplication behavior before implementation.
- Progress conflict semantics support intentionally moving backward; highest-percentage-wins is not a valid default.
- Server-linked browser data and pending mutations are account-scoped. Switching accounts cannot replay another account's events. Explicit logout retains downloaded server books but hides them until the same account signs in again, and pauses its queued events; this is application-level separation, not encrypted storage. Session expiry alone does not block offline reading, and local-only books remain independent of login.
- Initial activity-credit rules retain the existing forward-page-turn/WPM measurement semantics while delivery becomes durable and deduplicated. Changes to idle, reread, chapter-jump, or background/close credit require a separate evaluated contract; the migration does not silently change recorded statistics.
- React owns controls and application DOM; the reader engine exclusively owns its rendering container. Unmount releases engine resources, listeners, object URLs, and wake locks.
- Protected API requests return machine-readable errors, not login HTML or redirects.
- Offline-only reading does not depend on an authenticated API request.
- Feature flags and authorization are enforced on the server, not only through hidden UI controls.

### Deployment and Frontend Tooling

Proposed default: React + TypeScript + Vite, a client router, a server-state query library, and a deliberately small UI foundation. Specific router, query, styling, component, and storage packages remain evaluation decisions.

Approved mobile information architecture: Library, Offline, Insights, and More tabs, with a focused full-screen reader and a desktop navigation rail. Visual design and detailed interactions remain M2 deliverables.

Go serves the compiled application and API from the same origin; development uses a frontend dev server/proxy. Production does not require Node. SPA navigation fallback applies only to frontend routes, never API errors or missing asset requests. Deep links, existing reader links, cache headers, and content-hashed assets need explicit tests.

### API and OpenAPI

Proposed default: schema-first OpenAPI with generated Go boundary types/interfaces and TypeScript bindings. Evaluate `oapi-codegen` against Gin and compare with a code-first alternative using one representative read, mutation, validation failure, and binary operation.

Choose based on contract fidelity, integration simplicity, supported OpenAPI version, runtime validation, generated code quality, and deterministic CI generation—not tool popularity. Pin generator versions and prove drift checks before expanding the schema.

A proposed `/api/v1` web namespace is separate from `/api/ko` and `/api/opds`. Public DTOs are intentional API models, not exported SQLC rows. Resource groups include:

- Session/authentication, current user, and server capabilities.
- Documents, covers/files, metadata identification, and acquisition.
- Dashboard/statistics, activity, progress, and devices.
- User preferences and password changes.
- Reading synchronization with explicit idempotency/conflict semantics.
- Administration: users, logs, import, backup/restore, maintenance.

The contract must define nullability, identifiers, timestamps/timezones, percentage units, pagination, sorting, validation, error envelopes, limits, and binary content types. Specify authorization per operation and CSRF protection for cookie-authenticated mutations. Long-running operations need an intentional synchronous/job/streaming decision based on actual runtime behavior; do not assume every admin action is a simple JSON request.

### Mobile/PWA and Reader Contracts

- App-shell installation/update strategy is separate from book download/storage policy.
- Offline availability is explicit and verifiable; incomplete downloads are never labeled available.
- Expose pending sync, authentication-required, retryable failure, conflict, quota failure, and unavailable-book states.
- Support reopen after full termination, not only airplane mode in an already-open tab.
- Do not require Background Sync support for correctness; use startup, foreground, and reconnect replay as supported entry points.
- Define update behavior during active reading and queued mutations, including compatibility between frontend, service worker, browser schema, and server API versions.
- Review install identity (`manifest` ID/start URL/scope) before changing routes or names.
- Evaluate safe areas, dynamic viewport height, orientation, large text, keyboard focus, touch targets, reduced motion, and screen-reader navigation.
- Preserve KOReader-compatible stored positions and document identity. React adaptation does not justify silently replacing the position format.
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

Status: evaluation artifacts available; review/approval pending. See [evaluation summary and recommendations](evaluation/README.md).

Deliverables:
- [x] Verified isolated runtime using the snapshot; baseline build/test results. Evidence: [runtime baseline](evaluation/runtime-baseline.md), [backend verification](evaluation/architecture-tooling.md#confirmed-verification).
- [x] Source-backed workflow inventory with authorization, feature flags, errors, offline behavior, and runtime evidence gaps. Evidence: [capability matrix](evaluation/workflows-api.md#2-reading-the-capability-matrix). Full runtime acceptance remains an M4 gate.
- [x] Browser-storage responsibilities and reader-position inventory; proposed legacy service-worker retirement without browser-data preservation. Evidence: [reader/offline evaluation](evaluation/reader-offline.md).
- [x] Proposed target boundaries, state ownership, compatibility contracts, and focused risk register. Evidence: [architecture evaluation](evaluation/architecture-tooling.md), [workflow contracts](evaluation/workflows-api.md).
- [x] Decision proposals comparing OpenAPI generation, frontend foundations, reader reuse, and storage/sync approaches, with unresolved choices explicit. Evidence: [consolidated recommendations](evaluation/README.md#consolidated-recommendation).
- [x] Mobile-first information architecture and low-fidelity interaction proposals based on user tasks, including alternatives to the current screen organization. Evidence: [interaction design](evaluation/interaction-design.md).

- [ ] Exit gate: user approval of target contracts, explicit behavior changes, tooling direction, and M2 scope. Completed evaluation artifacts do not imply approved policies, proven tools, or implementation authorization.

### M2 — Contract and Mobile Interaction Proofs

Status: not started.

Deliverables:
- [ ] Representative OpenAPI contract and reproducible Go/TypeScript generation with validation/drift checks.
- [ ] A proposed visual system covering typography, color, spacing, components, and accessible interaction states.
- [ ] Mobile/desktop interaction prototypes for library, document detail, reader controls, offline library, and synchronization states that demonstrate the redesign rather than reproduce current screens.
- [ ] Focused technical proofs for reader mounting/unmounting, position round trips, storage durability, and progress conflict policy.
- [ ] Acceptance-test definitions and existing-test dispositions against approved contracts.

- [ ] Exit gate: prove the selected tooling supports real operations, approve the interaction direction, and resolve offline replay/conflict contracts and the legacy browser-state reset strategy. Temporary proofs are removed or deliberately promoted; they do not become parallel production architectures.

### M3 — End-to-End Reader and Offline Vertical Slice

Status: not started.

Deliverables:
- [ ] Authentication, library/detail, server-book download, reader, and offline library backed by the new API and UI.
- [ ] Local-only EPUB import and reading.
- [ ] Durable activity/progress replay, deduplication, account isolation, and visible sync states.
- [ ] Initial browser schema and legacy service-worker/cache retirement; no legacy browser-data migration.

- [ ] Exit gate: download → disconnect → fully terminate/reopen → read → reconnect → synchronize, with no lost or duplicated credited activity. Also demonstrate local-only reading without login, expired-session recovery without queue loss, and position compatibility with KOReader.

### M4 — Complete Application Coverage

Status: not started.

Deliverables:
- [ ] Remaining library mutations, metadata/acquisition, dashboard/statistics, activity/progress, preferences/devices, and all administration workflows.
- [ ] Complete OpenAPI coverage, permissions, feature flags, and error states.
- [ ] Compatibility regression coverage for KOReader/plugin and OPDS workflows affected by shared code changes.

- [ ] Exit gate: every feature-inventory row has passing acceptance evidence or an approved behavior change; no workflow is silently deferred because it is an admin or edge-case feature.

### M5 — Mobile, Upgrade, and Failure Qualification

Status: not started.

Deliverables:
- [ ] Real-device iOS/Safari installed-PWA and Android/Chromium checks, plus desktop browser coverage.
- [ ] Fault testing: interrupted downloads/uploads, quota/eviction, duplicate replay, multiple tabs/devices, clock skew, auth failure, offline restart, and service-worker upgrades during reading.
- [ ] Server upgrade checks using the existing snapshot, preserving database records, document/cover files, and external protocol compatibility.
- [ ] Legacy frontend cutover checks confirm that stale caches cannot keep serving the old application; legacy browser books, preferences, and pending state may be cleared.
- [ ] Accessibility review, EPUB content-isolation review, performance measurements on the representative dataset, and agreed budgets.
- [ ] Server recovery/rollback rehearsal, including any irreversible database or file changes. Post-cutover frontend update tests protect data created by the new application, not legacy browser state.

- [ ] Exit gate: all approved critical contracts pass; unsupported platform behavior and remaining limitations are explicitly accepted. Emulation alone does not satisfy real-device PWA qualification.

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
| Architecture and contract approval | Pending | — |
| OpenAPI/tooling proof | Pending | — |
| Mobile interaction approval | Pending | — |
| Offline vertical-slice proof | Pending | — |
| Full functionality acceptance | Pending | — |
| Real-device, server upgrade, and legacy cache-retirement qualification | Pending | — |
| Cutover/rollback qualification | Pending | — |

## Decisions Requiring Evaluation or Approval

1. Exact progress-conflict semantics across web/KOReader devices and stale offline replay.
2. Detailed account-switch/re-authentication interactions implementing the approved retention policy: explicit logout hides retained server downloads and pauses original-account events; local-only books remain independent. Retention versus removal is resolved.
3. Legacy service-worker/cache retirement mechanism. Legacy browser data preservation is explicitly out of scope.
4. Supported browser/OS floor and available physical-device validation coverage.
5. Final OpenAPI/toolchain versions and frontend/storage dependencies.
6. Mobile navigation, visual direction, and accessibility/performance acceptance budgets.
7. Which existing behavior is defective and intentionally changes; no blanket permission to change functionality.
8. Temporary coexistence and rollback constraints, especially where data changes cannot safely be rolled back.

## Scope Guardrails

- A ground-up frontend redesign is required; a template-to-React port with cosmetic changes does not satisfy the goal. Preserve capabilities and compatibility contracts, not existing layouts or navigation.
- No permanent dual frontend.
- No database rewrite, backend framework replacement, or general-purpose architecture expansion without a concrete requirement.
- Preserve existing server data and external integration contracts; introduce only necessary server migrations. No compatibility layer or migration for legacy browser-stored books, preferences, downloads, or pending events.
- No production rollout before approved offline, compatibility, and upgrade gates.
- No reliance on the private backup as the only test fixture.
- No implementation estimates until M1 establishes the inventory and risk boundaries.
