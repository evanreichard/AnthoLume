# Frontend Migration Evaluation

M1 evaluation artifacts are available; its approval gate remains open. No frontend implementation, schema change, or dependency change has been made. The authoritative end-state checklist is [the migration design](../frontend-migration.md#milestones-and-exit-gates), not this report index.

## Evidence Map

| Report | Contents |
| --- | --- |
| [Workflow/API inventory](workflows-api.md) | 41 source-backed workflows, proposed operations, compatibility contracts, authorization/feature flags, acceptance cases |
| [Reader/offline](reader-offline.md) | Full reader/storage ownership assessment, document identity/position compatibility, sync probes, React boundaries, EPUB isolation and PWA requirements |
| [Architecture/tooling](architecture-tooling.md) | Backend boundaries, schema-first/code-first comparison, candidate frontend stack, security findings, test dispositions, packaging/CI |
| [Runtime baseline](runtime-baseline.md) | Isolated restored snapshot, dataset constraints, 32 passing HTTP checks, limits of runtime evidence |
| [Interaction design](interaction-design.md) | Two information-architecture proposals, mobile/desktop adaptations, text wireframes, state terminology, M2 visual brief |

These are evaluation artifacts with evidence and alternatives, not additional specifications silently overriding the migration design. Detailed recommendations are not approved merely because an agent wrote them. Exact dependency pins remain candidates until the resolved graph and representative operation proof pass.

## Consolidated Recommendation

**Ideal:** retain Go/Gin/SQLite/SQLC, design a schema-first web API, and build a mobile-first React application with explicit reader and persistence/sync boundaries. **Pragmatic delivery:** one end-to-end library/reader/offline slice against the same contracts, then complete the inventoried capabilities. No permanent dual frontend and no database rewrite.

- Prove `oapi-codegen` + request validation + TypeScript bindings against reads, mutations, errors, and binary operations before adopting the toolchain. Code-first Huma remains a fallback if the same contract is materially simpler. Current candidate dependencies entail a Gin upgrade: it must be tested, not smuggled in as tooling-only work.
- React/TypeScript/Vite, React Router, TanStack Query, CSS Modules/design tokens, selected unstyled accessible primitives, and Dexie are the proposed frontend foundation. Keep reader code lazy, browser persistence authoritative for pending events, and the query cache disposable.
- Reuse EPUB.js and KOReader-compatible document/position logic behind an engine/controller boundary, conditional on lifecycle and content-isolation proofs. Do not port the monolithic class into a component unchanged.
- Add only necessary server state. Rendering React and exposing JSON need no schema changes. Reliable web replay likely requires additive event receipts and shared progress revisions; durable administration jobs may justify another small table if that behavior is approved. Existing IDs, credentials, progress strings, activity, DIRECT imports, and protocol wire formats remain intact.
- Prefer per-event receipts and conservative conflict handling: a stale web progress update waits for an explicit local-versus-server choice, including intentional backward moves. KO writes keep their wire shape and advance the same server revision. Exactly-once credit applies only to identified new web events, not legacy KO requests lacking event identity.
- Use a fresh browser schema; no legacy browser books/settings/events need preservation. Retire the old root worker/caches once without repeatedly deleting new data.

## Product Decisions for M2

Navigation, logout retention, and initial activity measurement below are approved. Progress-conflict details remain proposed within the design's no-silent-overwrite invariant. The detailed registers include additional bounded implementation decisions; they need not become seventeen separate user questionnaires. Where source evaluation reports present alternatives, these approved choices and the migration design govern.

1. **Information architecture — approved:** proposal A: Library, Offline, Insights, and More workspaces, with reading as a focused full-screen route and a desktop navigation rail. Detailed layouts and visual direction remain M2 work.
2. **Progress conflicts:** recommend keeping stale local progress available and asking which position to use, rather than silently choosing last arrival or highest percentage. Backward reading remains valid. Activity can sync independently of a progress conflict.
3. **Logout/offline privacy — approved:** retain account-scoped downloads, hide them after explicit logout until the same account signs in, and pause original-account queued events. This is application-level separation, not encryption. Local-only books remain independent of login; session expiry alone does not disable offline reading.
4. **Activity measurement — approved:** initially preserve existing forward-page-turn/WPM credit rules while fixing loss, duplicate credit, and delivery. Active/idle/reread/TOC/close measurement redesign is separate evaluated work, not an implicit change to statistics during the migration.

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

## Recommended M2 Boundary

Complete the architecture gate and remaining progress-conflict details, then run focused tooling/reader/storage proofs alongside two visual directions on the approved four-tab information architecture. Keep M2 outputs small enough to discard; promote only code that satisfies the reviewed contracts. Complete operational policy decisions before implementing the affected administration workflows rather than guessing them now.

### Knowledge Capture

The schema executes before Goose migrations, and configured database location differs from some legacy backup/restore assumptions. Capture the approved migration/restore checks in `database/migrations/README.md` when those paths are changed; keep durable behavior in package documentation/tests rather than global agent guidance.
