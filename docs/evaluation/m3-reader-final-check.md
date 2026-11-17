# M3 reader final check — browser red, production SW green

One completed qualification batch on 2026-11-17: Linux 6.18.60 x86-64, Node 22.23.4, Playwright 1.65.1, headless Chromium 157.0.8103.38. **Reader qualification is not accepted:** one browser case failed. This does not undo the separate six-case SW pass.

| Check | Discovered | Passed | Failed | Skipped | Exit |
|---|---:|---:|---:|---:|---:|
| Reader browser | 71 | 70 | 1 | 0 | 1 |
| Production SW | 6 | 6 | 0 | 0 | 0 |

No retries or flaky outcomes. Typecheck and fresh Vite production build each ran once and exited 0. The 71 browser cases include the 14 partial-MD5 size vectors, the unsampled-byte/full-SHA separation case, and the existing Alice identity case; all 16 passed. The former stale-frame React StrictMode UI case and the production-shell/font cold-reopen case passed, as did the fractional-viewport reflow regression and the public 316,326,469-byte cold offline case.

## First failures

- **Interrupted setup, excluded from suite totals:** all 28 recorded 1–2 ms failures were `browserType.launch` failures. Chromium aborted at `process_singleton_posix.cc:315` with `Socket path too long` for `SingletonSocket`; no reader assertions ran. The orphaned 5346 listener was identified by its copied-project working directory and stopped. A short `/proc/<runner-pid>/cwd/tmp` alias to the same owned scratch directory fixed the launch environment. Both normal and persistent launches passed preflight.
- **Completed browser batch:** `web/src/reading/tests/browser/engine.spec.ts:13`, outcome assertion at line 41. For the public `large-media` fixture, `open()` left the controller in `error` rather than `ready`. The following `next()` reported `Error: Reader not ready; fallback requires explicit reopen`; the observed publication count was zero (expected one), and the reopened reader did not produce a ready anchor. The assertion reports the subsequent `next()` message, not the original open error. The underlying open cause is unconfirmed from this run. The test remains red; no repair or rerun was attempted.
- **Completed SW batch:** no failures. Both cold-process scenarios, old-root retirement, update and failed-precache fencing, denied-cleanup recovery, and nonce/schema/lease fencing passed.

## Inputs and provenance

The current production reader Playwright/Vite and SW preview configurations were copied under `_scratch/m3/reader-final-check/source/`. Test sources were byte-identical to the live files; only scratch configuration and paths were adjusted. Both copied configurations retained their standard strict loopback ports (5346/5348), one worker, timeouts and failure reporting. Vite's optimizer cache was isolated; the build used the normal production configuration and emitted only to the copied project's `assets/app`. The existing generated public large-fixture pair was reused. Before/after listener snapshots are identical for previews 5173/5175; no owned listener remains. Go/container/frontend-34 were not rerun, and no private books or extra memory/corpus campaigns were accessed or run.

**Current SHA-256** (233-file `web/` manifest excluding `node_modules`, sorted `<hash>  <repo-relative path>\n` records; before and after identical):

| Input or output | SHA-256 |
|---|---|
| `web/` source manifest | `38cdc8b57a4877e329132dcd71d8a5ff37b3b2b9b8fccf0e5c79313eb6965e61` |
| `web/src/reading/controller.ts` | `ebd5f1a0eb88214b222d97ee03a82267caeff310d313a0a637ae2320562a2fb9` |
| `web/src/reading/epub-lifecycle.ts` | `5eccc11a20dfcef131b4bceacb13ce2672424f962b9bdc98587319e0af6472bb` |
| `web/src/reading/ReaderScreen.tsx` | `f41fa1fc23752f32e0a8d5bd31792c393e14bb0ab771694e6ff400fcffcfe9ac` |
| `web/src/reading/source.worker.ts` | `744b8fe1e9224c4bde295b309ac3a05e9cacd07be1fe9f0a969b41cb79a8ab1c` |
| `web/src/reading/sw.ts` | `212aba8736cf332f7a946029ec7520ae095b89585802e46ae1ad5fe9dcf2a188` |
| Built `assets/app/index.html` | `79d4a6f78446765e619c6f213b1dfc4406ef4e9c6d7d65f54bccb749fbba7699` |
| Built `assets/app/sw.js` | `e9762fc057e3d866f433930544475054999b058b513d8409195623d5c8463e29` |

Evidence under `_scratch/m3/reader-final-check/`: `execution.json`, `typecheck.log`, `build.log`, `browser.{log,json}`, `sw.{log,json}`, `browser-results/`, `interrupted-browser.log`, `interrupted-browser-results/`, `listeners-{before,after}.txt`, and `source-hashes-{before,after}.json` (full per-file hashes).

## Remaining qualification

Desktop headless Chromium does not qualify physical iOS/iPadOS Safari or Android browser/PWA behavior. On target devices verify native XHTML rendering with decoded images/fonts, clipped-anchor reflow and rotation, touch/accessibility controls, installed-shell cold offline restart and update/recovery with actual network loss, and durable storage under OS suspension, quota pressure and eviction. Verify native `deflate-raw` on target Safari/Firefox versions and measure native decoder and renderer memory plateaus during repeated image-bearing navigation without forced GC; existing desktop observations are not device ceilings. Broader corpus and actual KOReader/CRengine position parity remain separate gates.
