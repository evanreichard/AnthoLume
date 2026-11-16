# M1 — Mobile-First Information Architecture and Interaction Proposals

**Recommendation:** one task-oriented reading application, not a React copy of the old screens. Make finding a book, reading it, and knowing whether it is available/saved the primary interactions.
**Status:** low-fidelity proposals for approval; no visual mockups or implementation. This completes the assigned IA proposal, not M1 runtime verification or milestone sign-off.

## Authority and evidence

- **Approved direction [M]:** [migration goal/success criteria](../frontend-migration.md#goal-and-scope), [mobile contracts](../frontend-migration.md#mobilepwa-and-reader-contracts), and [M1/M2 gates](../frontend-migration.md#milestones-and-exit-gates): ground-up redesign, mobile/PWA/offline/local-only support, preserved capabilities and server/KOReader/OPDS data contracts.
- **Capability evidence [W]:** [workflow matrix W01–W41](workflows-api.md#2-reading-the-capability-matrix), [domain semantics](workflows-api.md#4-document-metadata-and-acquisition-semantics), and [approval register D01–D17](workflows-api.md#9-decisions-requiring-approval). Shared documents are not private user libraries; progress snapshots are not append-only history.
- **Reader evidence [R]:** [inventory](reader-offline.md#1-current-capability-and-ownership-inventory), [position contracts](reader-offline.md#2-compatibility-contracts-document-identity-positions-and-units), [outbox/conflicts](reader-offline.md#5-reliable-outbox-deduplication-and-conflict-alternatives), and [platform behavior](reader-offline.md#7-mobileplatform-and-account-behavior).
- **Architecture evidence [A]:** [ownership/invariants](architecture-tooling.md#3-target-boundaries--proposed-end-state) and [frontend/storage proposals](architecture-tooling.md#6-frontend-foundations--concrete-proposals-not-installed-packages). UI state is not durable storage; reader controls and EPUB content have separate owners.
- These reports provide mostly static evidence, not observed user research or browser qualification. [A] reports passing backend baseline checks, not interaction proof. All layouts, numbers, policy defaults, and browser targets below are **unapproved proposals**.
- Preserve capabilities, not screen count. No annotations, bookmarks, in-book search, collections, new device-management controls, metadata-history browser, batch matching, or physical book purge. Legacy browser data needs **no compatibility or migration**; new-app data must remain durable. [M; W §8; R §1]

## Two feasible IA options

| | A — Ideal: task workspaces (recommended) | B — Pragmatic: compact task hub, same destination |
| --- | --- | --- |
| Mobile bottom navigation | **Library · Offline · Insights · More** | **Library · Offline · More**; Insights is a named entry in More |
| Library | Shared-library and Local-books scopes; server title/author search; document detail; Add sheet | Same scopes and operations; explicit paginated lists and full-page detail, fewer adaptive panels |
| Offline | One availability view over local originals and account-linked downloads; sync status opens a separate task | Same first-class view; straightforward status rows rather than an expanded storage dashboard |
| Insights | Overview: statistics, streaks, graph, leaderboard; Activity and Device progress subviews | Same capabilities under More → Insights, using simple accessible summaries/tables |
| More | Account, preferences, devices, synchronization, conditional Administration | Same destinations plus Insights; no miscellaneous duplicate library screens |
| Desktop | Persistent navigation rail; library/detail split workspace; optional reader TOC rail | Same rail destinations; list → full-page detail; admin tables adapt independently |
| Tradeoff/convergence | Best task visibility; more composition and responsive interaction work | One extra tap for insights, less initial composition. Promote the existing Insights route to a tab and add split panels; no data/API rewrite or second frontend |

Both options preserve the full capability map. B reduces presentation complexity, not durability, accessibility, administration, or security scope. Neither requires the old dashboard as the landing page. [M; W W09–W31]

### Navigation and ownership contract — proposed for both

- Default entry is Library when signed in, Local books when logged out; reopening the installed app always offers usable local navigation without awaiting session/capability requests. A never-loaded shell cannot launch offline.
- Library scopes explain ownership: **Shared library** is server-wide; **Local books** stays in this browser. Offline is an availability projection of those resources, not a duplicate collection or automatic server download.
- Add offers **Import locally**, **Upload to shared library**, and **Find online** only as applicable. No implicit upload or local-to-server position/activity transfer; a separate file upload remains an existing capability, not a new promotion workflow.
- Proposed route families: `/library`, `/offline`, `/insights` (overview/activity/device-progress), `/more`, `/sync`, `/books/:kind/:id`, `/read/:kind/:id`, `/admin/*`. Names are illustrative; opaque server IDs remain encoded and unchanged.
- Search, page, scope, and return position survive detail/reader/back navigation; empty search and end-of-list have explicit states. Keep current title/author search and recency ordering initially; extra sorts/filters and literal-vs-wildcard semantics require D05 approval.
- Bottom navigation has text labels and current-page semantics; sync counts use descriptive text, not an unexplained dot. Reader is immersive with an explicit Back target; hiding app tabs there is deliberate, not loss of navigation.
- Desktop replaces bottom tabs with a rail; wider space supports independent list/detail columns, constrained reading width, TOC beside text, and wider administration tables. Keyboard/browser Back work in split and full-page variants; no hover-only actions.
- React owns route/panel/focus state; the controller owns rendition/navigation; persistence owns committed books/checkpoints; sync owns replay/acknowledgements. Percentages and query-cache updates cannot prove saving or choose conflict winners. [A §3; R §§4–5]

## Core task journeys — proposed

| Intent | Path and meaningful outcome | Failure/recovery contract and evidence |
| --- | --- | --- |
| Find/resume | Library → title/author search → detail → Read/Resume; restore logical position | Preserve search/page on return; metadata-only, missing-file, unsupported-format, and unavailable-location outcomes differ. Never publish a fallback location until intentional navigation. [W W09–W13; R §2] |
| Read/control | Resume → next/back, TOC/internal links → font/theme/size → close/reopen | Visible controls, touch, gestures and keyboard are alternatives; reflow keeps the logical anchor, not a page number. Retain supported schemes/fonts and resume indication. [W W25/W31; R §§1–2] |
| Prepare for travel | Detail → Download for offline → verified Available → Offline → terminate/reopen → Read | Downloading/verification is not availability; failure offers retry, quota recovery, or re-download if evicted. Ordinary file export is separate. [W W13/W29; R O2/P1] |
| Read a private local file | Logged-out Local books → Import locally → validate/store → Read → reopen offline → Export or Delete local book | No login/device/provider request prerequisite, server record, or server activity. Invalid/quota failures leave no available orphan. [W W28; R O1] |
| Synchronize | Local durable checkpoint → Pending → reconnect/foreground → acknowledged progress/activity | Session expiry pauses delivery; lost responses retry the same identity; stale revision opens a choice. Stats refresh is separate from event acknowledgement. [W W26–W30; R O3–O5/S1–S2] |
| Maintain a shared book | Detail → Edit fields/cover, or Identify → preview → explicit Apply | Show global effect, revision conflicts, empty provider result versus failure, and partial cover failure. Single-result preview suffices; multiple candidates/history are not assumed. [W W15–W19; D07/D08] |
| Add server content | Add → Upload, or enabled Find online → source/query/results → Save → operation status → detail | Show provider limitations and created/existing disposition; errors/interrupted work are not success. Download completion does not imply offline availability. [W W14/W20/W21; D09] |
| Review reading/account | Insights → overview/activity/device progress; More → timezone/password/devices | Label current per-device snapshots, estimates, rolling leaderboard windows, timezone and aggregate freshness. Devices retain existing selection/list capability, not invented rename/delete/toggle UI. [W W05–W08/W22–W24; D04/D10/D11] |
| Authenticate/switch | More → Sign in or enabled Register → return to intended task; Sign out explains local data treatment | Wrong credentials stay recoverable; retain pending events for their original account, never replay as another account. Local-only library remains usable. [W W01–W04; D02/D03] |

## Text wireframes — proposed behavior, not visual styling

Notation: `[Action]` is a named control; percentages/titles are synthetic. Drawn chrome stays outside EPUB content. Bottom navigation shown for option A; B omits the Insights tab.

```text
LIBRARY — signed in                 DETAIL — server-linked
+--------------------------------+ +--------------------------------+
| Library       [Sync: 2 pending] | | [Back to results]        [More] |
| [Shared library] [Local books]  | | Title / Author                 |
| [Search title or author      ] | | Shared library · EPUB available|
| [Add]                          | | Resume: chapter 3 · 24%        |
| Title / Author                 | | [Resume reading]               |
| 24% · Available offline [Open] | | [Download for offline]         |
| Other title · Online only      | | or: Available [Remove download]|
| File unavailable        [Open] | | [Export file] [Edit] [Identify] |
| [Previous] Page 1 [Next]        | | Description / ISBNs / cover    |
| Library* Offline Insights More | | Reading summary · as of ...    |
+--------------------------------+ | [Activity] [Device progress]    |
                                   +--------------------------------+
```

Read/Resume and detail remain distinct targets. A metadata-only record replaces Read with “No file attached”; a physical-file failure says “Server file missing,” not “You are offline.” Unsupported historical formats retain file export without promising browser rendering. Global delete is inside More with explicit shared-library confirmation. [W W10/W13/W17; D06]

```text
READER — controls revealed          READER — recoverable position error
+--------------------------------+ +--------------------------------+
| [Back to Offline] Title [TOC]   | | [Back] Title                   |
|                                | | Saved location unavailable     |
|   EPUB content / own viewport  | | Your stored position is kept.  |
|   selection and links work     | | [Choose chapter] [Start book]  |
|                                | | No new progress until you      |
| [Previous] Chapter 3 [Next]     | | intentionally navigate.        |
| 24% · Saved on this device     | +--------------------------------+
| [Appearance] [Keep awake: off]  |
| [Sync: 2 pending]              | TOC/Appearance: labeled modal panel;
+--------------------------------+ Escape/Close returns focus to opener.
```

Center tap may toggle chrome; a named, keyboard/screen-reader reachable control also reveals it. No timed hiding while controls have focus. TOC, theme/font/size, chapter page/total and estimated progress remain available; hidden gestures are not the only entry. Wake lock failure never blocks reading. [R R3/R4; W W25/W31]

```text
OFFLINE — availability              STORAGE FAILURE / EVICTION
+--------------------------------+ +--------------------------------+
| Offline              [Import]  | | Offline                        |
| Local books · no account needed| | Title · Download unavailable   |
| Title · Available       [Read] | | [Download again when online]   |
| [Export] [Delete local book]   | | Storage full: download stopped |
| Account: example               | | [Manage downloads] [Retry]     |
| Server title · Available [Read]| | Local original missing:        |
| [Remove download]              | | Re-import the exported EPUB.   |
| Next title · Downloading 42%   | | Pending reading is kept if its |
| Third title · Verifying...     | | stored events remain intact.   |
| Library Offline* Insights More | +--------------------------------+
+--------------------------------+
```

“Available” follows verified bytes and required metadata, including offline rendering dependencies; recheck on open. Removal frees only the account's downloaded bytes, retaining pending events and server data. Local deletion warns that this browser may hold the only original and offers export; no guaranteed undo is implied. Never automatically evict local originals or unsent events to make room. [R §4/O1/O2; W W28/W29]

```text
SYNC — account-scoped               CONFLICT — one book, no auto-winner
+--------------------------------+ +--------------------------------+
| [Back] Synchronization          | | [Back] Choose resume location  |
| Account: example               | | This device: chapter 3 · 24%   |
| Saved here: 2 pending events    | | Server: chapter 5 · 41%        |
| Offline · will retry in app    | | Device: KOReader · received ...|
| or: Sending / Server confirmed | | Neither is chosen by percent.  |
| or: Sign-in needed [Sign in]   | | [Use this device's location]   |
| or: Retryable error [Retry]    | | [Use server location]          |
| or: Progress conflict [Review] | | [Decide later]                 |
| Invalid book/event [Details]   | | Activity sync is independent.  |
+--------------------------------+ +--------------------------------+
```

- **Copy contract:** “Saved on this device” only after durable commit; “Server confirmed” only after validated acknowledgement. Pending/offline/auth-required/retrying/conflict are separate from book availability. Do not label network reachability as successful synchronization.
- **Storage write failure:** “Could not save your position on this device”; stop claiming saved, offer retry/storage guidance and original-file export where available. Browser clearing/eviction can lose data; do not promise recovery of missing events.
- **Conflict proposal (D13):** stale web progress waits for a deliberate choice; allow backward moves. This-device choice submits against the current shared revision; server choice explicitly replaces the local resume candidate after confirmation. Explain this effect before committing; Decide later preserves both candidates and may continue local reading without publishing stale progress.
- Keep the conflict recoverable across restart and preserve independent reading activity. If the server changes during resolution, show the refreshed choice; do not overwrite again automatically. Block/reconcile subsequent progress in order. Times/device names provide context, not ordering authority. [R §5; W D12/D13]

## Logged-out, session-expired, and update behavior

- Local books, reader appearance, import/export/delete and saved local position remain available with no account. Logged-out shell offers Sign in, optional Register, and a clear “Local books stay in this browser” explanation; no login wall or device setup. No local activity analytics are added. [M; W W28]
- **Logout proposal D03:** ideal offers keep account downloads locked or remove downloaded bytes; pragmatic removes server bytes but retains locked pending events. Explain that local books remain. Retention/account scoping is not encryption against another person using the same browser profile.
- **Session expiry proposal D03:** allow previously authorized downloaded reading in the same retained account context; pause replay and clearly require same-account sign-in to synchronize. Explicit logout locks that context; a different account never sees/replays it. Offline access after expiry and locked-context reopening need approval, not an assumed offline identity guarantee.
- Account deletion/forbidden/deleted-book events remain visible as blocked work; provide reasons and explicit resolution before discard. Global tombstone/offline access policy is D06, not a cache-removal side effect.
- New-app update: “Update ready — apply after closing the book”; never force reload during reading or erase new books/events. Incompatible API/schema pauses replay with recovery guidance. Background Sync is optional; foreground/startup/reconnect are sufficient correctness triggers.
- Legacy cutover may reset old books/preferences/cache/events once, with release notice; do not build old-key adapters. Keep installed identity and useful server reader links intentional. Retiring old workers must not repeatedly reset new storage. [R §§7–8; A §6]

## Administration — preserved operations, separate task space

Administration is a capability-gated More destination, not a reader tab. Desktop uses a subnavigation/work table; mobile uses grouped task lists, stacked summaries, and labeled per-record actions rather than squeezed tables. All privileged actions require server authorization. [W W32–W41]

- **Users:** list/create, password reset, role change, delete; explicit target and fresh authorization for destructive/privilege actions, last-admin failure explained, recovery artifact failure blocks deletion. Shared books are not deleted with the user.
- **Import:** authorized server root/path → choose **Link in place (DIRECT)** or **Copy into managed storage (COPY)** → consequences/confirmation → running status → SUCCESS/EXISTS/FAILED results with counts and retry guidance. Root/symlink policy remains D15.
- **Backup:** choose DB plus optional managed books/covers → show external-file omissions → create/verify → download artifact. “DB-only” is not “complete library.” **Restore:** upload → validate coverage/warnings → confirm replacement/re-auth → maintenance → explicit recovery outcome; no destructive action before verified rollback readiness.
- **Maintenance/logs:** statistics refresh with truthful completion/freshness; bounded filtered logs with paging, safe errors/redaction. Preserve filtering capability; arbitrary jq retention/removal needs D17 approval. No working batch-metadata button for the existing TODO.
- Long operations expose stage, known counts, partial success, interrupted/failure state and safe retry; reconnect can observe status. No fabricated progress, cancellation during unsafe restore stages, or promise to resume destructive work after crash. Job/restore policy remains D09/D16. [W §7]

## Accessibility and mobile platform contracts — proposed acceptance

- Target **WCAG 2.2 AA** for application chrome; document EPUB-content limitations separately without claiming arbitrary publisher content conforms. Semantic landmarks/headings, named controls, visible focus, logical order, and text equivalents for graphs/status are required.
- Propose 44 × 44 CSS-pixel touch targets with spacing; contrast ≥4.5:1 ordinary text and ≥3:1 large text/control boundaries; status never relies only on color. Support 200% text resize, browser/pinch zoom, 320 CSS-pixel reflow, and reduced motion. Layouts may stack rather than truncate critical actions.
- Reader previous/next/TOC/appearance are keyboard and assistive-technology reachable; shortcuts do not intercept typing/selection. Dialogs contain focus, Escape closes, focus returns; chapter changes preserve logical reading order without announcing every page-turn metric. Test VoiceOver and TalkBack, including EPUB frames.
- Respect all safe-area edges, dynamic viewport/browser chrome, software keyboard, landscape, split-screen, and large system text. Reader panels must not cover focused controls or trap scrolling. Gestures coexist with text selection, links, and OS edge navigation.
- Feature-detect wake lock, installation, persistence and sharing/export; no hidden media-playback requirement. Denied storage gives a truthful non-durable/unavailable state, never a false offline promise. File picker and ordinary download are baseline import/export paths.
- Qualification covers full termination/relaunch offline, screen lock/background, quota/eviction, concurrent tabs, account switch, and app/SW updates. Physical installed iOS/Android evidence is required; desktop emulation/WebKit automation is supplementary. EPUB script/network isolation must pass security proofs, not just UX testing. [M; R §§6–7/P1/P3]

## Proposed budgets and browser support — approval required, not measured

| Candidate acceptance target | Measurement/qualification |
| --- | --- |
| Shell ≤300 KiB compressed initial JS; reader route ≤500 KiB additional JS; offline shell assets ≤5 MiB excluding books/covers | Production transfer/build report, lazy reader loading; no remote font/CDN dependency for offline reading. Revise only with evidence |
| Library first usable ≤2.5 s cold online; local Offline list ≤1 s warm; downloaded EPUB opens ≤3 s at p75 | Mid-range physical Android and supported iPhone; online profile 10 Mbps/100 ms RTT; synthetic 10,000-book server library, 100 local records, 5 MiB text EPUB. First import/download and heavy books reported separately |
| Settled page turn ≤150 ms p95 after section load; ordinary control response ≤100 ms | Measure chapter transition/reflow separately (target ≤1 s p75); record device, book/spine/image scale and repeated open/close memory trend; no invented universal memory ceiling |
| Accepted position/event durable before saved UI; deliberate navigation checkpoint target ≤250 ms p95 | Fault-inject termination around transaction boundaries. No accepted-event loss; activity checkpoint/idle loss bound is separately gated by D12, not guaranteed by this timing target |
| Foreground replay starts ≤5 s after usable connectivity/auth; aggregates ready or visibly stale, target refreshed ≤60 s after accepted activity | Excludes server outage/backoff and user-blocked conflicts; measure server generation rather than infer from animation. D09/D10 must approve load/freshness limits |
| Initially qualify iOS/iPadOS **17+ Safari**, tab and installed; maintained Android Chrome, tab and installed; current and previous stable desktop Chrome/Edge/Firefox/Safari | Candidate matrix aligned with [A §6], not approved support. Record exact oldest/current OS, browser, hardware and install mode at qualification; ongoing release policy and available physical older devices need approval |

Legacy browser **data** compatibility is excluded; this does not mean “all browser versions supported” or permission to lose new storage. Avoid polyfills/adapters solely for legacy frontend formats. Unsupported/denied capabilities degrade explicitly; no browser receives an “offline ready” claim without passing storage/restart tests. Current source does not establish these budgets or supported versions. [M; R §7; A §6]

## Approval gates and M2 visual exploration brief

- Approve A or B and labels/default entry; D01 shared mutation/demo permissions; D03 offline/logout privacy; D04 device assumption; D05 search; D06 deletion/repair; D07/D08 provider privacy/metadata apply; D10–D14 analytics/activity/conflicts/reader safety; D09/D15–D17 operational policies. This IA chooses no API error envelope/toolchain over the other evaluations' pending alternatives.
- Approve browser matrix, accessibility/performance targets, measurement fixtures and physical-device access. No estimates, implementation authorization, or milestone completion follows from this report.
- **M2 ideal:** explore two coherent visual directions on the selected IA: reading-led (editorial typography, quiet chrome) and utility-led (compact legible lists, explicit status). Compare identical tasks/content, not different product scope. Define type, color, spacing, focus, touch, light/dark and all semantic state tokens.
- **M2 pragmatic:** explore both directions on Library/Detail/Reader first, select one, then extend the same tokens/components to Offline/Sync/Admin before approval. This reaches the same complete system, not a library-only redesign.
- Prototype 360/390 CSS-pixel phones, 320 reflow, landscape/tablet and ~1280 desktop: library/search/detail return, reader TOC/appearance, local logged-out import, verified download/offline restart, expired auth, quota/eviction, conflict/defer/backtracking, update prompt, destructive admin confirmation. Use synthetic EPUBs/accounts; no private snapshot/screenshots.
- Run task walkthroughs: find/resume without losing results, distinguish all three removal actions, explain “saved here” versus “server confirmed,” choose a lower progress intentionally, and read local-only without login. Record completion/errors/confusion, keyboard/focus and assistive-technology failures; do not invent user-research results or numeric success rates before recruiting/approval.
- Exit with approved responsive components/states, annotated interaction flows, acceptance cases mapped to [W T05/T06/T08–T32/T33–T41] and [R R1–R4/O1–O5/P1–P3], and focused technical proofs. Visual exploration must not substitute for durability, security, or KO position evidence. No images are produced by this M1 assignment.

## Task-end report

- **Assumptions made:** existing routed capabilities define preservation scope; source evaluations are not runtime/user-research evidence.
- **Decisions made autonomously:** recommended task workspaces and conservative conflict UX; kept every detailed policy/budget/platform choice proposed; wrote only this assigned document.
- **Compromises:** text prototypes cannot validate visual hierarchy or physical-device behavior; M2 and qualification must supply that evidence. Knowledge capture: after approval, place save/availability/removal terminology beside frontend interaction acceptance tests, not in global agent guidance.
