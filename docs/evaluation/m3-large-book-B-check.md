# M3 opaque B — current streaming reader qualification

**PASS for the requested bounded one-book workflow.** Import, middle requested primary source anchor, three warm turns, one font/size change, one genuine offline cold restore and turn, stored-original integrity and reader-close cleanup pass on the same fresh production snapshot. No application counterexample was found in these transitions. This does not qualify a corpus, process-memory ceiling or physical device.

## Actual assertions

| Gate | Result |
| --- | --- |
| Anonymous local import and availability | PASS; newly imported original publishes a complete source and expected identity in IDB version 20 |
| Middle requested source anchor | PASS; TOC entry 63/126, independently derived from original navigation/XHTML; direct child-axis primary source target resolves and intersects the clipped reading viewport, not merely an equal saved checkpoint |
| Three intentional next turns | PASS; each advances the durable checkpoint and its primary source anchor remains clipped-visible; passive observations preserve the checkpoint |
| One font and one size change | PASS; checkpoint/source/identity unchanged after each change; final reflowed primary anchor clipped-visible |
| Actual image source | PASS; five image-bearing observations natively decode actual owned resources; four observations, including a warm turn and the cold turn, independently SHA-256-match source image entries from the original; zero visible intrinsic placeholders counted as images |
| Genuine cold restart | PASS; warm browser process closed, Go stopped, owned input pathname hidden before launching the one offline browser process, same persistent profile; no cache staging or substituted responses |
| Cold identity/anchor and one turn | PASS; exact durable source/identity/checkpoint restored with primary anchor clipped-visible; one next turn advances checkpoint and stays visible; passive checks preserve it |
| Local-only isolation | PASS; zero local reading-event requests and zero durable local events |
| Close-reader release | PASS; **0 active workers, 0 owned URLs, 0 owned URL bytes** |
| Independent stored original | PASS; **302,108,108 bytes**, **1,153 sequential Blob slices**, maximum **262,144 bytes**; incremental SHA-256 and complete-sample KO MD5 match independent original references and stored metadata, without whole-book concatenation |
| Final preservation/cleanup | PASS; original independently rehashed unchanged, size/mtime unchanged, owned input pathname restored, zero remaining owned browser/server processes or listener |

The exact requested middle anchor is a text scene. Actual source-image evidence occurs during the permitted turns; no extra image-seeking TOC grid was added. Native XHTML Blob transport passes throughout. Cold recovery has no whole-original hash/reindex operation.

## Source binding and bounded numeric evidence

Build manifest SHA-256: `a04b1944654a66a3655ca268ac2ebc65a4107d6c60b3989d7937b6b21019724f` (build identity, not private-book identity).

Normal production Vite configuration/plugins and a fresh Go production-router test composition were built from a consistent owned source snapshot with existing dependencies and readonly/offline Go module resolution. Snapshot, compiled assets and server binary remain unchanged. Final audit finds no build-input/application-source changes; only the unrelated, non-build API fault helper changed externally. Every warm/cold assertion above uses this build, unlike D's earlier/current source-version split.

| Measurement | Observed value |
| --- | ---: |
| Warm opening source IO, import excluded | 8,567,207 bytes |
| Cold opening source IO | 6,470,055 bytes |
| Cold metadata hash payload | 178,599 bytes |
| Cold index operations | 0 |
| Maximum original-source read | 262,144 bytes |
| Canonical DOM cache maximum / source bytes | 2 / 69,012 bytes |
| Peak asset cache | 3,951,627 bytes |
| Loaded engine sections maximum | 1 |

Opening IO is below the original size and 16 MiB. The oracle explicitly allows bounded validated-manifest hashing (repository.ts:172–175); a hash-operation count is not treated as evidence of whole-book hashing. Stored verification runs after reader close, outside opening-IO accounting. These are logical working-set/terminal-IO counters, not RSS, retained native memory or a plateau measurement.

## Method, oracle corrections and limits

All service/browser work ran inside a kernel user/network namespace with only loopback enabled and no external route, using port **5455**. Browser request restrictions were supplementary. No private book was served through Go or on the tailnet; existing listeners/test ports were untouched. The offline browser was offline from launch while Go remained stopped and the import pathname was absent; restoration is protected by `finally`.

Two warm qualifier interruptions preceded the completed workflow: image-source inspection initially attempted a CSP-blocked Blob fetch, and the reuse continuation initially selected the wrong library route. Both were owned-oracle errors, not application failures. The corrected observer inspects the existing owned Blob without fetching it or retaining it after URL revocation; actual resource hashing uses at-most-256-KiB reads. The already-imported, same-build verified source profile was reused. Neither interruption spent an offline cold process or an intentional turn. Exactly one offline restart and four intentional next turns completed; final numeric observer errors are zero.

No application, dependency or git changes. The original outer ZIP was not accessed; source names, private identity hashes, content traces and screenshots are absent from this report. No additional fonts, distant targets, corpus, RSS campaign or forced GC. Desktop Chromium only; physical-device/process-memory qualification remains open. Private reproduction/build/audit evidence stays in the assigned scratch workspace.

## Task-end report

- **Assumptions:** the authorized opaque B copy and reference identify the intended original; desktop Chromium is the bounded integration target.
- **Autonomous decisions:** frozen current production snapshot, independent original-navigation target and image-byte oracle, same-build source-profile reuse after correcting warm-only qualifier errors.
- **Compromises:** physical-device and process-memory behavior remain unqualified because they are outside this bounded check; no service-worker update-delivery claim is made.

Knowledge capture: the owned scratch README records the CSP-safe actual-image oracle and the metadata-hash/opening-IO distinction.
