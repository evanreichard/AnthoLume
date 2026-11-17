# M3 large-book independent qualification

**Result: 1/4 private-book workflows pass; 3/4 fail. Large-book acceptance remains OPEN.** All four import, publish, match independent original SHA-256/KO references and survive two genuine offline browser-process reopens. Three-font probes complete for every book, but visible-anchor, ready-page image and retained KO failures prevent parity. The largest original also downloads successfully through the actual authenticated Go API. Memory qualification is not closed by bounded read/cache counters alone.

Authority: [migration goal](../frontend-migration.md), [reader implementation report](m3-reader.md), and explicit user authorization for bounded source/range/lazy support—not larger eager caps. The owner's public large-file result is a cross-check, not a substitute for this actual-book evidence. No application, dependency, git, source snapshot or other owner's listener was changed. No server remains running.

## Private dataset and reproducibility

Four originals, **96,986,325–302,108,108 bytes**, were selected from 201 EPUBs and extracted exclusively into opaque private files using bounded copying. Inventory: **170–439 inner entries**, **100,694,418–303,747,324 declared expanded bytes**, largest entry **1,813,466–5,567,616 bytes**; 685 raster headers measured, with individually acceptable dimensions. These are the same originals used throughout, not rewritten/repacked substitutes. Final bounded rehashing still matches all four original-copy references.

**Readerowner may READ the private copies, inventory, references and evidence under `_scratch/m3/large-books/`.** That workspace's README identifies exact runs, opaque case mapping and reproduction commands. Original member names, titles, paths, hashes, content, profiles, screenshots and raw error details remain private scratch artifacts. This report contains only aggregate/minmax results.

Normal production Vite configuration/plugins compiled the app, root worker, dedicated source worker and staging worker directly into owned scratch; only output/cache locations were overridden. The existing actual-production-router Go test composition was freshly compiled with readonly/offline module resolution and fresh synthetic DB metadata. No private snapshot database was restored. The largest private original was copied only into that isolated server's data directory for the explicitly requested real document API download, never into a public asset/fixture endpoint.

Both build captures were source-stable during compilation. The final full run uses the second capture's manifest. Reading implementation hashes remained unchanged through qualification; frontend-owned shell/recovery/route files continued changing afterwards. Evidence is bound to the captured production build, **not approval of every subsequent shell edit**. No stale eager assets or reader harness page was used.

Command structure, with finite outer timeouts and existing local toolchains:

```sh
python3 _scratch/m3/large-books/refresh_current.py
python3 _scratch/m3/large-books/run_current.py all
python3 _scratch/m3/large-books/run_current.py probe
```

The full-run result JSON, not successful harness shutdown, determines acceptance. Linux user/network namespaces fail closed, enable only loopback and have no external route or host/tailnet interface. Port **5453** exists only inside the owned namespace. Browser routing is supplementary; kernel isolation also blocks worker egress. No untrusted ebook links were followed. Ports 5173/5175/5323/5346/5348 were untouched.

Environment: Linux 6.18.60, Go 1.26.11, Node 22.23.4, Playwright 1.65.1, Chromium 157.0.8103.38; headless desktop, 390×844 plus 844×390 reflow. This is not physical-phone/PWA qualification.

## Actual executed contracts

| Contract | Independent result |
| --- | --- |
| Anonymous local import/public availability | **4/4** publish and show available through the real app |
| New storage representation | Native IDB version **20**; `books.sourceId` → complete `sources.blob` for locals; largest API download → `sourceChunks`, not obsolete `books.bytes` |
| Original integrity and KO identity | **4/4 locals + largest download** match independent references; <=256-KiB sequential verification, never whole-book concatenation |
| Beginning/middle/end TOC and turning | Every case exercised; up to six consecutive turns per target, with refusals retained as failures |
| Fonts/size/orientation | **12 font probes** across three packaged fonts and changing sizes, plus landscape/portrait; two originals fail visible-anchor checks |
| True cold recovery | **8 new offline browser-process reopens**, two per original, with Go stopped and the actual input-file pathname hidden; original identity/checkpoints retained |
| Local isolation | **Zero** local reading-event requests and zero local durable events |
| API download | Largest original successfully streamed, published, independently verified and opened through the actual authenticated Go API with synthetic opaque metadata |
| Workflow outcome | **1 pass / 3 fail**; a passing workflow does not close the memory gate |

Full stored-byte verification ran in a separate final browser process, outside measured import/open/navigation phases. It follows the source pointer and reads Blob slices or individual source chunks, incrementally hashes in Node, and checks stored full checksum/KO partial hash/size. The source ID and passive checkpoints were also compared across process restarts. No full-original hash on normal reopening, automatic beginning fallback, identity merge or KO rewrite was used to manufacture success.

The small public comparator also exposes KO/image/anchor problems. These are not all consequences of archive size, nor reasons to exempt ordinary-format failures.

## Blocking findings

1. **Retained KO ambiguity: one private original.** Extended intentional turning reaches the existing descendant-writer versus child-axis-reader disagreement in passive nested XHTML. Refused turns retain the previous checkpoint and zero local events; explicit TOC navigation can recover. Fail-closed identity protection is correct, but unrestricted page/position parity still fails. This remains a failure, not an approved exclusion.
2. **Visible logical anchor: two private originals.** A saved middle-TOC element resolves in the original-shaped DOM but lies outside the clipped reading viewport, before/after font/size reflow and on the first cold reopen. Checkpoint equality alone would falsely pass. Independent XPath/range/element rectangles and a separate native follow-up reproduce offscreen middle anchors while the page contains a real decoded image. This is an observable restoration/geometry failure, not missing source bytes.
3. **Ready-page image/layout sequencing: two private originals.** During repeated TOC/reflow transitions, the reader reports `ready` while a visible HTML IMG has no source/natural dimensions; some samples contain neither decoded visible imagery nor visible text. Subsequent fresh, settled native probes can decode those books, so this is **not a claim of permanent unrenderability or an unsupported ZIP format**. The readiness/visible-lease/layout sequencing needs reproduction and closure. A cover rendered by native SVG IMAGE was initially missed by the qualifier; the corrected observer decodes/counts it and does not report that harness error as an application defect.
4. **Unforced memory/plateau remains unresolved.** Dedicated-source-target backing-storage readings are much larger than main-isolate observations; repeated native navigation does not establish a stable process-memory plateau. Attribution and bounded retention need further owner investigation rather than a universal device ceiling or a forced-GC pass.

No additional production archive/manifest/CSS publication rejection occurred in these four originals. Runtime findings remain explicit, not waived as “large”. Private evidence contains opaque case/stage mappings and generic gate categories only in the shareable handoff.

## Memory and native-image evidence

No forced GC was used. Main CDP samples were taken about every 200 ms; source/staging workers were independently attached through CDP, instrumented before execution and sampled through lifetime. Source terminal statistics, incoming/outgoing transfers, Blob/BYOB reads, object URLs, DOM/resource diagnostics and worker termination were observed. Worker attachment adds startup/debugging overhead, so these runs are not latency benchmarks.

| Measurement | Observed aggregate/minmax |
| --- | --- |
| Original source read maximum | **262,144 bytes**, including dedicated worker observations |
| Cold opening source IO | **1,579,237–6,470,055 bytes**, not a fresh full-original pass |
| Largest outgoing expanded resource | **5,567,616 bytes**; resource transfer, not whole-archive transfer |
| Largest download BYOB/transfer | **65,536 bytes**; measured write window **8,388,608 bytes** |
| Canonical DOM cache | Maximum **2**, maximum observed XML source bytes **114,774**; budget 2 / 8 MiB |
| Asset URL cache peak | **6,612,083 bytes**, below 32-MiB working/64-MiB outgoing-current limits |
| Local main used-heap peaks, verification excluded | **14,379,940–20,248,476 bytes** |
| Local main backing-storage peaks, verification excluded | **23,451,361–44,154,770 bytes** |
| Small comparator main heap / backing peak | **17,776,064 / 4,747,122 bytes** |
| Dedicated source-target used-heap peaks | **2,013,016–3,493,084 bytes** |
| Dedicated source-target backing-storage peaks | **193,354,905–370,349,497 bytes** |
| Download main heap / backing peak | **23,700,976 / 21,678,146 bytes** |
| Staging-target backing peak | **24,643,401 bytes** |
| Selected active native imagery | Up to **2** decoded visible images; maximum observed **3,997,840 pixels** |

The high backing-storage signal occurs during sequential entry validation as well as hash/index work. It does **not** establish that one entry retains hundreds of megabytes, identify all allocations as live JS cache, or attribute them to native image decoders. Main-isolate numbers and small reads do not explain it away. Worker heaps, backing storage, logical cache accounting and native/process memory are different measurements; physical source workers can share renderer processes.

Per-second OS RSS/PSS/private memory was collected for the owned process tree, excluding the observer from browser totals. The first sampler retained correct totals/PIDs but did not classify Chromium's rewritten argv reliably; a dedicated follow-up uses **CDP SystemInfo process types/IDs plus `/proc`**, not inferred zero renderer memory. In comparable fresh-process, already-stored native scenes:

- Private-book renderer-process RSS peaks: **510,758,912–627,965,952 bytes**; PSS **222,488,576–371,086,336**; private memory **169,111,552–287,625,216**. These sum the browser's renderer processes, not just one JS isolate or image allocation.
- Small comparator renderer PSS peak: **185,665,536 bytes**. Larger images can legitimately increase native memory; observed peaks do not monotonically follow original archive size. GPU/browser/Go processes are recorded separately in private evidence.
- Across two repeated same-target navigation rounds, renderer PSS changed **−20,243,456 to +50,853,888 bytes**. Two rounds do not prove a plateau; positive growth is retained evidence, not hidden by GC. All observed reader closes release active workers and owned object-URL bytes to **zero**, but native process memory does not return immediately to baseline.

Actual native decode and clipped visible image area were checked, including SVG IMAGE covers; iframe existence, reserved image boxes and skeletons do not count as image success. Numeric C++ allocation sampling and private screenshots supplement, but do not isolate every decoder allocation. RSS sums double-count shared pages; PSS/private memory improves attribution without making these observations a universal phone ceiling.

## Task-end report

- **Assumptions:** desktop Chromium is a bounded integration target, not a physical-device memory contract; the user's original-byte and KO invariants remain mandatory.
- **Autonomous decisions:** fresh normal builds into owned scratch, actual-Go public-only metadata, anonymous imports before the real largest download, separate-process integrity verification, independent worker/native observations and visible-anchor assertions beyond checkpoint equality.
- **Compromises:** three workflow failures and unresolved backing/native plateau evidence prevent acceptance. Continued frontend edits limit shell approval to the captured manifest; reading source stayed unchanged. No application fixes, private committed fixtures, trace output, blanket format exemptions or forced-GC substitutions were used.

Repeatable schema-2 verification, worker observation, namespace isolation and Chromium process-role pitfalls are captured in the private workspace README/helpers. Any future public regression helper should use synthetic/public fixtures under readerowner's test ownership, never these originals.
