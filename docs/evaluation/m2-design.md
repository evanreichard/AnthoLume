# M2 — Selected Folio mobile refinement

**Folio is selected; the rest of the flow has conditional user approval subject to the requested mobile/reader refinements.** Those refinements passed independent automated review; user confirmation remains pending, so M2 exit stays OPEN. No repeat of all flows or phone/PWA approval is implied. The prototype now has one default Library over visible shared/local records and a full-viewport, actually paginated original-text sample reader. Index stays linkable only as an archived comparison. This is interaction evidence, not an EPUB/storage/API implementation or production tooling approval.

## Review

Existing previews serve the rebuilt `prototypes/design/dist`:

- http://127.0.0.1:5173/?direction=folio&theme=light#/library
- http://100.64.0.14:5175/?direction=folio&theme=light#/library
- Reader: `#/read/tidal`; filtered Library: `#/library?source=local&availability=offline`.

Refresh existing tabs to load the new build. Neither preview was stopped/restarted, and no server/port was launched or bound during this refinement. The selected-direction toolbar is one compact row; the reader removes it entirely. Dark mode remains available, and reading appearance has Paper/Ink/Follow app choices.

**Ideal confirmation:** refresh the existing Folio preview and confirm the requested combined Library/badges/search/filter and full-viewport paginated reader, text resizing and input continuity. **Pragmatic confirmation:** use the existing mobile preview and portrait/landscape captures for those same refinements. The rest of the flow is conditionally approved, not reopened; physical-device/AT, EPUB and durability qualification remain later gates.

## Changed interaction contracts

### One Library; separate ownership

- Default source/availability are **All / All**: four shared records and one local original in the initial synthetic account. There are no permanent Shared/Local segmented controls.
- A semantic source icon **on each cover** distinguishes Shared library from Local original, with accessible names and a small visible legend. Availability is separate text: Available offline or Online only, always demo-labelled. A local original is not an account download.
- Search and the named filter icon share one row. A mobile sheet/native modal offers Source All/Shared/Local and Availability All/Available offline/Online only. Draft count, Reset and Apply are explicit. Escape/cancel discards draft changes and returns focus; Apply pushes the resulting URL state. Search replaces the current query entry rather than creating a history entry per letter.
- `q`, `source`, `availability` survive detail → reader → Back, direct links and reload. Browser Back restores prior applied filters and library scroll. A route/query change discards an open filter draft.
- Logged-out records are privacy-filtered **before search/counting**. Shared cards/account downloads never appear; local originals remain usable. Sync deep links stay generic/paused, and the local reader exposes no account queue count after logout. Expiry remains distinct and permits previously authorized sample reading.
- Offline is still the download/storage-management workspace. Joining a view does not merge identities, upload local originals, transfer progress/activity, or change remove-download/local-delete/shared-delete scopes.

### Pages, not a scrolling sample

- The reader is a fixed `100dvh` frame with exactly one visible text page. Neither the document nor reading text can scroll vertically/horizontally. Native dialogs and the desktop contents panel have bounded independent scrolling.
- A separate aria-hidden measurement surface uses the same CSS/width/height as the visible page. Binary-search fitting creates contiguous word ranges with paragraph boundaries. React owns visible content; only the empty measurement surface is imperatively populated. The obsolete long-reader styles and scroll-fingerprint behavior were removed.
- DemoState owns **per-book chapter + logical word anchor + font/size/paper/chrome**, until reload. Pages are derived, never stored as resume identity. ResizeObserver and layout changes remeasure around the same anchor; the containing page may change, and the anchor may move within that page.
- Previous/Next buttons, left/right arrows, stationary left/right text-edge taps and bounded horizontal swipes advance real pages. Chapter boundaries advance to the adjacent chapter; previous from a chapter's first page returns to the prior chapter's last page. Vertical movement and text selection do not trigger swipe turns.
- Page turns focus the visible page. Chapter transitions/TOC selection focus the new heading, without dialog-cleanup stealing focus. Escape/close returns focus to the opener. Contents, Appearance, quiet-control toggle and Sync remain reachable, including landscape; no timed hiding or gesture-only controls.
- Reader → Sync → in-app/browser Back restores the same transient chapter/anchor/appearance/chrome, with **zero document scroll**. The former “restore reader Y against a matching context” contract is intentionally retired. Ordinary library history/scroll remains intact.

All four chapters clearly reuse the same original synthetic passage. No EPUB engine, actual saved checkpoint, activity calculation or real sync/offline guarantee is claimed.

## Narrow independent mobile-review closure

Both remaining findings in `_scratch/m2/review-mobile/review.md` are corrected without a redesign:

- **M1:** one named custom Clear search action; Chromium/WebKit's native cancel decoration is suppressed. The nonshrinking custom target is **44×44 CSS px**; the populated 320/390 search/filter row remains unwrapped. Enter/Space clearing returns focus to the input. The redundant empty-result clear action is removed, so unmatched queries do not expose another clear button.
- **M2:** stationary primary-pointer taps in the left/right outer **20% of the visible text page** call the existing Previous/Next operation. Center taps are unchanged. A small isolated gesture hook tracks total movement and selection, rejects links/interactive descendants/panels/cancelled gestures, and commits only on pointer-up. It has no click page-turn handler, so a swipe or subsequent compatibility/synthesized click cannot double-advance; the next genuine tap still works.

Seven focused cases cover mouse and real emulated touch taps, actual CDP touch swipes, synthesized-click suppression, initial/during-gesture selection, control/link actions, drag-return/cancellation, target geometry, actual UA cancel visibility and keyboard focus. Before fixes, six of these cases failed and the existing suppression case passed; all seven now pass on both existing previews. No EPUB functionality was added. The canonical pagination matrix also now includes the review's **320×568** size.

## Independent closure

Independent review closes both original findings: the single Clear search target measures 44×44 at 320/390 with the native duplicate hidden, and real emulated edge taps/swipes advance exactly once while selection/control/cancellation guards hold. **77/77 browser cases and 2/2 static HTTP cases passed against the existing tailnet preview**, without starting/stopping listeners. An independent short-portrait→28px sans→landscape→Sync/Back probe retained logical anchor 45 with zero document/text scroll and no page errors. Served assets matched the built prototype. This accepts the bounded synthetic UI handoff, not user confirmation, actual EPUB, physical-device/PWA or production behavior. The owner's seven focused tailnet cases are included in the same 77, not additional unique tests.

## Actual verification

Pinned versions: React/React DOM **19.1.1**, TypeScript **5.9.2**, Vite **7.3.8**, React plugin **5.0.3**, Playwright **1.55.1**. Verified with Node **22.23.4**, Nix-wrapped Chromium **156.0.8078.79**. Only prototype dependencies/files, this report and owned scratch artifacts changed.

- Dependency pins are unchanged. Fresh `npm run audit` — **0 reported vulnerabilities**, including development dependencies. Current JSON: `_scratch/m2/design/audit-narrow.json`.
- Typecheck and production build — passed. Build refreshes the dist directory used by both already-running previews; no root/backend/reader-proof integration is involved.
- **77 Playwright cases passed** on the existing loopback static preview: the prior 69 cases, seven focused mobile-review cases and one added 320×568 pagination case. No cases were skipped/removed. Final log: `_scratch/m2/design/test-narrow-full.log`.
- **2 static HTTP tests passed**, using `M2_PREVIEW_URL` against the existing preview, without creating/listening/closing a server. Built HTML/assets/HEAD and denied source/dev/dotfile/traversal/missing paths, malformed URI and unsupported method are checked. This execution does not newly qualify a server bind configuration.
- **All seven focused mobile-review cases also passed on the tailnet preview**. These are repeated executions, not additional unique cases. Log: `_scratch/m2/design/test-narrow-tailnet.log`.
- Existing layout matrix remains **84 route/width/scheme checks**: two studies × light/dark × 320/390/1280 × seven routes. Resource capture cases still reject external origins.
- New reader cases at **320×568, 320×844, 390×844, 844×390, 568×320, 1280×900** verify no page/document overflow at default and 28px; page advancement contains every original sample word exactly once, in order, with no gaps/duplicates; forward/backward chapter boundaries work. Font, size, orientation and quiet-mode reflow keep the same word anchor. Wheel/PageDown do not scroll the document/text.
- New library cases cover both sources/semantic cover badges, distinct availability, one-row search/filter, 320/390 sheets, keyboard boundary/Escape focus, draft/apply/reset/counts, all/offline/online states, URL/reload/detail/reader/Back, local-only privacy, and landscape Apply reachability.

A first refinement run exposed unnamed icon-only Previous/Next controls in landscape. Explicit accessible names corrected the actual UI defect; the all-words/no-overflow tests then passed, rather than relaxing their assertions.

## Test dispositions

Authority: this user's intentional unified-library/no-scroll reader contracts, plus the unchanged approved privacy/ownership/activity rules.

| Area | Disposition | Reason / current assertion |
| --- | --- | --- |
| Search/detail/browser Back, removal scopes/success focus, expiry/logout/Sync privacy, conflict/defer, admin lifetime | Preserve | These behaviors remain live. A detail availability locator is scoped to detail because the unified shelf now uses the same availability wording; its assertion is unchanged. |
| Original reader controls/focus and D2/D3 cases | Adapt | Next/Previous mean pages, not immediate chapter jumps. They assert page focus/word movement, chapter-heading focus at actual boundaries/TOC, per-book settings and anchor continuity instead of reader Y. |
| Direction picker/browser history case | Adapt | Folio is selected; no active direction picker remains. Archive return, selected Folio URL/theme and library scroll/Back remain asserted. |
| Existing overflow, modal focus, 28px sample and resource/capture cases | Preserve / setup adapt | Same bounded contracts; reader selectors match its new component boundary. Screenshot destination and configured-origin checks remain configurable. |
| `mobile-refinement.spec.ts` · prior 16 | Preserve; one fixture setup adapt | Existing assertions remain. The dispatched swipe fixture now explicitly marks a primary pointer, matching real browser events; no guard bypass exists in app code. |
| Canonical 320×568 pagination case · 1 | Add | Extends the same complete-text/no-scroll/28px contract to the short portrait viewport recommended by review. |
| `mobile-review-fixes.spec.ts` · 7 | Add | Both missing input contracts and selection/control/gesture-duplication suppression; reusable populated-target and actual UA-shadow checks. |
| Static preview tests/config | Adapt setup only | External-preview environment modes reuse running servers instead of binding ports; HTTP safety assertions remain. |

No compatibility layer keeps retired segmented-scope, long-scroll, page-number-as-anchor, or chapter-per-click assumptions alive. No production tests or unrelated proof implementations were edited.

## Reproduce without launching servers

From the repository root:

```sh
npm --prefix prototypes/design ci
npm --prefix prototypes/design run audit
npm --prefix prototypes/design run typecheck
M2_PREVIEW_URL=http://127.0.0.1:5173 npm --prefix prototypes/design run test:preview
M2_BASE_URL=http://127.0.0.1:5173 npm --prefix prototypes/design test
```

Set `CHROMIUM_PATH` to a system-wrapped Chromium on NixOS. `M2_BASE_URL` disables the managed Vite server; `M2_PREVIEW_URL` bypasses temporary static-test servers. Without them the original isolated test defaults still exist for future runs, but were not used here. Do not run preview/dev commands over the existing listeners.

**67 refreshed screenshots** are in `_scratch/m2/design/narrow-review-screenshots/`: 52 matrix/context images, 13 focused Folio images, and `folio-clear-320.png` / `folio-clear-390.png` showing the single clear control. The two populated-search views were also regenerated against tailnet under `narrow-tailnet-screenshots`. `folio-refined-{320,390}-{library,filters,local-offline,reader28,landscape28,landscape-panel}.png` and `folio-refined-desktop-reader.png` show the new contracts. Portrait/filter/large-type/landscape/desktop images were opened for visual inspection. Full-document fixed-tab artifacts apply only to scrollable workspaces; reader captures are one viewport.

Independent review can direct all screenshot/result writes into its own paths, from `prototypes/design`:

```sh
M2_BASE_URL=http://127.0.0.1:5173 \
M2_SCREENSHOT_DIR=/absolute/owned/screenshots \
npm test -- --output /absolute/owned/results --grep 'review screenshots|focused mobile|M1'
```

## Mock limits and decisions

- **Assumptions:** a word offset in a known original passage is an appropriate logical anchor for this disposable plain-text prototype. Privacy separation is application-level, not encryption. Mock state resets on reload; URL filters/theme persist.
- **Autonomous decisions:** selected-direction toolbar is compact and absent in the reader; native radio/Apply sheet, private-before-count filtering, isolated DOM measurement and derived word-range pages keep state ownership explicit. Both existing preview processes were left untouched.
- **Compromises:** pagination handles this plain original sample, not arbitrary EPUB XHTML/images, publisher fonts, CFI/KO positions or isolation. Four chapters repeat the passage. No real import/download/storage/auth/sync/service worker/activity or offline-restart behavior is implemented. No physical phone/AT, WebKit/Firefox, app-wide 200% text/zoom, full contrast/target or performance qualification is claimed.

Knowledge capture belongs in the prototype README/tests: external-preview no-bind validation, populated-control target checks, the explicit reader input-parity table and the invariant that logical word anchors survive reflow while page numbers do not. Global/root guidance and separate engine/API proofs stay untouched.
