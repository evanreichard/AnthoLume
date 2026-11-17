# AnthoLume M2 · Folio

Folio is selected. This standalone React/TypeScript prototype uses synthetic books and real bounded sample pagination, **not an EPUB engine**. Index remains URL-linkable as an archived comparison, not an active direction picker.

## Review the existing previews

- Local: http://127.0.0.1:5173/?direction=folio&theme=light#/library
- Tailnet: http://100.64.0.14:5175/?direction=folio&theme=light#/library
- Reader: change the hash to `#/read/tidal`.
- Filter deep link: `#/library?source=local&availability=offline`.

The existing static processes read `prototypes/design/dist`. Rebuild and refresh the browser; **do not restart either preview or bind another port** for this review.

The unified Library defaults to all visible shared and local records. Its featured **Resume** card comes first; search, Filter and Add share the compact row below it. A subtle divider replaces the shelf heading and visible source key. Cover provenance badges retain accessible names/tooltips; availability remains separate text. Filter drafts apply explicitly, with counts/reset; `q`, `source` and `availability` live in the hash query and survive detail/reader/Back. Offline remains download/local-original management. Nothing is uploaded or reclassified.

Reading fills the viewport without document/text scrolling. Previous/Next, arrows, stationary left/right edge taps and bounded horizontal swipes turn measured pages. TOC/Appearance are overlays; only panels and the desktop contents column may scroll. Font/size/orientation changes show the page containing the same **word anchor**, not the old page number. Per-book position/appearance/chrome and mock outcomes survive internal routes until reload. No activity, authentication, EPUB parsing, real availability, import, storage or synchronization is implemented.

This density pass updates existing spacing/type/card tokens and reader chrome only. It does not extend the sample reader or wire an EPUB engine. Integrating the current reader and its theming is the next separate task; the existing adjustable text size, anchor and controls are preserved here.

## Preserved mobile input parity

| Input                                                   | Preserved behavior                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Left/right outer 20% of the text page                   | Stationary primary-pointer tap turns Previous/Next; center taps leave controls unchanged.                                              |
| Horizontal swipe                                        | One turn above 60px travel with less than 35px vertical deviation; never a second tap turn.                                            |
| Selection, links/controls, cancelled or returning drags | No implicit page turn; native control actions remain available.                                                                        |
| Compatibility/synthesized click                         | No second turn: only pointer-up commits text-page gestures. Explicit buttons retain native clicks/keyboard activation.                 |
| Populated search                                        | One custom Clear search button, at least 44×44px; UA cancel decoration is hidden. Enter/Space clearing returns focus to the searchbox. |

The redundant empty-result clear action was removed as well; filters stay in the same compact query row. Tests inspect Chromium's actual UA-shadow cancel node rather than relying on the host/pseudo computed-style proxy.

## Checks without launching servers

From the repository root with Node 22.12+:

```sh
npm --prefix prototypes/design ci
npm --prefix prototypes/design run audit
npm --prefix prototypes/design run typecheck
M2_PREVIEW_URL=http://127.0.0.1:5173 npm --prefix prototypes/design run test:preview
M2_BASE_URL=http://127.0.0.1:5173 npm --prefix prototypes/design test
```

`test:preview` builds dist and runs HTTP checks against `M2_PREVIEW_URL`; this mode does not create/listen/close a server. `M2_BASE_URL` likewise disables Playwright's managed web server. Set `CHROMIUM_PATH` to a system-wrapped Chromium on NixOS; elsewhere use an installed Playwright browser.

Without these environment variables the original isolated test defaults remain available for future use: managed Vite on 5313 and temporary static-test servers. They were **not used** for this refinement. The optional `npm run preview` script serves only dist on loopback 5173; do not run it while the existing preview owns that port. Development remains loopback-only, with patched Vite 7.3.8. Never serve the repository root or broaden/tunnel the dev bind.

## Independent screenshots

From `prototypes/design`, reuse the running preview and put all artifacts in your own paths:

```sh
M2_BASE_URL=http://127.0.0.1:5173 \
M2_SCREENSHOT_DIR=/absolute/owned/screenshots \
npm test -- --output /absolute/owned/results --grep 'review screenshots|focused mobile|M1'
```

Include `CHROMIUM_PATH` when needed. The five capture-bearing cases generate **67 PNGs**: 52 matrix/context captures, 13 focused Folio library/filter/large-type/landscape/desktop reader captures, and two populated-search views (`folio-clear-320.png`, `folio-clear-390.png`). Names containing `refined` identify the new views. `-full.png` documents contain fixed-tab screenshot artifacts; the reader itself is exactly one viewport, so it has no long-document capture. These are review images, not pixel baselines.

The density comparison has 24 real before captures and 24 after captures under `_scratch/m2/design/density-before/` and `density-after/`, with matching `geometry.json` files. The refreshed 67-image regression set is under `density-screenshots/`. See [M2 findings](../../docs/evaluation/m2-design.md) for measured changes, test dispositions, actual results and limitations. All dependencies are pinned in this prototype's lockfile; audits are point-in-time checks.
