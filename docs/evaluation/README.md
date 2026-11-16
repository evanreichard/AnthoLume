# Frontend Migration Evaluation

M1 is approved and M2 execution is authorized. Focused implementations live only in discardable prototype modules; the production frontend, server schema, and root dependency graph are unchanged. The authoritative end-state checklist is [the migration design](../frontend-migration.md#milestones-and-exit-gates), not this report index.

## Evidence Map

| Report | Contents |
| --- | --- |
| [Workflow/API inventory](workflows-api.md) | 41 source-backed workflows, proposed operations, compatibility contracts, authorization/feature flags, acceptance cases |
| [Reader/offline](reader-offline.md) | Full reader/storage ownership assessment, document identity/position compatibility, sync probes, React boundaries, EPUB isolation and PWA requirements |
| [Architecture/tooling](architecture-tooling.md) | Backend boundaries, schema-first/code-first comparison, candidate frontend stack, security findings, test dispositions, packaging/CI |
| [Runtime baseline](runtime-baseline.md) | Isolated restored snapshot, dataset constraints, 32 passing HTTP checks, limits of runtime evidence |
| [Interaction design](interaction-design.md) | Two information-architecture proposals, mobile/desktop adaptations, text wireframes, state terminology, M2 visual brief |
| [M2 API/schema proof](m2-api-contract.md) | Executable strict Go/TypeScript generation, validation, binary, receipt and CAS evidence with promotion limits |
| [M2 reader/storage proof](m2-reader-storage.md) | Executable reader lifecycle/codec, browser persistence, account and replay evidence with parity/security limits |
| [M2 actual HTTP integration](m2-integration.md) | Real browser/Go HTTP and replay/CAS composition; [independently accepted, 10 tests](m2-integration.md#independent-acceptance) |
| [M2 reader isolation feasibility](m2-reader-isolation.md) | Retained opaque-topology falsification, not a competing production design or unfinished stronger-boundary requirement |
| [Worker retirement/reset contract](service-worker-contract.md) | Defined cleanup/coordination/preservation contract; runtime M3/M5 test matrix remains unexecuted |
| [M2 visual directions](m2-design.md) | Browser-viewable Folio/Index prototypes and automated interaction checks; user selected Folio/editorial, full human walkthrough pending |

These are evaluation artifacts with evidence and alternatives, not additional specifications silently overriding the migration design. Detailed recommendations are not approved merely because an agent wrote them. Resolved prototype graphs and representative bounded proofs passed independent closure. These pins are evidence for evaluation, not approval to change the root dependency graph or promote production code.

## Consolidated Recommendation

**Ideal:** retain Go/Gin/SQLite/SQLC, design a schema-first web API, and build a mobile-first React application with explicit reader and persistence/sync boundaries. **Pragmatic delivery:** one end-to-end library/reader/offline slice against the same contracts, then complete the inventoried capabilities. No permanent dual frontend and no database rewrite.

- The bounded `oapi-codegen` + validation + TypeScript proof passed for representative reads, mutations, errors and binary operations. Use schema-first for the vertical slice, conditional on real integration and promotion gates. The isolated graph entails Gin/dependency and Go 1.26.11 toolchain upgrades; root adoption is separate tested work, not a tooling-only change.
- React/TypeScript/Vite, React Router, TanStack Query, CSS Modules/design tokens, selected unstyled accessible primitives, and Dexie are the proposed frontend foundation. Keep reader code lazy, browser persistence authoritative for pending events, and the query cache disposable.
- Reuse EPUB.js and KOReader-compatible document/position logic behind the selected single-origin hardened frame boundary, with independently accepted representative compatibility/security proof and later production qualification. The trusted renderer shares the app origin; untrusted chapters have no scripts, strict before-parse CSP, validated archive assets and controller-mediated internal navigation. No extra hostname or unsafe `allowScriptedContent` workaround. The user accepts trusted-renderer bug blast radius at the app origin; dedicated-origin isolation is optional future hardening, not a requirement.
- Add only necessary server state. Rendering React and exposing JSON need no schema changes. Reliable web replay likely requires additive event receipts and shared progress revisions; durable administration jobs may justify another small table if that behavior is approved. Existing IDs, credentials, progress strings, activity, DIRECT imports, and protocol wire formats remain intact.
- Prefer per-event receipts and conservative conflict handling: a stale web progress update waits for an explicit local-versus-server choice, including intentional backward moves. KO writes keep their wire shape and advance the same server revision. Exactly-once credit applies only to identified new web events, not legacy KO requests lacking event identity.
- Use a fresh browser schema; no legacy browser books/settings/events need preservation. Retire the old root worker/caches once without repeatedly deleting new data.

## Product Decisions for M2

Folio/editorial, navigation, logout retention, initial activity measurement, and conservative progress-conflict direction below are selected. Detailed interaction validation remains part of M2. The detailed registers include additional bounded implementation decisions; they need not become seventeen separate user questionnaires. Where source evaluation reports present alternatives, these approved choices and the migration design govern.

1. **Information architecture and visual direction — selected:** retain proposal A's four tabs (Library, Offline, Insights, More), desktop navigation rail, focused full-screen reader and early Read/Resume visibility on detail. The user selected Folio/editorial in structured browser review. This is human creative selection, not full interaction, phone, installed-PWA or technical acceptance; the full human walkthrough remains open.
2. **Progress conflicts — selected direction:** keep stale local progress available and ask which position to use, rather than silently choosing last arrival or highest percentage. Backward reading remains valid. Activity can sync independently of a progress conflict. Bounded real HTTP/replay/CAS proofs are independently accepted; production durable resolution ownership/history and human interaction acceptance remain open.
3. **Logout/offline privacy — approved:** retain account-scoped downloads, hide them after explicit logout until the same account signs in, and pause original-account queued events. This is application-level separation, not encryption. Local-only books remain independent of login; session expiry alone does not disable offline reading.
4. **Activity measurement — approved:** initially preserve existing forward-page-turn/WPM credit rules while fixing loss, duplicate credit, and delivery. Active/idle/reread/TOC/close measurement redesign is separate evaluated work, not an implicit change to statistics during the migration.
5. **EPUB boundary — explicitly selected:** single-origin hardened EPUB.js frames as described above. The [isolation report](m2-reader-isolation.md) disproves the opaque outer-frame/passive-descendant topology, not the accepted single-origin policy. The [selected-policy representative proof](m2-reader-storage.md#independent-closure) is independently accepted, including ordinary CSS/fonts/SVG/internal navigation and source-body preservation. No extra hostname or stronger-boundary proof is required; broader production qualification remains open.

## Scope Defaults for Review

Proposed defaults minimize unrequested product changes. Any divergence should be recorded as a changed contract before implementation.

- Preserve the shared library, current user/admin role model, leaderboards visible to logged-in users, existing statistics/window math, optional search, and DIRECT/COPY import capabilities. Do not invent private libraries, opt-in leaderboards, annotations, bookmarks, or new device-management operations.
- Fix demonstrated safety/correctness defects rather than reproducing them: HTTP-error acknowledgements, duplicate web replay, stale privilege/session state, unbounded/unsafe input handling, unsafe EPUB content execution, and destructive restore hazards. Security fixes can deliberately reject unsafe inputs; valid server data/protocol behavior remains supported.
- Keep legacy KO receipt-order limitations explicit. New web guarantees cannot recover identity/order information old clients never send.
- Do not silently remove jq log filtering, automatic metadata lookup, device assumption, tombstone/re-add semantics, or existing activity/statistics policies. Evaluate safer implementations; ask before removing a real capability or changing its meaning.
- Prefer a small bounded operation worker over a general queue framework if jobs are needed. Restart-resilient jobs, cancellation, retention, restore boundaries, and filesystem-root restrictions remain proposals requiring operational review.
- Candidate support floor is iOS/iPadOS 17+ plus maintained Android Chrome and current desktop browsers. WCAG 2.2 AA for application chrome and performance budgets in the interaction report are proposals, not measured guarantees or approved exclusions.
- Preserve server upgrade behavior, but do not equate server upgrade support with guaranteeing every historical backup format or automatic rebinding of arbitrary external paths. The supplied snapshot and supported deployment paths must be explicitly qualified.

## Findings That Affect Scope

- Existing tests/vet/race/native build pass, but the suite does not establish HTTP auth, browser/PWA, compatibility wire, or populated-database upgrade correctness.
- Synthetic probes reproduce duplicate activity credit, stale progress overwrite, timestamp ties, and device-owner gaps. Reliable replay requires server participation, not just a client storage library.
- The snapshot already has two orphan metadata references and 90 external-basepath document rows. New migrations must accommodate existing data without silently deleting or relocating it.
- Backup/restore, asynchronous refresh/shutdown, and reader script isolation have source-backed hazards. Their replacement implementations need targeted acceptance tests; no exploit or physical-device proof is claimed.
- M1 contains source-backed parity inventory plus representative HTTP smoke evidence. Browser behavior, mutation/failure scenarios, full runtime parity, generator integration, visual design, and physical-device qualification remain later gates—not completed findings.

## M2 Checkpoint and Remaining Gates

Independent closure accepts the bounded [API](m2-api-contract.md#independent-closure), [reader/storage](m2-reader-storage.md#independent-closure) and [design](m2-design.md#independent-closure) proofs. API evidence includes all 12 owner fault checks independently reproduced; final reader evidence is owner 38 browser + 20 unit tests, with independent 11 targeted browser + 20 unit closure and source/identity/lifecycle probes; design evidence is 53 browser tests, 84 layout checks and static confinement checks. These are distinct scopes, not an aggregate production acceptance suite. Test definitions/dispositions are complete only for those scopes; no production parity tests were retired.

**Selected:** Folio/editorial by the user in structured browser review, retaining four tabs, desktop rail and early Read/Resume. **OPEN:** the full human [interaction walkthrough](m2-design.md#review-these-journeys), including the short-height caveat, and the M2 exit gate. Visual selection does not establish full interaction, phone/PWA or technical validation.

**Accepted M2 evidence:** [actual browser/Go HTTP integration](m2-integration.md) and representative replay/CAS, runtime receipt validation, lost-response retry/deduplication and explicit stale-progress resolution are [independently accepted — 10 browser tests](m2-integration.md#independent-acceptance). This is fixture-scope composition, not full DTO validation or production authentication/KO/upgrade acceptance. The [legacy worker-retirement/reset contract](service-worker-contract.md) is defined, including allowlisted cleanup, bounded client coordination, failures and unrelated/new-schema preservation; its runtime matrix remains M3/M5 work.

**Technical M2 proof scope accepted:** the [single-origin reader closure](m2-reader-storage.md#independent-closure) verifies representative CSS/fonts/SVG/internal navigation, passive chapters/early CSP, original bytes/body and lifecycle/codec behavior. The trusted renderer shares app-origin privileges by explicit user choice; no extra hostname is required. The [failed opaque prototype](m2-reader-isolation.md) is retained falsification evidence, not an alternate production frontend or an unfinished required stronger boundary. Legacy worker retirement is checked as a defined contract, not runtime execution. **Only the full human interaction walkthrough and M2 exit remain unchecked.** See the [bounded M2 checklist](../frontend-migration.md#m2--contract-and-mobile-interaction-proofs).

**Subsequent promotion gates (not M2 prerequisites):** M3 requires broad real EPUB security/benign-feature compatibility and archive-exhaustion handling, actual KOReader round trips, production Go HTTP/auth/CSRF/durable receipt/shared-revision integration including KO writers, cold offline shell/full restart and actual legacy SW retirement. Production migrations and deployment dependency compatibility remain implementation/upgrade qualification, not bounded tooling-proof acceptance. Before production dependency adoption, qualify the root Go patch level/security-sensitive graph with a patched supported toolchain, reproducible builds, dependency verification and vulnerability scans; accepted nested-graph results do not qualify the root graph. M4 requires complete workflow/parity and external-protocol evidence; M5 requires physical-device installed-PWA, failure, upgrade, isolation and compatibility qualification. See the [authoritative M3–M5 checklist](../frontend-migration.md#m3--end-to-end-reader-and-offline-vertical-slice) and each proof's limits. These requirements are unchanged and not waived or duplicated as prerequisites to starting those milestones; the M2 ideal remains representative real-operation and boundary proof, not merely passing existing fixtures.

[Prototype commands and boundaries](../../prototypes/README.md) cover the discardable nested modules. No permanent parallel frontend/API is introduced; remove or deliberately promote proofs only against reviewed contracts. Complete operational policy decisions before implementing affected administration workflows.

### Knowledge Capture

The schema executes before Goose migrations, and configured database location differs from some legacy backup/restore assumptions. Capture the approved migration/restore checks in `database/migrations/README.md` when those paths are changed; keep durable behavior in package documentation/tests rather than global agent guidance.
