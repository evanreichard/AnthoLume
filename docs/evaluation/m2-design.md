# M2 — Selected Folio density pass

**Folio stays selected; density verification is independently accepted (89 browser + 2 static checks).** User confirmation and M2 exit remain OPEN; the rest of the flow has conditional approval and need not be repeated. This pass compacts browsing, detail, Offline, More, Sync and reader chrome without changing ownership, filter/history/privacy behavior, input parity or the reading model. The reader is still a synthetic prototype, not production or phone/PWA approval.

## Review

- http://127.0.0.1:5173/?direction=folio&theme=light#/library
- http://100.64.0.14:5175/?direction=folio&theme=light#/library
- Detail: `#/books/tidal`; sample reader: `#/read/tidal`.

Refresh the existing tabs. Dist was rebuilt; **neither preview was stopped/restarted, and no server or port was launched/bound**. No root dependencies, API, current-reader/other-proof code, private archive or git state was edited.

**Ideal next step:** wire the current reader and its theming against the reviewed boundaries, then qualify real reading and physical-device/PWA behavior. **Pragmatic next step:** review the density-only build and its preserved interactions now, then perform that same integration separately. This pass deliberately does not extend fake pagination or add reader features.

## Changed interaction contracts

- Featured card **first**, when applicable; the search row is **below** it. Filtered/searched/local-only views that have no feature reserve no blank card space.
- Primary labels are **Resume**, on the feature and book detail. Add sits immediately beside Filter in the same row as search; its existing local-import demo/focus behavior remains.
- Removed **On the shelves**, the visible Shared/Local key and the standalone Add row. A single subtle results divider remains. An offscreen heading/count preserves result semantics without taking visual space.
- Cover provenance icons retain their accessible names and native tooltips. Source is still distinct from availability; the default mixed Library, explicit source/availability filters and Offline management retain book identity. No upload, ownership merge, activity-credit change or account data exposure is introduced.
- Existing CSS tokens/component/responsive rules now use tighter page/card/menu gaps, restrained editorial heading sizes and smaller cover treatments. The Library stylesheet was consolidated instead of adding another density-override layer. Warm paper, serif/italic hierarchy, clay primary actions and original covers remain Folio.
- Compact icons/visual controls keep existing **≥44px touch targets** for search clear, Filter/Add, Resume, reader controls and management actions. Search text remains 16px on mobile; descriptive prose and supporting labels remain readable rather than being scaled down indiscriminately.
- Reader changes are **CSS chrome/padding only**: no edits to pagination, gestures, word anchors, reader state, content, theme controller or EPUB integration. Adjustable reading text still uses `--reader-size`; selected 26px survives appearance changes in regression checks. Fixed viewport, no text/document scroll, TOC/Appearance, edge taps/swipes, Sync/Back and focus remain protected.

## Actual before/after evidence

24 **before** captures were taken from the running old build before edits; 24 **after** captures were taken from the rebuilt build. Each set covers Library/detail/Offline/More/Sync/reader at 320×844, 390×844, 844×390 and 1280×900, with the same synthetic account and default reader size. Both sets include actual DOM geometry JSON; these are not reconstructed mockups.

Paths: `_scratch/m2/design/density-before/` and `density-after/`. Files are named `390-library.png`, `320-detail.png`, `844-reader.png`, etc. Representative captures across all six routes were opened for visual inspection.

Rounded CSS-pixel measurements (lower Y/height means denser, except reader area):

| Measurement | 320px before → after | 390px before → after |
| --- | --- | --- |
| First library item Y | 463 → **336** | 468 → **336** |
| Detail Resume Y | 509 → **398** | 538 → **401** |
| First Offline item Y | 822 → **661** | 769 → **607** |
| More menu height | 336 → **256** | 336 → **256** |
| Pending Sync panel height | 555 → **416** | 516 → **416** |
| Reader page-area height, same 20px text | 578 → **608** | 590 → **621** |

At 1280px the first shelf item moves from Y=713 to **446**, all five covers fit one row, and reader page area grows from 655 to **707px**. Landscape reader chrome was already near its touch-target floor: page area grows from 243 to **245px**, with reduced inner padding as well. No target was shrunk to manufacture that space.

The regression capture set contains **67 refreshed PNGs** under `_scratch/m2/design/density-screenshots/` (separate from the 48 comparison images). Fixed bottom tabs in full-document workspace images remain capture artifacts; the reader is one viewport.

## Actual checks

Unchanged pins: React/React DOM **19.1.1**, TypeScript **5.9.2**, Vite **7.3.8**, React plugin **5.0.3**, Playwright **1.55.1**. Tested with Node **22.23.4** and Nix Chromium **156.0.8078.79**.

- **89 Playwright cases passed** on the existing loopback static preview: the prior 77, plus **12 density geometry cases**. No cases were skipped or deleted. Log: `_scratch/m2/design/test-density-final.log`.
- All **12 density cases also passed on tailnet**; these are repeated executions, not additional unique cases. Log: `test-density-tailnet.log` in the same scratch directory.
- Typecheck, production build and **2 static HTTP tests passed**. HTTP tests reused the existing server with `M2_PREVIEW_URL`; no bind/close operation was used.
- Fresh dependency audit: **0 reported vulnerabilities**, including dev dependencies (`audit-density.json`). Audit is point-in-time evidence, not a security guarantee.
- Geometry checks at 320/390/landscape/1280 assert feature/search order, aligned Add/Filter and ≥44px controls, one divider/no obsolete heading/key, earlier complete first item, easy-to-reach detail Resume, compact Offline/More/Sync, and larger reader area without a text-size reset.
- Existing tests still protect unified sources, source/availability combinations, URL/reload/browser Back, privacy before counting, three removal scopes, cancellation/success focus, auth-expiry distinction, explicit lower-position conflict choice, admin mock lifetime, complete sample text/reflow, no-scroll pagination and edge-tap/swipe/selection/control guards. The existing 84 route/width/scheme overflow checks and external-resource checks remain.

The first density run caught a real 320px Appearance target regression (about 42px wide); an explicit minimum width corrected it. It also exposed a test assumption, not an app failure: larger page area can reduce the sample to two pages. The gesture test now validates one logical page step across a possible chapter boundary rather than assuming a third page exists.

## Independent closure

Independent review accepts this bounded density/UI handoff with **89/89 browser cases and 2/2 static HTTP cases passed against the existing tailnet preview**, plus 29 independent geometry/state/reflow probes. Served asset hashes matched the current build. Feature/search order, Resume labels, compact Add/Filter row, removal of shelf/key, accessible cover provenance and ≥44px critical controls were verified. Fresh six-workspace captures reproduce the documented space gains without a reading-text reset; targeted short-portrait/landscape Sync/Back retained anchor 45 at 26px with zero scroll or delivered-line clipping. No page errors, external requests, blocking defects or required app fixes were found.

The 12 owner tailnet density cases are included in the same 89-case suite, not additional unique tests. Typecheck and fresh full audit passed; no source mutation audit was performed. This establishes readiness for user refresh/confirmation, not human acceptance, EPUB/device/PWA or production qualification. Earlier technical proofs are unchanged. No further mock-reader features are required; existing real reader React/controller adaptation and Folio theming remain separate M3 work.

## Test dispositions

Authority is the requested density/composition change; live behavior contracts remain the requirement, not old visual dimensions.

| Area | Disposition | Reason |
| --- | --- | --- |
| Existing search/filter/back/privacy/removal/dialog/focus/state cases | Preserve | Same behavior; no expectations were removed or softened. Provenance badge/tooltips remain tested despite removing the visible key. |
| Feature/detail Resume selectors | Adapt | Requested label is now `Resume`; navigation and accessibility assertions remain. |
| Shelf/key/order geometry | Add | New explicit checks cover the requested replacement of the old visual order/heading/key. No prior test requiring a visible key or heading was deleted; source/filter semantics remain. |
| One gesture continuation expectation | Adapt | Same single-turn/no-double-advance invariant; validates chapter + word anchor when the next page crosses a chapter boundary. Reader implementation was not changed. |
| `density.spec.ts` · 12 | Add | Measurable density, preserved touch targets and selected text size across the requested viewports/workspaces. |
| Existing sample text, pagination and input-parity tests | Preserve | No additional reader features or fake engine scope; the same contracts rerun against the changed layout. |

No production tests or unrelated proof implementations changed. The independent mobile review's earlier 116-page line-rectangle check is separate evidence, not a count claimed to have been rerun in this pass.

## Reproduce without launching servers

```sh
npm --prefix prototypes/design run typecheck
npm --prefix prototypes/design run audit
M2_PREVIEW_URL=http://127.0.0.1:5173 npm --prefix prototypes/design run test:preview
M2_BASE_URL=http://127.0.0.1:5173 npm --prefix prototypes/design test
```

Set `CHROMIUM_PATH` to the available system Chromium on NixOS. `M2_BASE_URL` disables the managed test server, and `M2_PREVIEW_URL` bypasses temporary HTTP-test servers. Do not run preview/dev commands over the existing listeners. The build updates the dist already served by both previews.

The screenshot/result ownership overrides remain available. From `prototypes/design`:

```sh
M2_BASE_URL=http://127.0.0.1:5173 \
M2_SCREENSHOT_DIR=/absolute/owned/screenshots \
npm test -- --output /absolute/owned/results --grep 'review screenshots|focused mobile|M1'
```

## Mock limits and decisions

- **Assumptions:** the current request supersedes previous visual ordering/labels/key, not source ownership or behavior. State remains transient until reload; the density comparison intentionally uses the same default 20px sample text.
- **Autonomous decisions:** consolidated existing tokens/rules rather than layering another skin; kept mobile input text at 16px, paragraph legibility and 44px actions while reducing surrounding space. Reader work is limited to CSS; current-reader/theming integration is left to the next authorized task.
- **Compromises:** this remains original synthetic text/data and mock operations, not an EPUB engine, API/auth/storage/sync implementation or actual activity measurement. New density is not physical phone/PWA, AT, arbitrary EPUB, app-wide zoom/contrast or performance qualification.

Knowledge capture: keep paired viewport/geometry evidence and touch-target density guards beside this prototype's tests/README. Page numbers are layout results, so reader input tests must tolerate chapter boundaries while still proving exactly one logical turn. No global/root guidance changes are needed.
