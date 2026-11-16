# M2 — Two browser-viewable visual directions

**Delivered:** a standalone, pinned React/TypeScript/Vite design prototype in [`prototypes/design`](../../prototypes/design/README.md). Both directions cover the approved four workspaces, immersive sample reader, desktop rail/split detail, and the same mock journeys. This is visual/interaction evidence, not approval of tooling, sync policy, or production implementation.

## Launch and compare

From the repository root (Node 22.12+; verified on 22.23.4):

```sh
npm --prefix prototypes/design ci
npm --prefix prototypes/design run audit
npm --prefix prototypes/design run build
npm --prefix prototypes/design run preview
```

The review preview serves **only built `prototypes/design/dist` on 127.0.0.1:5173**, without Vite dev middleware, repository fallback or directory listing. Dotfiles, missing paths, traversal, and symlinks escaping dist are rejected. Stop it with Ctrl-C. `npm --prefix prototypes/design run dev` remains loopback-only for editing; do not broaden/tunnel that bind or serve the repository root.

- **A · Folio:** http://127.0.0.1:5173/?direction=folio&theme=light#/library
- **B · Index:** http://127.0.0.1:5173/?direction=index&theme=light#/library
- **Conflict:** http://127.0.0.1:5173/?direction=folio&theme=light#/sync?state=conflict
- **Reader:** http://127.0.0.1:5173/?direction=index&theme=dark#/read/tidal

Use the toolbar to switch directions or light/dark without losing the current journey. The URL captures direction, scheme, route, and library scope/query. Per-book reader chapter/appearance/chrome, mock content/account state and the admin confirmation outcome survive internal navigation in memory and reset on reload. Scroll snapshots are tied to matching reader contexts. The shared static review preview is currently running on loopback 5173; human validation is pending. The commands above reproduce it when needed; do not start an editing server over the running preview.

**Ideal review:** compare both directions end to end on a phone and desktop, then choose one composition before production components are promoted. **Pragmatic review:** compare Library → detail → reader at 390px and 1280px first, shortlist one, then use the same app to verify Offline/Sync/More before accepting it. Both paths reach the same complete interaction scope.

## What is genuinely different

| | Folio · editorial / reading-led | Index · precise / utility-led |
| --- | --- | --- |
| Composition | Large reading invitation, angled edition, four-cover desktop shelves / two-cover mobile shelves | Compact resume strip, straight thumbnail, explicit status rows and aligned desktop actions |
| Typography | System Georgia display and descriptive prose; quiet sans-serif chrome | System sans-serif hierarchy, strong compact titles, tabular status numerals |
| Density | Spacious shelf rhythm, large detail edition and literary description | More titles/status visible, smaller detail edition, tighter tables and panels |
| Structure beyond Library | Open reading/statistics summaries; warm paper and subdued dividers | Bordered operational cards, denser menus, stronger active-rail edge |
| Light/dark | Paper, forest, clay / deep green and pale clay | Cool neutral, blue / deep slate and light blue |

Original CSS covers, icon paths, book names, account names, and sample prose only. No remote assets/fonts or private snapshot access. Both retain exactly **Library · Offline · Insights · More**. Reading removes the application rail/tabs and offers Back, Contents, Appearance, previous/next, and optional quiet chrome. Desktop reader adds a contents column.

The CSS token set covers surfaces, text, dividers, accent, success, warning, danger and focus, with independent dark palettes. Semantic state text accompanies color. Main chrome uses system sans; sample text defaults to 20px system serif and supports 16–28px / sans. Native controls, visible keyboard focus, headings/landmarks, pressed/current semantics, modal Tab wrapping/Escape/focus return, dynamic viewport sizing, safe-area padding and reduced-motion rules are implemented. This is not a WCAG conformance claim.

## Review these journeys

1. **Find and return:** Library → search `Mara` or `Ordinary` → title → Resume → browser Back twice. Search, scope and scroll are retained. At 1280px detail sits beside the results, not on an enlarged phone canvas. Try an unmatched query and clear it.
2. **Read and control:** Contents → chapter 2; Appearance → sans / 26px / Ink; Escape returns to the opener. Next/Previous, arrow keys and TOC selection focus and reveal the chosen chapter heading, including the final chapter. Inspect Sync and use either in-app Back or browser Back: the same chapter, appearance, chrome and matching viewport return. Quiet reading keeps an explicit Show controls button and the low-position Sync escape. Every chapter intentionally repeats the same original sample passage; this is **not an EPUB engine** and produces no activity credit.
3. **Distinguish removals:** Offline → Remove download keeps shared book and pending events. Delete local book warns about the only original/no undo and offers a real synthetic `.txt` export (not an EPUB backup). Book detail → More book actions → Delete shared book explicitly affects everyone. Each has its own confirmation and mock effect; no implicit undo. Successful Offline removal focuses the next/previous available sample action or the emptied section heading; detail removal focuses the book or destination heading. Cancel/Escape still restores the opener.
4. **Logout and local reading:** More → Sign out → retain downloads. Offline still exposes local originals but hides retained account downloads and pauses original-account events. Add a synthetic local sample without login. Sign in as Alex Rowan to reveal retained downloads. Shared reader/detail deep links are guarded after logout; all Sync deep links show only generic paused/reauthentication content, with no account names, book/device/chapter/percentage metadata or scenario selector. This is application-level separation, not encryption.
5. **Inspect failures/conflicts:** Synchronization scenario selector covers pending, auth required, storage full, conflict, retryable delivery error, and missing download. Session expiry leaves offline samples readable, unlike explicit logout. Conflict offers **24% (earlier)** and 41%, then explains the consequence before confirmation; defer keeps both. No automatic highest-percentage winner. Activity is independent and unchanged. Detailed resolution/revision behavior remains a proposal.
6. **Insights and administration:** Insights offers synthetic overview/graph/leaderboard, activity and current device snapshots, with UTC/freshness and credit-rule caveats. More → Review removal requires typing `Sam Reed`; cancel/Escape restores focus. Its disabled “Removed in demo” outcome survives leaving More until reload; success focuses the More heading rather than the disabled opener. The illustrative leaderboard remains an explicitly static historical snapshot. The confirmation preserves shared books and describes real authorization/recovery requirements without pretending to perform them. More also previews a deferred update notice.

## Independent review disposition

All D1–D6 findings are addressed within the design prototype; **neither art direction is selected**.

| Finding | Resulting boundary / visible behavior |
| --- | --- |
| D1 · dev-host exposure | Compatible exact Vite 7.3.8 pin/lock, fresh audit, loopback editing server, dist-only static review script; synthetic deny-query check passes. |
| D2 · reader context lost | DemoState owns per-book chapter/font/size/paper/chrome until reload. History owns scroll tagged with that rendering context; a mismatch starts at the top rather than restoring another chapter's bottom. |
| D3 · chapter focus | Reader owns intentional heading focus/reveal; TOC close requests that same target. Escape/cancel retains normal opener restoration. |
| D4 · successful-removal focus | List/detail owners provide the post-success target. Empty sections get focusable headings; disconnected/disabled openers fall back to a route heading. |
| D5 · logged-out metadata | Sync returns a generic paused/reauthentication screen before rendering account content. Expired-session reading remains a separate, accessible scenario. |
| D6 · inconsistent mock outcome | The member-removal visual outcome lives in DemoState until reload. No real administration or aggregate mutation is implied. |
| Mobile primary action | Read/Resume precedes long description and progress detail. Compact mobile editions keep the action inside the initial tested viewport, while Folio keeps literary composition and Index a denser thumbnail/prose treatment. |

State ownership is deliberate: Reader retains only open-panel/intentional-focus state; DemoState retains transient book sessions and mock operation results; history retains per-entry viewport snapshots. Dialog owns modal lifecycle/Tab boundaries and resolves the owner's explicit close-focus destination. No adapter to an API, reader engine or persistent store was added.

## Actual verification

Pinned app/tool versions: React/React DOM **19.1.1**, TypeScript **5.9.2**, Vite **7.3.8**, React plugin **5.0.3**, Playwright **1.55.1**. Exact transitive graph is in the prototype-only `package-lock.json`; no root dependency changes.

Passed on Linux with Node **22.23.4** and Nix-wrapped Chromium **156.0.8078.79**:

- `npm --prefix prototypes/design run typecheck` — passed.
- Clean `npm --prefix prototypes/design ci`, then build — passed. Output: HTML 0.49 kB, CSS 48.84 kB (9.78 kB gzip), JS 238.59 kB (73.66 kB gzip). These are build sizes, not measured mobile startup performance.
- `npm --prefix prototypes/design run audit` — **zero reported vulnerabilities**, including development dependencies. Exact installed graph passes `npm ls --all`; audit JSON and graph are under `_scratch/m2/design/audit-after.json` and `dependency-graph-after.json`. This is point-in-time evidence, not an absence-of-risk guarantee.
- `npm --prefix prototypes/design run test:preview` — **2 Node tests passed**: built HTML/assets/HEAD, fixed loopback binding, blocked repository/dev/dotfile/traversal/missing paths, invalid URI and unsupported method.
- A separate isolated synthetic-marker probe with patched Vite returned **403 for both `/.env` and `/.env?raw`**, without disclosing the marker. Only `_scratch/m2/design/security-fixture` was allowlisted; no private/host file was probed. Script/log: `check-vite-deny.mjs`, `vite-deny.log` in that scratch directory.
- **53 Playwright tests passed**: all 37 original cases plus 16 new review regressions (8 per direction). No test is skipped. The 16 added regressions failed against the reviewed implementation before fixes; the strengthened suite is green after fixes. Full final log: `_scratch/m2/design/test-review-final.log`. The **same 53 cases also passed against the dist-only static server** using an independent scratch configuration on loopback 5316; this is a second execution, not 53 additional unique tests. Static log/config: `static-browser-final.log`, `playwright-static.config.mjs` under the same scratch directory; its screenshots/results stayed under that owned directory and its server closed afterward.
- Layout matrix: **2 directions × 2 schemes × 3 widths (320/390/1280) × 7 routes = 84 route/viewport checks** with no document horizontal overflow or page errors. Desktop rail and split detail visibility are asserted.
- New assertions cover Reader → Sync → in-app/browser Back at 26px/sans/Ink, per-book chrome/appearance isolation, rejection of stale-context scroll, chapter transition focus (including TOC cleanup and final chapter), successful removal focus for nonempty/empty lists and detail routes, all six logged-out Sync scenarios without metadata, expiry reading access, admin navigation persistence/reload reset, and initial **320×844 / 390×844** Read/Resume visibility above the description and fixed navigation.
- Browser Back still preserves author/title results and scroll; route focus reaches the selected desktop detail heading. Original modal Tab boundaries, Escape/opener restoration, lower-position/defer, removal scope and typed admin gates remain covered.
- Screenshot sweeps assert **no external resource requests**. They regenerate **52 PNGs** (26 viewport + 26 full-document) in `_scratch/m2/design/screenshots/`. Added 320px detail and logged-out Sync captures make the usability/privacy fixes reviewable. Both 390px directions, 320px Folio detail and both logged-out Sync captures were opened for visual inspection; Index retains a compact edition/prose treatment rather than merging with Folio.
- Screenshot output override was independently exercised with `M2_SCREENSHOT_DIR` pointing to `_scratch/m2/design/configurable-output-check`: both screenshot tests passed and wrote all 52 PNGs there. The full static replay additionally regenerated 52 under `static-screenshots`. Resource isolation compares the configured `baseURL` origin, so an independent static review port is supported without weakening the no-external-request assertion.

Reproduce browser checks, with the automatic test server on **5313**:

```sh
cd prototypes/design
CHROMIUM_PATH="$(nix build nixpkgs#chromium --no-link --print-out-paths)/bin/chromium" npm test
```

On a non-Nix platform, `npx playwright install chromium && npm test` uses Playwright's browser instead. Tests own server startup/shutdown and do not reuse an existing server. No pre-existing production tests were changed, adapted or removed. For independent screenshot regeneration, from `prototypes/design`:

```sh
M2_SCREENSHOT_DIR=/absolute/owned/review/screenshots npm test -- --grep 'review screenshots'
```

Include `CHROMIUM_PATH` on NixOS. Relative paths resolve from the test process working directory; absolute paths make ownership explicit. See the prototype README for static preview and audit commands.

### Test dispositions

The approved interaction contracts and D1–D6 corrections are the authority; passing older tests alone was insufficient. No original assertion was weakened to accommodate a defect.

| Tests | Disposition | Contract |
| --- | --- | --- |
| `journeys.spec.ts` · 22 | Preserve, unchanged | Search/back, scope, reader controls, cancellation focus, expiry/logout, lower conflict, admin gates remain live contracts. |
| Layout matrix · 12; large-reader-text/reduced-motion · 1 | Preserve, unchanged | Reflow/page-error checks and 28px sample text remain bounded evidence, not full accessibility qualification. |
| Folio/Index screenshot/resource cases · 2 | Adapt | Same resource-isolation contract; origin follows configured `baseURL`, output directory is configurable, and additional detail/logout captures are generated. No pixel expectations were changed. |
| `review-regressions.spec.ts` · 16 | Add | Rendered-state/viewport/focus/absence assertions close D2–D6 and mobile-primary-action gaps; baseline red evidence exists before fixes. |
| `static-preview.test.mjs` · 2 | Add | Real HTTP responses verify built assets and denial boundaries, independent of dev middleware. |

No tests were replaced, removed, quarantined or skipped. The baseline red/green run demonstrates that the new interaction tests detect the reviewed defects; no suite-wide mutation audit is claimed.

### Acceptance evidence boundaries

| Source workflow / contract | Interaction evidence here | Still requires focused technical proof |
| --- | --- | --- |
| W09–W13 · find/detail/export; R R1–R4 · reader controls | Search/back/scroll, split detail, original-text reader, TOC/appearance/keyboard | Real API paging, EPUB lifecycle, positions/KO identity, isolation, publisher content |
| W28–W29 · local/download separation; R O1–O5 | Local logged-out mode; three removal scopes; auth/logout distinction; quota/eviction copy | File validation, durable commit, verified bytes, restart, quota/eviction recovery, account-scoped storage |
| W26–W30 · replay/conflicts; R S1–S2 | Pending/auth/retry/conflict and explicit earlier-position confirmation/defer | Receipts/idempotency, crash recovery, concurrent revisions/tabs, server/KO participation |
| W05–W08/W22–W24 · insights; W32–W41 · administration | Representative account views and one destructive admin confirmation | Real aggregates/window math, permissions, recovery readiness and operational workflows |

## Independent closure

Independent review closes D1–D6 for this UI-only scope and finds no remaining tested P1/P2 blocker: **53 browser tests**, **2 static-server tests**, **20 independent confinement/header HTTP cases** and the **84-case layout matrix** passed. Fresh audit reports zero vulnerabilities; axe reports zero violations in **32 checked states**, not WCAG conformance. Reader return/focus, removal destinations, logged-out metadata exclusion and admin mock persistence were independently replayed. Neither visual direction is selected; readiness for human review is not human approval.

The initial Read/Resume visibility claim is limited to **320×844 and 390×844**. At **320×568**, Folio's action starts below the fixed tabs and Index's is partly overlapped; scrolling exposes both and each opens the reader. This nonblocking short-height caveat must be included in human review, not generalized into universal mobile visibility. Physical-device, assistive-technology and production behavior/security gates remain open. The independent closure did not rerun pre-fix red tests or source mutations.

## Mock limits and decisions

- **All state is visibly demo state.** No API requests, real authentication, EPUB parsing, IndexedDB/cache, file import, actual download verification, synchronization, service worker, installation or durable queues. Simulate download only changes an in-memory flag. Import adds an original sample rather than opening a fake file picker. The one real export is clearly named synthetic plain text.
- Refresh is a deliberate reset, not offline restart evidence. Hash routing and a small in-memory state context are disposable prototype choices, not selection of a production router/state/storage stack. No dependence on the API or reader proof implementations.
- Removal dialogs demonstrate ownership, not a final physical-file/tombstone policy. Deleting a local/shared sample clears its transient reader session; removing only a download retains it. Admin removal changes one visual outcome in DemoState until reload, not real account/recovery state or the fixed illustrative statistics snapshot. Scenario previews do not mutate actual browser quota or pretend missing bytes exist.
- No collections, bookmarks, annotations, new device operations, or activity-measurement changes. Reader interactions never calculate or credit activity. Insights excludes local-only reading and uses invented figures.
- Chromium automation and visual inspection are supplementary evidence only. No physical phone/PWA, VoiceOver/TalkBack, Firefox/WebKit, complete contrast audit, 200% browser-text qualification, termination/restart or network/storage fault testing is claimed. Large text coverage is the sample reader at 28px, not full system-font accessibility qualification.

## Task-end report

- **Assumptions made:** one synthetic administrator account is sufficient to review retention/reauthentication; all operation outcomes reset on reload; unresolved detailed policies stay visibly proposed.
- **Decisions made autonomously:** retained both Folio/Index directions without selecting the user's creative preference; chose provider-owned transient per-book sessions, context-tagged history scroll, explicit success/selection focus destinations, generic logged-out Sync and a built-directory-only Node preview. Kept Vite on the compatible patched 7.x line rather than changing major tooling.
- **Compromises:** UI-only import/download/sync keep this independent from the focused technical proofs; no real offline durability or EPUB capability can be inferred. Browser emulation is available, physical-device/assistive-technology qualification is not.

Knowledge capture: the prototype README now records safe dist-only preview/audit commands, configurable screenshot ownership, Nix `CHROMIUM_PATH`, and cancellation-versus-success focus behavior alongside the existing CSS cover pitfall. These belong with the prototype, not global project guidance.
