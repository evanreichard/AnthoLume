# M3 public streaming — final independent acceptance

**Bounded M3 acceptance: close S1 and S2 against current production source; the public source-worker backing-store correction is independently confirmed without forced GC. No remaining blocker was found in this review's assigned scope.** This is not unrestricted reader/app, private-corpus, process-memory or phone/native qualification.

## Scope and execution

Read the current `m3-reader.md`, controller/chapter ownership code, source worker and transfer-retirement pipeline, canonical codec, and earlier streaming findings/pinned-parser decision. Used current production modules, real EPUB.js pagination, native XHTML frames and native decoded images in Chromium 157. No application/git/dependency/private-book changes. Reviewer artifacts are confined to `_scratch/m3/streaming-final-review/**` and this report. An owned strict-port Vite server used 5357 and was stopped; no existing listener was reused or interrupted.

- **8 focused browser tests passed (1.3 minutes)**, including the existing public 316 MB test **once**, canonical/legacy regressions, existing correction/storage cases and two independent probes below. Neither full reader nor app suite was rerun.
- **Production TypeScript check passed.**
- Additional focused Blob hash/index/entry observations establish actual transfer detachment and physical worker cleanup. Its first harness assertion incorrectly applied the normal-open `<16 MiB` aggregate IO budget to initial ZIP indexing. Raw observations were saved before assertion failure; independent record verification passes the correct per-read/ownership contracts. That scratch assertion is corrected; production was not rerun to conceal the harness error. See `cleanup.log`, `worker-cleanup.json`, `verify-record.mjs` and `worker-cleanup-verdict.json`.

## S1 — closed: settled failures release prepared engine DOMs and leases

Production `controller.ts:59–65` finalizes every queued action with `releaseInactive()`, including rejection; `:321–328` separately unloads nonlive spine sections and resource owners. This is not just the canonical two-document LRU.

Independent probe: twelve **distinct validated ordinary XHTML chapters**, each with its own stylesheet and real static image dependency. After each chapter's actual `prepareChapter()` completes and acquires its leases, a test-only wrapper removes the requested ID. Navigation then fails with **`Internal fragment unavailable`**, not the now-corrected canonical-path counterexample. Preparation records prove each target acquired its own owners before failing.

Every settled failure retained:

| Observed object/state | Result across all 12 failures |
|---|---|
| Actual loaded spine section documents | **1**, verified directly as well as diagnostically |
| Live frame/content documents | **1 / 1** |
| Canonical source DOM cache | **2 maximum** |
| Inactive target resource owners | **0** |
| Leased URLs / encoded asset bytes after settlement | **1 / 62 bytes**, constant |
| Displayed iframe/body, full location snapshot, durable checkpoint | **Unchanged** |
| Publications | **0** |

Later valid `two.xhtml` navigation reached ready, published once and advanced the durable checkpoint. Disposal left zero loaded sections/content documents/iframes and zero active/queued source workers. Evidence: `s1.json`, `browser/final.spec.ts`.

## S2 — closed: intrinsic placeholders preserve native authored geometry

Production `chapter-policy.ts:101–111,124–127` uses an owned inert intrinsic-size SVG image, without inventing missing width/height attributes; offscreen release restores that same placeholder (`:155`). Actual visible-image readiness remains tied to owned decoded book assets, not placeholder natural dimensions.

Independent comparison used untouched source image markup imported into the **same live native XHTML document**, same renderer styles and viewport, with the same real 16×8 PNG. The comparison element was removed before continuing pagination. Actual asset reads were briefly held to measure the pre-load placeholder; no native image or pagination engine was mocked.

| Source sizing | Native reference | Placeholder / loaded / released / reloaded |
|---|---:|---:|
| Width only, `width="200"` | 200×100 | 200×100 in all phases |
| Height only, `height="80"` | 160×80 | 160×80 in all phases |
| Percent CSS, `width:100%` | 358×179 | 358×179 in all phases |
| Both, 200×100 | 200×100 | 200×100 in all phases |
| No dimensions | 16×8 | 16×8 in all phases |

Authored width/height/style attributes stayed unchanged. Loaded and reloaded images produced the actual PNG's expected RGBA pixel, not placeholder pixels. Two real forward/backward turns released/reacquired the actual image lease: asset bytes **177→63→177**, URLs **2→1→2**. Each case returned to the identical KO/CFI/page and **39-page** native pagination; ready was withheld while the actual image request was held. All five readers/engines disposed, listener counts and source workers returned to zero. The reused existing correction test additionally passed percentage HTML width and fixed one-axis CSS variants. Evidence: `s2.json`, `probes.log`.

## Public worker backing-store correction — confirmed, not merely asserted

Inspected implementation: reusable 256 KiB Blob BYOB backing; direct cached-chunk incremental noble SHA updates; retirement of consumed IDB buffers and index temporaries; one prebounded entry output; native raw-DEFLATE consumption with retirement of emitted buffers. `source.ts:34,41–49` transfers retirement buffers, rotates at at most 8 MiB, acknowledges source ownership handoff, and physically terminates both workers on completion/error/abort. The retirement worker does not copy buffers.

The existing **316,326,469-byte / 75-chapter** public HTTP→IDB→validation→publication→native-reading test passed. Expected full SHA-256 `847f5cf29bfd5ff1502f9b6a866793c2bf9fbd68a1d057652f1be8fdda5779ec` and KO hash `dd033a20f82aa0a55b8a837c75fafddb` matched. Dedicated CDP targets were sampled while running and at terminal publication; **no collection/forced GC** was requested.

| Worker kind | Peak backing storage, bytes | Samples |
|---|---:|---:|
| Source hash | **773,689** | 78 |
| Source index | **766,528** | 10 |
| Source entry | **4,992,056** | 384 |
| Transfer retirement | **8,131,009** | 186 |

Actual assertions passed: source reads ≤**262,144 bytes**, incoming chunks ≤**65,536**, normal committed-manifest opening IO **<16 MiB**, canonical DOM peak ≤2, loaded sections ≤2, resource bytes within the unchanged ceiling, six distant real 1024×1024 image decodes, touched-chunk corruption rejected, no forbidden main-world whole-original reads, zero local outbox events, zero active/queued source workers and active staging writers after cleanup. Staging logical window peak was exactly **8 MiB**. Main-isolate sampled backing peak was **57,060,856 bytes**; sampled staging-worker backing peak was **24,655,910 bytes**, not an 8 MiB isolate-memory claim. No process-RSS/PSS campaign was run or inferred.

Additional native File/Blob sample rechecked the same full hashes and largest 4,196,031-byte entry. Direct observations found **3 source workers and 2 retirement workers physically terminated**, **936 transferred buffers detached** (90,979 bytes), no detachment failures, and **zero live Playwright worker targets after each hash/index/entry operation**. Source read maximum remained 256 KiB. Initial ZIP indexing read **68,214,146 aggregate bytes** through bounded ranges; this is initial validation work, not committed-manifest reopening and not retained backing. The large IDB run above supplies the much larger retirement-window samples. Evidence: `probes.log`, `worker-cleanup.json`, `record-verification.log`.

## Canonical positions and separate limitations

Current new writes count direct same-namespace siblings, retain authored ancestors/anchors and require exact primary-source/CFI round trips. The focused canonical/native-CFI tests pass, including nested/repeated paragraphs and anchored images. Incoming historical suffix-bearing strings remain byte-exact through open/reflow; child-first/legacy-fallback reads remain. This matches the previously pinned CRengine child-axis/sibling evidence, not a server-string rewrite or wire-protocol change.

**Separate, not blockers for this bounded closure:** no actual CRengine/KOReader execution, physical iOS/Android qualification, target Safari/Firefox raw-DEFLATE support, native decoder/process-memory plateau or private-corpus workflow acceptance was performed. Existing native/phone and other-owner gates remain with their owners. The accepted single-origin architecture was not reopened. Nonfatal EPUB.js CFI offset diagnostics remain visible in `probes.log`; the tested exact round trips, visibility/readiness and publications passed.

**Ideal and pragmatic coincide here:** accept this bounded public M3 correctness/working-set closure now; retain the explicitly separate native/phone and broader qualification boundaries rather than expanding this review.

- **Assumptions:** supplied public fixture and accepted single-origin boundary; existing native/private qualification ownership is unchanged.
- **Autonomous decisions:** injected missing IDs only after real preparation; inspected direct engine sections/lease owners and durable checkpoints; added physical worker/transfer observations without a second full memory run.
- **Compromises:** desktop Chromium/source harness, not a fresh production-shell or physical-device qualification; erroneous initial-index harness budget corrected and verified from saved observations rather than rerunning production.

Knowledge capture: `web/src/reading/AGENTS.md` already records the settled-command, intrinsic-geometry, canonical-writing and transfer-owned-buffer invariants. No additional guidance change is needed.
