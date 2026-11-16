# M2 — Legacy worker retirement/reset contract

**Recommend replacement at the existing root `/sw.js` identity, with one-time allowlisted legacy cleanup.** This defines subsequent implementation and acceptance tests; it is not an implemented worker, runtime proof, deployment approval or M2 exit declaration.

## Authority and current evidence

- [Migration authority](../frontend-migration.md#state-ownership-and-invariants): preserve server data/external protocols. Existing user approval permits discarding legacy browser books, preferences and pending events, not new-app durable events.
- [Milestone boundary](../frontend-migration.md#milestones-and-exit-gates): M2 defines retirement; M3 implements actual cutover/cold recovery; M5 qualifies upgrades, failures and physical installed devices.
- **S1 — worker:** [`assets/sw.js:1–95,102–172,175–265`](../../assets/sw.js): version `1`, cache `OFFLINE_V1`, stale-shell routes, global cache lookup/purge, legacy messages and precache. No activate/claim/skip-waiting protocol; purge does not await individual deletions.
- **S2 — bootstrap/replay:** [`assets/common.js:15–63,69–120`](../../assets/common.js) registers `/sw.js`, default scope `/`; installed does not mean controlling, messages lack timeouts. [`assets/index.js:1–86`](../../assets/index.js) replays/deletes legacy progress/activity on load/reconnect.
- **S3 — persistence:** [`assets/lib/idb-keyval.min.js:1`](../../assets/lib/idb-keyval.min.js) defines default DB/store `keyval-store`/`keyval`, used by common.js. [`assets/local/index.js:25–53,73–81,125–139,237–261`](../../assets/local/index.js) owns local bytes/metadata.
- **S4 — reader:** [`assets/reader/index.js:9–38,849–873,892–951,1332–1344`](../../assets/reader/index.js) reads/writes legacy records, sends directly to KO endpoints and stores `readerSettings`.
- **S5 — identity/serving:** [`assets/manifest.json:1–17`](../../assets/manifest.json) has no explicit `id`, with `/` start URL/scope. [`api/api.go:133–145`](../../api/api.go), [`api/app-routes.go:84–102`](../../api/app-routes.go) serve worker, manifest, `/local`, `/reader`; the worker handler adds no explicit update-cache policy.
- [Reader/storage limits](m2-reader-storage.md#explicit-limits--not-solved) recommend retirement but implement none. [Latest HTTP proof](m2-integration.md#executed-named-contracts) establishes fixture receipt/retry composition, not SW cutover; it supersedes older “HTTP pending” statements only in that scope.
- [Retained isolation falsification](m2-reader-isolation.md#historical-alternatives-and-current-disposition) rejects the evaluated opaque nested topology; the user selected single-origin hardened EPUB.js, with [representative proof accepted](m2-reader-storage.md#independent-closure). No extra hostname is required. [Design proof](m2-design.md#mock-limits-and-decisions) is in-memory UI, not installation/storage evidence.

## Recommendation and ownership

**Ideal/recommended:** one managed replacement worker, fresh bootstrap/control repository and explicit client/version coordination.
**Pragmatic alternative:** a bounded tombstone at the same URL, then the managed worker; this converges on the ideal but adds handoff/offline-gap risk. Choose it only if subsequent evidence demonstrates simplification. Neither is proved here.

| Owner | Contract |
| --- | --- |
| Go/deployment | Stable worker endpoint, complete matching shell, retained hashed assets for supported dormant clients/rollback. |
| Replacement worker | Shell caches, controller handshake, legacy-client quarantine/navigation, exact legacy-cache deletion; no outbox ownership. |
| Fresh bootstrap/control repository | Serializes reset, verifies controller/shell, retires clients, removes legacy IDB/localStorage, commits completion before reader/replay starts. |
| New repository/sync | Owns new books/checkpoints/events; deletes events only on validated acknowledgement or explicit user resolution. Reset cannot enumerate/delete its records. |

### Fresh namespace and one-time marker

These are **proposed identifiers**, not existing production names:
- Control IDB `antholume-app-control-v1`, store `meta`, key `retirement/legacy-v1`; shell caches `antholume-shell-<build-id>`.
- Marker fields: epoch, phase, owner/fencing generation, lease deadline, verified shell/worker build. Origin-wide, not account/tab-local; never stored in disposable legacy storage.
- Phases: `pending` → `retiring` → `cleaning` → `done`. Completion is terminal for `legacy-v1`, independent of login, build changes, reload, rollback and future schema upgrades.
- Transactional compare-and-set/lease fencing selects one coordinator across tabs. Stale owners cannot advance phases; worker reset commands validate the fence. Recover expired ownership; never hold IDB transactions across cache/network operations.
- Missing/corrupt/evicted marker permits recovery or **only the same fixed legacy allowlist**, never a new-schema reset. “Schema changed” and “queue exists” are not reset conditions.

## Exact cleanup boundary

| Storage | Allowed legacy target from S1–S4 | Required behavior |
| --- | --- | --- |
| Cache Storage | Exactly `OFFLINE_V1`: shell/assets, server book/cover bytes, reader progress responses. | Await `caches.delete("OFFLINE_V1")`; never invoke legacy `PURGE_SW_CACHE` or delete by broad prefix. |
| IndexedDB | DB `keyval-store`, store `keyval`: exact `ACTIVITY`; `FILE-<id>`, `FILE-METADATA-<id>`, `PROGRESS-<id>`, where `<id>` is 32 ASCII hex digits. | Transactionally delete matching keys only. Keep unknown keys/stores/DBs; do not create a missing legacy DB to clean it. Unexpected legacy shapes require review, not wider matching. |
| localStorage | Exactly `readerSettings`, including browser device/appearance preferences. | Page calls `removeItem("readerSettings")`; worker has no localStorage access. |

Use selective legacy-key removal, **not** `deleteDatabase("keyval-store")`: the generic DB name does not prove exclusive ownership of unknown contents.
No all-cache/IDB/localStorage clear, origin-wide `Clear-Site-Data`, or cookie/session clearing.

Preserve unrelated storage and every new-schema book/checkpoint/preference/event. Never reuse legacy names for new data.
Preserve proof namespaces too: `antholume-m2-reader-storage-v1`, `antholume-m2-reader-storage-v2` and `antholume-m2-http-integration-v1` ([storage](m2-reader-storage.md#independent-review-disposition), [HTTP](m2-integration.md#target-boundaries-and-ownership)).
Cleanup never deletes server files, credited activity, progress, KO/OPDS state or authentication.

Approved legacy loss includes local-only originals, pending activity/progress, preferences/device identity and downloaded server bytes.
Explain cutover loss and re-import visibly; this approval does **not** authorize discarding future new-app events, including on logout or rollback.

## Exact root identity and complete-shell prerequisite

1. Keep **same-origin `GET /sw.js`, scope `/`**; fresh registration uses `register("/sw.js", {scope: "/", updateViaCache: "none"})`.
   No `/assets/sw.js`, hashed registration URL, changed scope, unregister-only, 404 or redirect as retirement.
2. Serve JavaScript with correct MIME and `Cache-Control: no-cache`; no auth/SPA HTML or CDN stale substitution.
   Fresh online bootstrap/reconnect invokes `registration.update()`; a never-reconnecting browser cannot be updated remotely.
3. Install stages an isolated build cache and awaits verified complete shell/hashed-asset writes: correct status/type, no redirects, matching build.
   Failed install cannot activate, delete legacy data or mark completion; reclaim only its own partial staging cache.
4. Use named-cache lookup, not global `caches.match`. Shell fallback is same-origin, frontend-navigation-only.
   APIs, KO/OPDS, document binaries and missing assets retain real errors/content types, never shell HTML.
5. Keep replacement behavior at `/sw.js` for long-absent installations. Old cached common.js can re-register that URL, but cannot retrieve legacy worker bytes there.

## First-new-shell handshake and bounded reload

The message names, bootstrap query and limits below are recommended new contracts, not existing behavior.

1. Only initial **legacy** retirement may force `skipWaiting()` then `clients.claim()`, after complete staging.
   Existing new-app clients use the future-update policy; missing marker alone never authorizes interrupting them.
2. Inventory AnthoLume window clients, including uncontrolled clients, into a retirement roster; leave unrelated same-origin pages alone.
   Nonce-bound `APP_HELLO`/`APP_HELLO_ACK` exchanges identify app build, worker protocol, browser schema/event versions, reading state and epoch. Silence is unknown, not compatible.
3. Quarantine unverified/legacy controlled app clients: reject legacy purge commands, legacy shell/assets and browser mutation replay.
   Gate unsafe requests by verified client identity before forwarding; do not change server KO/OPDS protocols or block external KOReader clients. Pre-control/in-flight requests may already have committed; reset cannot undo them.
4. Navigate identified legacy clients once to **`/?antholume-retirement=legacy-v1`**, a reserved bootstrap variant of the existing root route.
   Serve only verified new shell there, without requiring API authentication; never cached `/local`/legacy root HTML. Preserve validated same-origin server-document destination separately; erased LOCAL books require re-import.
5. Fresh bootstrap installs listeners before registration and handshakes directly with `navigator.serviceWorker.controller` via MessageChannel.
   Validate controller/source, nonce/request ID, exact message shape, build/protocol and supported app/schema/event ranges. `ready`, `installed`, script URL equality or legacy numeric version `1` alone proves nothing.
6. Controller mismatch permits one explicit update/check and **one automatic self-reload per epoch/target build per tab**.
   Persist that guard in sessionStorage `antholume:retirement-reload:legacy-v1:<build-id>`; denial disables automatic self-reload. Worker persists each legacy client's navigation attempt; a bootstrap URL/missing reply never permits repeated navigation.
   Handshake timeout: 10 seconds. Show recovery/manual retry, not another reload. Do not await all client retirement inside a long-running activation event; persist coordination across worker restarts.
7. Cleanup starts only under compatible fresh control after legacy writers have actually navigated/closed, not merely received a message.
   Suspended/unreachable documents keep reset pending; resumed/history-restored legacy documents must be replaced or closed. If old-runtime retirement cannot be established, require closing old app tabs. Claim alone cannot prevent direct legacy IDB writes.
8. Await cache deletion, committed IDB-key removal and page localStorage removal; verify allowlist absence, then commit `done` under the current fence.
   Cross-store cleanup is not atomic: interrupted work resumes idempotently. Timeout/blocked/error/partial cleanup never counts as completion. Bootstrap must not load old common.js.
9. After `done`, enable first-cutover new reader/event writing/replay, send terminal `APP_READY`, and remove bootstrap query via `history.replaceState`.
   Already-existing new records survive pending reset. A compatible fresh-controlled page needs no extra reload; version handshake repeats on later controller changes without rerunning reset.

**Guarantee:** after successful replacement, verified reload/handshake and cleanup, that client no longer serves/replays legacy app state.
No promise covers a never-updated offline launch, unretired sleeping documents or reversal of already-credited legacy activity.

## Failures, later updates and rollback

- **Offline:** before update, old cached app may remain old; claim no reset/completion. A verified complete replacement may bootstrap offline; never force navigation into an unavailable shell. Reconnect retries the bounded check, not startup clears.
- **Waiting/races:** distinguish installing/waiting/active/controller. Stale waiting builds, redundant workers and late replies cannot bypass compatibility/completeness. New tabs join the same epoch/fence, not independent resets.
- **Blocked DB/storage:** open/upgrade `onblocked`, transaction abort, quota/security/localStorage/control-DB errors retain pending state with close-tabs/retry guidance. Selective cleanup avoids DB deletion; pre-existing blocked delete/upgrade requests still require safe settlement.
  Cleanup timeout: 30 seconds, never deletion success. Late completion must revalidate its fence; navigation failure/unresponsive clients remain visible pending recovery, not another automatic reload.
- **Future updates:** keep reset done; defer activation/claim/reload during reading across tabs. Offer update outside the session after durable checkpoint/event commits.
  Negotiate worker/app/browser-schema/event/server-API compatibility before writing/replay. Offline uses an already-qualified local tuple; server replay waits for successful authenticated capability negotiation.
- Queues need not fully upload before updating, but exact event bytes/IDs/accounts and readable schema survive. Unsupported tuples pause visibly; never clear/rebase outbox to make versions fit.
  Startup, foreground and reconnect drive replay; **Background Sync is optional**, never required for correctness.
- **Rollback before activation:** retain old working controller/cache and all data. **After activation/reset:** legacy deletion is irreversible; no browser-original/settings/event recovery promise.
  Retain compatible new shell/worker at `/sw.js`, marker and repository; prefer forward repair. Never restore legacy JS at that endpoint or clear new storage to downgrade.
- Permit server/app downgrade only when browser/event schemas, receipt ledger, shared revisions and protocols remain compatible; otherwise pause writes/replay with recovery guidance.
  Old binaries must not credit retries without receipts or write outside shared revision rules. Deployment rollback rehearsal remains unproved.

## Subsequent implementation test matrix — not executed here

Use public synthetic data on a disposable origin with the **actual legacy worker installed first**. Assert controller/build, client roster, marker, exact storage contents and server effects, not just successful fresh registration.
Preserve existing reader/API/HTTP tests; add these to the M3 implementation/deployment suite. No sixth prototype is requested.

| Case | Required assertion | Gate |
| --- | --- | --- |
| Root identity | Old registration updates at `/sw.js`/`/`; correct MIME/revalidation, no redirects/HTML; stale common.js cannot reinstall old bytes. | M3 |
| Dirty legacy launch | Seed S1–S4 data; stale first shell → verified bootstrap/controller → one completed allowlisted reset. | M3 |
| Preservation/idempotence | Unrelated cache/DB/store/key/localStorage, all proof DBs and new books/checkpoints/events survive reload, account switch, update and lost marker. | M3 |
| Tabs/suspended/history | Two old readers, uncontrolled/new/suspended/history-restored clients; one fenced coordinator, no old-writer resurrection; unresolved retirement blocks done; unrelated page untouched. | M3/M5 |
| Waiting/worker races | Waiting/slow/redundant/terminated workers and late/malformed replies cannot publish wrong build or readiness. | M3/M5 |
| Blocked/denied storage | Held connection/upgrade/delete, denied localStorage/control DB, transaction abort: bounded visible pending/retry, no false done/new-data loss. | M3/M5 |
| Offline/reconnect | Honest old offline launch; failed update nondestructive; verified replacement bootstrap offline; reconnect retires writers. Test cold full termination separately. | M3/M5 |
| Precache/partial reset | Missing/wrong-type/login-HTML asset, quota, interruption between stores/before marker: preserve working shell where possible; resume only allowlist, no premature ready. | M3/M5 |
| Reload bounds | Lost handshake, failed navigation, stale/incompatible controller, denied sessionStorage: bounded automatic attempts and actionable recovery, no loop. | M3 |
| Replay fence | No post-quarantine browser legacy replay; pre-control commit limitation explicit; real external KO/OPDS unchanged. | M3/M5 |
| New-app update | Defer while reading; persist checkpoint; negotiate tuple; exact queued IDs/payloads survive and acknowledge once; incompatibility blocks, never resets. | M3/M5 |
| Rollback | Before/after activation, retained assets, missing receipts/schema mismatch: new events/marker survive; unsafe replay blocked; legacy loss explicit. | M5 |
| Install/device | Existing install identity/home-screen launch, physical iOS/Safari and Android/Chromium cold offline restart; record OS/browser/install mode. | M3 implementation; M5 qualification |

## Manifest, origin and remaining scope

Preserve application origin, `/` worker/manifest scope and `/` start URL; retirement needs no route/name/origin migration beyond the bootstrap query.
Proposed explicit manifest `id: "/"` requires checking preservation of current inferred identity against existing installs before adoption; a new install identity is not a cache-reset tool.
Keep `/reader` server-book deep-link intent; erased local IDs require re-import, not fabricated migration.

The selected reader shares the application origin; the user accepts trusted-renderer bug blast radius. A dedicated reader origin is optional future hardening, not an unfinished M2 requirement. If ever selected separately, contract cookie isolation, host/TLS/CSP and offline ownership without relocating this root worker.
Installability/icon polish, complete deployment/caching/security qualification, cold installed restart, physical devices and rollback rehearsal remain M3/M5 work. This document supplies only the bounded M2 recommendation and test definitions.
