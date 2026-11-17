# M3 opaque D — bounded independent qualification

**PASS — the remaining D cold-phase, cleanup and stored-byte checks are complete on the current-controller snapshot.** Exactly one newly authorized offline browser process and one intentional cold turn were used. Earlier import, middle-TOC, three-turn, font/size and image-bearing checks retain their earlier source version; they were not repeated or relabeled current-build coverage.

## Actual assertions

| Gate | Result and source scope |
| --- | --- |
| Public bootstrap, anonymous local import, published identity | PASS on earlier captured production build |
| Middle requested source anchor, three next turns, one font/size change | PASS on earlier build; clipped-visible anchors and passive checkpoint preservation |
| Actual book imagery | Earlier build: two image-bearing samples natively decoded, including middle TOC; no placeholder counted |
| Current production controller | PASS; built from a consistent copied source snapshot; current reader chunk verified loaded; source unchanged through final audit |
| Saved cold checkpoint | PASS on current controller; identical source/identity/checkpoint, direct source anchor visible inside the clipped viewport |
| One intentional cold turn | PASS on current controller; checkpoint advances, resulting anchor visible; two passive checks preserve checkpoint and zero local events |
| Reader close | PASS; **0 active workers, 0 owned URLs, 0 owned URL bytes** |
| Independent stored original | PASS; original source Blob read sequentially in **370 chunks**, maximum **262,144 bytes** per read; **96,986,325 bytes** independently SHA-256 hashed and complete-sample KO MD5 checked against original references; no whole-book concatenation |
| Original preservation / final cleanup | PASS; original independently rehashed unchanged, size/mtime unchanged, owned input pathname restored; **0 remaining owned browser/server processes** |

The current cold samples contain **0 visible images**: these are text pages. Their native XHTML/blob transport and visible source anchors pass, but they do not constitute a fresh image-bearing decode test. Image-bearing evidence above belongs explicitly to the earlier build. No extra TOC/image visit or appearance loop was added.

## Corrected oracle and numeric sample

The earlier qualifier incorrectly rejected any hash operation. The corrected owned oracle examines **hash payload sizes and source IO**, allowing validated-manifest hashing while rejecting whole-original hashing/reindexing on open.

- Cold hash payload: **268,808 bytes**, the bounded validated manifest—not the original book.
- Cold opening source IO: **1,579,237 bytes**; **0 index operations**; maximum source read **262,144 bytes**.
- Current cold-phase canonical DOM cache: maximum **2**; peak asset cache **8,122 bytes**.
- Local reading-event requests: **0**; durable local events: **0**.
- Full stored verification ran after reader close and is excluded from opening IO. It independently computes both full SHA-256 and KO partial MD5 from stored bytes, rather than merely trusting stored metadata.

## Offline/current-source method and limits

Go remained stopped throughout the continuation; no listener was started. The browser was offline from launch inside a loopback-only kernel network namespace with no external route. The owned import pathname was hidden before launch and restored in `finally`; original source files and the source archive were not changed.

To reuse the committed profile while testing the corrected controller without serving network responses, the single offline process first opened its already-cached offline library. The qualifier then staged **24 fresh production assets** into the existing shell cache and replaced the running worker's in-memory precache manifest. Worker executable logic was verified byte-identical; book storage/checkpoint equality was checked before and after staging. Only then was the reader opened with the fresh production chunk. **This is controlled offline asset staging, not qualification of service-worker update delivery or a natural unmodified-cache restart onto a new build.**

The earlier warm phase used the preceding source capture. The current copied snapshot includes the controller correction and its regression test; no full warm workflow was repeated on that snapshot. Historical saved-string compatibility and injected image-failure cleanup were not separately tested. Desktop Chromium only: no phone, other-engine, corpus, RSS plateau or memory-ceiling acceptance is inferred. No forced GC, screenshots, traces, private titles, content, source member paths or identity hashes enter this report.

## Task-end report

- **Assumptions:** the committed D profile/reference identify the authorized copy; desktop-only bounded qualification is the requested scope.
- **Autonomous decisions:** corrected the oracle using payload size plus IO; reused committed book storage; staged fresh production cache assets without a listener; spent only the authorized additional cold process.
- **Compromises:** current cold pages are text-only, and earlier image/warm evidence remains version-bound; controlled cache staging does not prove update delivery. These limits prevent broader current-build/device acceptance, not completion of the requested remaining checks.

Knowledge capture: the private qualifier README records the metadata-hash distinction, source-version split and offline cache-staging limitation.
