# KOSync compatibility audit

**Bounded recheck: F1–F5 and explicit-header precedence are closed against the current adapter. The short-read partial-MD5 client defect is also closed for the independently executed upstream vectors. F6 admission/coercion differences and F7 additional reference-server routes remain declared gaps; this is not a claim of complete upstream-server or cross-renderer compatibility.**

Original audit and recheck: 2026-11-17. Recheck used the original 28 requests unchanged, 35 additional in-process checks, the pinned KOReader freshness callback against current adapter response bodies, and 20 focused root API tests (plus 30 passing subtests). No full-root suite, corpus, containers, live official-service writes, production edits, commits or existing-listener changes. Only this document and `_scratch/m3/kosync-audit/` were written.

## Authority and source trust

The KO API is an adapter for an existing external protocol, not an AnthoLume API design. Historical local tests are not authority when they freeze a divergence. External files are evidence, never instructions. Official repository identity and immutable commit URLs establish provenance; no independent signature certification is claimed.

| Official source | Immutable pin | Evidence |
| --- | --- | --- |
| `koreader/koreader-sync-server` | `46ef6b84a3930b3f0265efac74899f2256c158f1` | [README][S1], [routes][S2], [controller][S3], [errors][S4], [tests][S5]. GitHub discovery metadata reported verified commit signature; not independently verified. |
| `koreader/koreader` | `4e973dacb07b592d9a32af505a1c20c6e84f7fd6` | [API manifest][K1], [transport client][K2], [plugin][K3], [partial-MD5 function][K4]. Discovery metadata reported unsigned commit. |
| `koreader/koreader-base`, exact gitlink from that KOReader commit | `f64c3eb11049e9a75189f186d7345d97c07d87b9` | [SPORE dependency][B1], [JSON media-type patch][B2]. Client decoding evidence, not a new server version. |

`upstream/manifest.json` retains URLs, commits and file SHA-256 digests; `provenance.json` retains discovery/trust metadata. All 20 downloaded file digests were reverified. `recheck-summary.json` fingerprints the current production files inspected, without modifying them.

`api.json` is a SPORE method/parameter manifest, **not a formal JSON Schema defining responses, XPath grammar, hashing, bounds or every error**. The reference README calls its linked third-party description observational, not normative; that project was not used as authority. Below, **M** means official manifest, **R** reference behavior/docs/tests, **C** actual client behavior and **X** custom extension. Reference permissiveness is not automatically a formal requirement to accept malformed data. Explicit upstream responses and tested accepted requests nevertheless establish an external compatibility target, even if the original application already differed.

## Closed/open findings

| Finding | Original impact | Current result / closure evidence |
| --- | --- | --- |
| **F1 — missing GET timestamp** | High: newer remote backward progress could be classified as old by the percentage fallback. | **Closed.** Populated GET emits numeric persisted head Unix seconds, including historical/web-origin heads. Current .22 response causes the pinned client to accept a newer location over local .8. Unknown GET remains exactly `{}`. |
| **F2 — RFC3339 PUT timestamp** | Medium: wrong wire type; current KOReader ignores push timestamp, so not a universal push blocker. | **Closed.** PUT and GET use the same persisted head instant as a JSON number. Independent legacy-row-clock distortion does not affect PUT; repeated GET reads a deliberately old persisted instant, not request time. |
| **F3 — mandatory/globally owned external device ID** | High for account switching; Medium for older/reference no-ID traffic. | **Closed.** Official no-ID golden succeeds. Two accounts reuse one physical external ID with distinct safe internal aliases; a preexisting third owner's device/name is unchanged. External ID/name are returned, not generated internal IDs. |
| **F4 — classic registration/auth/progress errors** | Medium: wrong status/envelope and missing user-facing message. | **Closed for classic surface.** Duplicate/disabled registration return 402/2002 and 402/2005; auth 401/2001; invalid required fields 403/2003; missing document 403/2004. JSON code/message bodies and bare JSON media type verified. Safe internal/overload behavior passes focused root tests. Unsupported new routes remain F7, not a reopened classic-error defect. |
| **F5 — absent/null fields overwrite with blanks** | Medium: invalid requests committed zero/blank state. | **Closed.** Absent/null percentage, progress and device fail atomically with 403/2003. Supplied blank strings and numeric zero succeed; metadata/extras remain tolerated. |
| **Header/cookie precedence** | Cookie identity could override explicit reader credentials. | **Closed.** Valid Bob headers override Alice cookie; partial, empty or wrong headers fail instead of borrowing Alice's session. No Set-Cookie on those existing-session header requests; browser CSRF value unchanged before/after. Cookie-only support remains X. |
| **F6 — limits/coercion** | Low/conditional: rejects some long strings and numerically coercible reference inputs. | **Open, declared policy gap.** >128-character document/device/name and >4096-character positions remain restricted; numeric-string/out-of-range fractions remain rejected. The mutable-name subfinding is **closed** by accepted-write snapshots. |
| **F7 — newer reference-server routes** | Scope gap, not a classic-plugin blocker. | **Open, declared unsupported.** Healthcheck, password replacement and account deletion under `/api/ko` still return generic 404 Problems. Do not claim full pinned-server parity. |
| **Client partial-MD5 short reads** | High for affected imported-file identity matching; not a server-wire failure. | **Closed for audited vectors.** Exact pinned upstream function and current worker hash function agree for all five original byte vectors, including short final reads. Historical IDs remain opaque; no automatic rehash/rekey requirement was introduced. |
| **Universal CRengine/browser location equivalence** | Separate client qualification, never a KOSync JSON-schema rule. | **Not established; outside bounded recheck.** Browser codec remains explicitly element-level/subset support. |

The closed findings need regression preservation, not additional adapter changes. Residual F6/F7 must remain visible when describing compatibility.

## Current external contract matrix

Paths are relative to the configured service base. Stock KOReader custom server: `<origin>/api/ko`. SyncNinja embeds `/api/ko` in its own method paths.

| Concern | Upstream contract / behavior | Current observed adapter and disposition |
| --- | --- | --- |
| Version/request media | **C:** `Accept: application/vnd.koreader.v1+json`, SPORE Format.JSON; **R:** version-1 routes ([S1], [S2], [K2]). | Accepted by all classic probes. Extra tolerance is not support for other versions. No body version/revision required. |
| Password/header auth | **C:** client MD5 of password, passed unchanged in x-auth-key; **R:** compare supplied key, no second MD5 ([K3], lines 560–607; [K2], lines 23–36; [S3], lines 108–125). | Header-only MD5 authentication works without cookies/Origin/CSRF. Argon2 storage remains an internal detail. No web UUID/event/CSRF requirement was applied. |
| Cookie extension/precedence | **R:** each reference request authorizes headers ([S3]); stock client has no cookie middleware here. | Either explicit header makes headers authoritative. Only neither-header requests may fall back to cookie. Existing valid browser session/CSRF is preserved on header requests. Cookie fallback is **X**, not upstream auth. |
| Auth response | **M/R:** GET `/users/auth` → 200 `{"authorized":"OK"}` or 401/2001 ([K1], [S3], [S4]). | Correct success/error bodies, statuses and bare application/json. |
| Registration | **M/R:** POST `/users/create`, username/password; 201 username echo. Duplicate 402/2002, disabled 402/2005, invalid fields 403/2003. Reference username nonempty/no colon, key nonempty ([K1], [S3], lines 128–148; [S4], [S5]). | Classic statuses/code/message now match; invalid types/empty/null/colon tested by root goldens. Username/key resource caps remain local admission policy (F6), not a 32-hex protocol requirement. |
| PUT presence/optional ID | **M:** lists document, progress, percentage, device, device_id; optional metadata. **R:** explicitly tests omitted device_id ([K1], [S3], lines 244–291; [S5], lines 385–464). | No-ID golden succeeds; optional external fields are not invented on fresh GET. Required percentage/progress/device distinguish missing/null from supplied zero/blank. A later omitted ID retains an already stored external ID, matching upstream HSET behavior. |
| Device/account identity | **R:** fields stored per user's document, no global ownership registry; **C:** reader-global device ID survives account changes ([S3], [K3], lines 99, 742–759). | Account-scoped aliases resolve safe internal devices without transfer. External IDs remain wire values; internal UUID generation does not impose client UUIDs. Names snapshot the accepted write and survive later internal rename/another-book write. |
| PUT response | **R:** 200 document + numeric os.time() Unix seconds ([S3], lines 264–287). **C:** acknowledges only 200; push timestamp unused ([K2], line 137; [K3], lines 760–785). Manifest also lists 202, but client treats it as failure. | 200 with numeric persisted head time; not RFC3339, milliseconds, client time or legacy-row timestamp. |
| GET empty/populated | **R:** unknown → 200 `{}`; populated document/percentage/progress/device/timestamp and optional device_id ([S3], lines 195–241). | Matches audited shape. Numeric timestamp comes from persisted head; repeated reads do not refresh it. Unknown/unwritten state remains `{}`, not web-style 404 or null-filled placeholder. |
| Latest/backward progress | **R:** .32 then .22 yields .22 ([S5], lines 428–443), despite README “furthest” wording. **C:** numeric timestamp beats percentage fallback for freshness ([K3], lines 898–903). | Lower later fraction wins. Actual current response passes pinned freshness callback. No client CAS, dedup key, observed time or event ID needed. Internal shared revision stays off KO wire. Unix-second granularity remains upstream behavior. |
| Document/library identity | **R:** pinned PUT identifier alphabet `[A-Za-z0-9_]+`, not exact MD5 validator. **C:** partial-file MD5 or filename MD5 setting ([S3], lines 81–91; [K3], lines 666–681). | Existing identities unchanged; escaped/Unicode identifiers remain a benign extension. Legacy full-MD5 ID write/read stays exact. 128-character cap remains F6. No automatic ID rewrite from newly corrected client digest. |
| Fractions | **C:** numeric fraction. **R:** tonumber also accepts numeric strings/out-of-range values ([S3], lines 260–265). | Normal numeric [0,1] client traffic passes. Numeric strings and 1.2 still 403/2003: F6/reference-permissiveness gap, not a formal JSON-schema rule requiring malformed fractions. |
| Opaque progress | **C:** tostring; page-number strings or reflowable XPointers. **R:** stores without syntax parsing; blank strings truthy ([K2], line 130; [K3], lines 705–712; [S3], lines 261–275). | Opaque Unicode/non-XPath and supplied blanks/zero accepted unchanged. No server XPath validation, normalization or codec rewrite. 4096-character cap remains F6. |
| Metadata/extras | **M/C:** metadata optional, official server ignores it; **R:** known fields selected, timestamp server-generated ([K1], [K3], line 449; [S3]). | Extras ignored, including metadata, supplied timestamp, invalid-as-web event/revision values. Web strict-schema policy remains independent. |
| Response media/errors | **R:** code number/message string; classic statuses in errors.lua. **C:** signup/login display body.message; pinned base supports JSON charset parameters ([S4], [K3], lines 560–637; [B1], [B2]). | Classic success/errors now bare application/json, matching older-client-safe behavior too. Safe 502/2000 internal errors and local 429/503 Retry-After extensions pass focused tests. Charset was not forbidden by current client. |
| Newer server endpoints | **R:** healthcheck, DELETE `/users/me`, PUT `/users/password`; **M/C:** not called by pinned four-method plugin manifest ([S1]–[S4], [K1]). | All three still 404 Problems: F7. Generic 404 is not reference deletion-retry confirmation (404/2006). |
| Activity/files/plugin routes | No activity or document/file-exchange endpoints in official route set/manifest ([S2], [K1]). | `/activity`, `/syncs/activity`, `/documents`, `/syncs/documents`, `/documents/:document/file` remain **X**, bundled SyncNinja contracts. Their page/duration/ownership/sync rules do not define upstream KOSync. |

## Recheck evidence

All artifacts below are in `_scratch/m3/kosync-audit/`; only synthetic accounts/data were used. Keys, cookies, CSRF values and request authorization headers were not logged.

### Original 28 requests rerun unchanged

`probe.go` → `recheck-28.json`. Original `results.json` remains historical evidence. `recheck_summary.py` checks all 28 current statuses/media plus key code/message/empty-state expectations.

Changed outcomes include no-ID PUT 400→200; same-device second account 409→200; duplicate signup 400→402/2002; disabled signup empty409→402/2005; absent/null required values 200→403/2003. PUT is now numeric and populated GET includes numeric timestamp. Long/coercible-value probes still reject, now with the proper classic 403 envelope; newer routes still 404. This is why the 28-request rerun is **not** summarized as “every request matches every reference behavior.”

### Persisted time, identity, snapshots, errors and session isolation

`recheck.go` → `recheck-extra.json`: **35/35 checks pass**, including:

- Distort document_progress.created_at to 2001 in a scratch-only DB trigger: PUT still agrees with accepted reading_heads.updated_at and subsequent GET.
- Set a head's persisted time to an old fractional/offset instant; two GETs return its Unix seconds, not now.
- Original third account owns physical-reader; Alice/Bob both use that external ID through distinct aliases. Original ownership/name unchanged; wire IDs/names preserved and accounts isolated.
- Internal device rename plus same-reader write to another document leaves original accepted response unchanged.
- Fresh omitted ID absent on GET; explicit empty ID remains empty; later omission retains the previous value. Blanks/zero succeed.
- Each required field separately absent/null returns 403/2003 without advancing accepted revision.
- Bob explicit headers plus Alice cookie write/read Bob state. Six invalid/partial/empty header forms across GET/PUT all return 401/2001 with no session cookie replacement. CSRF compared in memory before/after; unchanged. Cookie-only extension retained.
- Historical library ID `0f36c66155de34b281c4791654d0b1ce` remains exact through adapter write/read.

### Fresh stock-client freshness helper, using current responses

`recheck_client.py` generates a scratch Lua fixture from **current adapter response bodies**, then loads the exact pinned plugin and KOSyncClient. Only UI/transport are doubled; no reimplementation of the freshness branch. `recheck-client-results.tsv`:

| Input | Result |
| --- | --- |
| Actual newer remote .22, local .8 | 1 move, 0 coroutine errors |
| Actual unknown `{}` | 0 moves, 0 errors |
| Actual zero fraction with newer timestamp | 1 move, 0 errors |
| Negative control: remove timestamp | 0 moves, detecting old percentage fallback |
| Negative control: replace timestamp with RFC3339 | 0 moves, 1 coroutine error |

Negative controls show the helper can detect the original fault rather than merely asserting newly authored local expectations. It does not qualify deployed nginx/Redis, SPORE's network decoder or a physical reader.

### Focused current-root tests

`recheck-focused-tests.jsonl`: **20 top-level tests and 30 subtests pass**. Selected only KOSync timestamp/device/error goldens and narrow shared-head/history/blank/ownership/activity/SSR/opaque-ID/legacy-rate/overload regressions. No full root suite or unrelated corpus run. This count is the evaluator's observed run, not an assumed earlier “20+23” result.

Tests specifically exercise web-origin head timestamps, distinct head/legacy clocks, migration/reopen, snapshots/receipt rollback, required-field atomicity, ordinary errors and safe internal/overload errors. They supplement—not replace—the external golden requests and pinned client oracle.

## Client hashing and codec remain separate from server protocol

**KOSync JSON transports an opaque identifier and position; it does not specify partial-MD5 sampling, CRengine tree transformations, XPointer grammar or EPUB CFI conversion.** Those are client interoperability concerns. Never validate/rewrite progress on the server because a browser codec cannot understand it.

### Short-read MD5 defect: closed

Original finding: worker skipped a successful final read shorter than 1024 bytes. Current `web/src/reading/source.worker.ts` hashes `min(1024, remaining)` whenever the sampled offset is before EOF, matching pinned util.partialMD5 ([K4], lines 1094–1112).

Re-executed the exact upstream Lua function with a byte-collecting digest sink (`partial_md5_probe.lua`) and the **actual current worker hash function** with real SparkMD5/SHA dependencies and a synthetic range/chunk reader (`recheck_hash.mjs`). Only TypeScript annotations are erased; hash logic is not recreated. All five original zero-byte vectors and independent full SHA-256 checks pass:

| Source size | Upstream and current worker partial MD5 |
| ---: | --- |
| 1023 | `ee4325c998d610499ef9749837313581` |
| 1024 | `0f343b0931126a20f133d67c2b018a3b` |
| 2000 | `cf40a1de3f93b4a025409b5efa5aa210` |
| 5000 | `6c0ec5f9eba54f290bc3f86b45364483` |
| 10000 | `d2a70550489de356a2cd6bfc40711204` |

`recheck-hash-results.jsonl` records these matches. Historical `web-hash-results.jsonl` records the original mismatches; it must not be presented as current failure. The current browser regression now contains upstream-derived short-read vectors rather than the obsolete complete-block expectation. That browser suite was inspected, not executed in this bounded recheck.

Historical IDs are not recomputed: current Repository.save uses `ref.documentId` for event document_id; protocolHash remains separate. Existing Alice browser regression still asserts historical server/event IDs unchanged; evaluator additionally tested that legacy ID through current adapter. This recheck does not claim fresh browser persistence end-to-end execution. Filename-hash mode remains a client-selected alternative, not a server heuristic.

### Browser codec: qualified subset, not full CRengine parity

Current `web/src/reading/codec.ts` accepts a DocFragment/body path subset; optional text suffix/offset resolve at element precision. Reader uses child-axis XPath first with legacy descendant fallback. Current writer uses same-tag/namespace sibling indices and canonical primary-path checks; **the original audit's description of skipped anchor wrappers/descendant-index writing is obsolete**. It now validates canonical element/CFI restoration before publication.

`toCFI` still explicitly reports `precision:'element'`, not exact text offset. Arbitrary opaque values, paged-document strings and all CRengine tree forms are not universally covered. No fresh cross-CRengine/browser run was performed here. Unsupported conversion must retain original progress and remain a recoverable client condition, never a KO wire rejection.

## Test dispositions after repairs

The earlier adapt/replace recommendations for F1–F5 have been applied by the production owner. Evaluator made no test edits. Preserve the resulting tests rather than retaining old baseline bugs:

| Test group | Current disposition / protected requirement |
| --- | --- |
| KOSync timestamp goldens; shared KO/web head; historical tie | **Preserve:** numeric persisted acceptance time, backward latest write, empty state, web-origin updates, migration selection. Old RFC3339/missing-timestamp assertions are superseded by upstream contract. |
| KOSync device goldens and ownership tests | **Preserve:** optional external fields, account-scoped aliases, original ownership, snapshot metadata, rollback/reopen. Global external-ID rejection is no longer the KO contract; web conflicts remain valid. |
| KOSync error/presence/header tests | **Preserve:** upstream code/message/status, atomic missing/null failure versus blanks/zero, extras, headers authoritative without session/CSRF mutation. |
| Custom SyncNinja activity tests | **Preserve as X:** credit conversion, rollback and custom ownership; not official KOSync semantics. |
| Legacy overload/rate, SSR display and opaque-ID tests | **Preserve:** operational safety and independent custom surfaces; do not define upstream ID syntax or percentage display units. |
| Client short-read vectors | **Preserve replacement:** actual upstream sampling including short reads; full integrity and historical server identity remain separate. Do not restore obsolete complete-block assertions. |
| Browser codec/restoration tests | **Preserve with bounded claims:** element-level canonical/self-consistency and recoverable failures. Full cross-engine equivalence still needs independent CRengine vectors, not server XPath validation. |

## Remaining scope and minimal follow-up

- **F6 open, Low/conditional:** resource caps and numeric coercion still differ from reference permissiveness. Document caps and accepted numeric types as deliberate limits; do not call them upstream JSON-schema requirements. Numeric fractions from normal KOReader fit. A legitimately long opaque position may still fail. No minimum fix to F1–F5 remains outstanding.
- **F7 open, scope gap:** additional server health/password/delete routes remain unsupported. Declare four-method classic scope; do not interpret generic 404 as a reference deletion confirmation. Implement only in a separately authorized parity expansion, with upstream-derived tests.
- **Client codec qualification unestablished:** matching wire and partial hash does not certify cross-renderer navigation. Keep element-level claims and original opaque strings.

**Ideal:** explicit compatibility claim for a pinned upstream surface, external goldens and separate client-engine qualification; choose/document any further reference-parity expansion. **Pragmatic, currently accepted:** audited classic F1–F5 repairs plus declared F6/F7 limitations and bounded client qualification. This is a path to fuller parity, not a claim that all upstream routes/edge cases are implemented. No new features were requested or applied.

Knowledge capture: keep the external-oracle/legacy-versus-web boundary in API-owner guidance; the corrected short-read convention is already reflected in current reader evaluation wording. Other-owner guidance was not edited.

- **Assumptions made:** closure targets audited classic KOSync paths, not all permissive reference inputs/new endpoints or full CRengine equivalence.
- **Decisions made autonomously:** retained original failing evidence; wrote separately named current results; used current response bodies in the real pinned client callback and negative controls.
- **Compromises:** no live upstream/physical-reader/browser-persistence rerun or broad suite; isolated doubles/function execution and focused root tests bound the claims. No production edits or commits.

[S1]: https://github.com/koreader/koreader-sync-server/blob/46ef6b84a3930b3f0265efac74899f2256c158f1/README.md
[S2]: https://github.com/koreader/koreader-sync-server/blob/46ef6b84a3930b3f0265efac74899f2256c158f1/config/routes.lua
[S3]: https://github.com/koreader/koreader-sync-server/blob/46ef6b84a3930b3f0265efac74899f2256c158f1/app/controllers/1/syncs_controller.lua
[S4]: https://github.com/koreader/koreader-sync-server/blob/46ef6b84a3930b3f0265efac74899f2256c158f1/config/errors.lua
[S5]: https://github.com/koreader/koreader-sync-server/blob/46ef6b84a3930b3f0265efac74899f2256c158f1/spec/controllers/1/syncs_controller_spec.lua
[K1]: https://github.com/koreader/koreader/blob/4e973dacb07b592d9a32af505a1c20c6e84f7fd6/plugins/kosync.koplugin/api.json
[K2]: https://github.com/koreader/koreader/blob/4e973dacb07b592d9a32af505a1c20c6e84f7fd6/plugins/kosync.koplugin/KOSyncClient.lua
[K3]: https://github.com/koreader/koreader/blob/4e973dacb07b592d9a32af505a1c20c6e84f7fd6/plugins/kosync.koplugin/main.lua
[K4]: https://github.com/koreader/koreader/blob/4e973dacb07b592d9a32af505a1c20c6e84f7fd6/frontend/util.lua
[B1]: https://github.com/koreader/koreader-base/blob/f64c3eb11049e9a75189f186d7345d97c07d87b9/thirdparty/lua-Spore/CMakeLists.txt
[B2]: https://github.com/koreader/koreader-base/blob/f64c3eb11049e9a75189f186d7345d97c07d87b9/thirdparty/lua-Spore/detect-more-json-content-types.patch
