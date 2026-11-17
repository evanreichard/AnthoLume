# M3 — Implementation boundaries and contracts

Status: **M3 code checkpoint; milestone exit open**, authorized by “Looks good. Proceed.” Revised compact Folio and the real vertical slice are approved; M2 confirmation/exit are complete, not phone/PWA or production approval. Authority: [migration design](../frontend-migration.md), approved user preferences, then this bounded handoff. Historical proof reports remain evidence, not competing specifications.

**Selected ideal:** one root-mounted React application with complete parity and disk-backed streaming/lazy large-book reading, not a temporary whole-book size cap. **Pragmatic delivery boundary only:** temporary `/app/` with explicit links to surviving SSR capabilities; root SPA/SSR retirement remains M6. This does not authorize an eager-reader fallback, permanent second frontend or mock production behavior.

## Ownership and current-to-target boundary

| Owner | Exclusive writes | Responsibility / dependencies |
| --- | --- | --- |
| Backend | `api/**`, `database/**`, new root `reading/**`, `go.mod`, `go.sum`; `server/**`, `config/**`, `main.go`, Makefiles, Dockerfiles, `.gitea/**`, root build-ignore rules and `flake.nix` only as necessary; sole exception inside web: generated `web/src/api/schema.gen.ts` | OpenAPI/auth/HTTP mapping → transport-independent reading operations → SQLite transactions. Go composition/packaging. Own report `docs/evaluation/m3-backend.md`. |
| Frontend | `web/**` **except** `web/src/reading/**` and `web/src/api/schema.gen.ts` | Folio application/routes, API adapter, package manifest/lock, build/test config, SW bundling plugin and application acceptance tests. Own report `docs/evaluation/m3-frontend.md`. |
| Reader | `web/src/reading/**` only; own report `docs/evaluation/m3-reader.md` | Hardened controller, React reader screen, all durable browser books/preferences/checkpoints/outbox/access/leases/conflicts and replay; worker source `web/src/reading/sw.ts`. Tests/fixtures stay inside this subtree. |

Coordinator owns this document, migration tracker and evaluation index. Owners request cross-boundary edits in their reports; they do not edit another owner's files, add agents, stage or commit. **User-staged `flake.lock` is untouched**, including regeneration/reformatting. Build outputs are artifacts, not authored source.

Pre-M3 extraction baseline: `api/api.go` composed SSR/KO/OPDS, assets and signed sessions; `api/auth.go` combines credential/session logic with redirects and caches roles/hash; `api/ko-routes.go` directly writes progress/activity. `database/query.sql` picks latest progress by second-resolution timestamp; devices have globally unique IDs. `database/manager.go` runs schema before Goose, then enables FK/WAL, with one open connection. `main.go` already embeds `templates/* assets/*`. These are extraction facts, not instructions to replace Gin/SQLite or rewrite history.

Target: HTTP adapters never call each other's handlers. New `reading` owns shared progress/state/activity/device rules using database transactions, with no generated HTTP DTO dependency; `database` owns SQL/schema. KO and web both call these operations. Direct queries remain appropriate elsewhere; no repository/service hierarchy around every read. Frontend query state is disposable; only reader persistence can save/acknowledge events.

## Authoritative web wire contract

Backend authors `api/openapi.yaml` (OpenAPI 3.0.3), strict generated Go boundary in `api/`, and generates `web/src/api/schema.gen.ts` (`components`, `paths`). This section fixes names/shapes; schema becomes their executable authority, not a second invented interface. Changed contracts require a coordinated report/update here, never handwritten generated edits. Binary TypeScript types map to Blob through the generator transform. No proof-only bootstrap/admin/upload-validation endpoint ships.

All paths below have prefix `/api/v1`; these web validation/auth/error rules do not redefine external KOSync. JSON objects are closed, all displayed fields required unless marked `?`; `T|null` is required nullable, arrays never null. IDs are opaque existing strings (1–128 characters), not converted to UUIDs/MD5s; new installation/event IDs use UUID strings. Timestamps are RFC3339 UTC in responses. `Revision` follows M2's canonical decimal grammar `^(0|[1-9][0-9]{0,17})$`; exhaustion fails without effects. Fractions are finite 0–1, never 0–100. Account ID is existing `users.id`.

```text
User = {id:string, is_admin:boolean, timezone:string}
Capabilities = {registration_enabled:boolean, search_enabled:boolean, demo_mode:boolean}
Session = {user:User|null, csrf_token:string, expires_at:string|null}
Document = {id:string, title:string|null, author:string|null, series:string|null,
  description:string|null, lang:string|null, file_available:boolean, cover_available:boolean,
  media_type:string|null, file_size_bytes:integer|null}
DocumentPage = {items:Document[], total:integer, page:integer, page_size:integer, next_page:integer|null}
ReadingState = {document_id:string, revision:Revision, position:string|null, fraction:number|null,
  device_id:string|null, updated_at:string|null}
Device = {id:string, name:string}
ProgressEvent = {event_id:string, document_id:string, device_id:string, observed_at:string,
  base_revision:Revision, position:string, fraction:number}
ActivityEvent = {event_id:string, document_id:string, device_id:string, start_time:string,
  duration:integer, start_fraction:number, end_fraction:number}
Receipt = {event_id:string, kind:"progress"|"activity", revision:Revision|null}
Problem = {type:string, title:string, status:integer, code:string, detail:string, current_revision?:Revision}
```

| Method/path · operationId | Request → success |
| --- | --- |
| `GET /session` · `getSession` | Public bootstrap → 200 Session; invalid/expired cookie returns anonymous Session, not HTML. Anonymous token is bound to an anonymous signed session. |
| `GET /capabilities` · `getCapabilities` | Public → 200 Capabilities. No fabricated permission lists. |
| `POST /session/login` · `login` | `{username:string,password:string}` → 200 Session; raw password over TLS, same trim + MD5→Argon2 verification as SSR. |
| `POST /session/register` · `register` | Same credentials → 201 Session; registration flag and atomic first-user-admin rule preserved. Disabled → 403; duplicate → 409. |
| `POST /session/logout` · `logout` | `{}` → 200 anonymous Session with rotated CSRF token; clears authentication, not retained browser books. |
| `GET /documents` · `listDocuments` | `page=1`, `page_size=24` (1–100), optional `q` (max 256) → 200 DocumentPage. Literal title/author substring, live shared library, stable ID ascending; matching count/items in one read transaction, no cross-page snapshot guarantee. |
| `GET /documents/{id}` · `getDocument` | → 200 Document; deleted/unknown → 404. Description is untrusted text, not executable HTML. |
| `GET /documents/{id}/cover` · `getDocumentCover` | → 200 actual image bytes/MIME, otherwise 404; no provider lookup/mutation on this new GET. Existing SSR metadata behavior remains available. |
| `GET /documents/{id}/file` · `downloadDocument` | → 200 original bytes/MIME/Content-Length/safe attachment filename; 206/416 Range and conditional 304 supported via file serving. Missing file → 404. Preserve configured DIRECT basepaths, never expose filesystem paths. |
| `POST /me/devices` · `registerDevice` | `{id:string,name:string}` → 200 Device; same owner idempotently updates name, another owner → 409 `device_conflict`. Never silently take ownership. |
| `GET /me/reading-state/{document_id}` · `getReadingState` | → 200 ReadingState, authoritative shared head; no saved position gives revision `"0"` and other state fields null. |
| `POST /me/reading-progress` · `submitProgress` | ProgressEvent → 200 Receipt (`kind=progress`, revision=base+1), or durable 409 `progress_conflict` with `current_revision`. |
| `POST /me/activity` · `submitActivity` | ActivityEvent → 200 Receipt (`kind=activity`, revision=null). Duration 0–86400, start≤end. Does not depend on successful progress CAS. |

Only session/capabilities/login/register are public; logout and all other operations require current authentication. Every unsafe operation, including login/register/logout, requires exact configured public Origin and `X-CSRF-Token`; token is random/session-bound, rotated on authentication changes, never a static fixture token. New config `PUBLIC_ORIGIN` is an exact HTTP(S) origin, not reflected Host/Origin; production HTTPS and Secure/HttpOnly/SameSite Strict cookies, explicit loopback HTTP development exception. Preserve existing cookie identity/credential hashes/KO headers/OPDS Basic auth; no forced account/password migration. Revalidate account existence, auth hash, expiry and current role from SQLite, not stale cookie/cache claims. SSR and JSON share credential/session operations, not redirects.

Handled errors use `application/problem+json`: 400 parse/schema/semantic, 401 auth, 403 CSRF/role/feature, 404 missing, 409 conflict, 413 byte limit, 415 media, 429 rate limit, 500 safe storage/internal, 503 busy/maintenance (Retry-After). Stable codes include `invalid_request`, `unauthenticated`, `csrf_failed`, `forbidden`, `not_found`, `device_conflict`, `idempotency_conflict`, `progress_conflict`, `storage_error`. No SQL/path/credential details. Protected metadata/binaries are private, no-store; worker never caches them implicitly. JSON request cap 8192 bytes before validator, duplicate/unknown/wrong-case keys reject; explicit ID/date/string bounds in schema, position max 4096, device name max 128, credentials max 256. Rate-limit credential attempts; no token/password logging. Validate all consumed JSON at runtime, especially exact receipt ID/kind/fields/revision; generated TS alone is insufficient. Strict Gin passes `Request.Context()`, never pooled Gin contexts, to operations.

## External KOSync authority

The published **upstream [KOReader sync-server contract](https://github.com/koreader/koreader-sync-server) is normative** for KOSync routes, authentication, payloads and errors. Existing AnthoLume handlers/tests are baseline compatibility evidence, not the specification or permission for arbitrary redesign. Audit against a recorded upstream schema/revision and report deviations; a pre-existing timestamp discrepancy must be evidenced, not frozen as normative or replaced by an invented field/type here.

KOSync stores and returns original progress strings **opaquely**. Path syntax/XPointer↔CFI/DOM mapping is separate **KOReader CRengine client interoperability**, not server protocol validation. Published KOSync does not gain web CAS revisions, UUID/event requirements, CSRF or `/api/v1` Problem envelopes. SyncNinja activity/document routes are preserved AnthoLume extensions, not official KOSync schema. Preserve valid server data, existing deployments and external interoperability while resolving evidenced deviations; OPDS remains separate.

## Reading transactions and compatibility

- Add `reading_heads` (account/document key, revision and full accepted state snapshot) and `reading_receipts` (account/event key across kinds, payload version/digest, immutable decision/receipt/problem). Keep receipts indefinitely in M3; no automatic TTL/pruning. Retain normalized payload/observation time for durable decisions, not just volatile HTTP state. Effect/head/receipt commit or roll back together.
- Receipt lookup precedes CAS and new-effect checks: same normalized payload/kind returns its original success/conflict, including after later writes/restart; changed payload/kind → idempotency conflict. Normalize UTC instants and signed zero, preserve opaque position. Auth/account checks still precede receipt access. No placeholder device/document creation for web events.
- Head is authoritative for both web state and KO GET. Seed each historical account/document once at revision `"0"` from latest legacy timestamp, tie-break `device_id ASC`; record this deterministic ambiguity policy, never rewrite legacy rows/positions/activity. Existing progress gives non-null state at revision 0. Accepted web/KO writes replace head and legacy per-device row atomically and increment revision. Neither fraction nor client clock wins ordering; backward moves are valid.
- Existing `/api/ko/syncs/progress` PUT and `/api/ko/syncs/progress/:document` GET are compatibility entry points, qualified against upstream rather than self-defined by their tests. Shared head participation is internal, not new wire fields or validation of opaque progress. Preserve legitimate registrations/placeholder behavior and account isolation without arbitrary auth/payload/error changes; report compatibility deviations for evidence-led resolution. SyncNinja activity/document extensions keep their wire behavior and shared persistence; legacy requests without event identity gain no invented deduplication guarantee.
- Conflicts are durable decisions. Fresh state retrieval + explicit local choice produces a **new** event ID at the observed revision; an intervening write conflicts again. Explicit server choice/supersession is a separate durable browser transaction/history, not an acknowledgement; retain activity independently. No silent rebase/highest-fraction/arrival-clock winner.
- Schema and Goose must agree on fresh and populated databases; schema executes first today. Additive migration tolerates known orphan metadata, external basepaths and old rows; no broad FK enforcement change, orphan purge, table rewrite or historical credit rewrite. Account/document deletion must remove related new state consistently without resurrecting history. Old binaries cannot safely write around heads/receipts: gate downgrade/writes rather than claim rollback compatibility.

## Public frontend ↔ reader seam

Only `web/src/reading/index.ts` exports the following surface. Generated schema names are those above; these declarations are the integration contract, not an invitation to export Dexie/controller internals. Frontend implements `ReadingBridge`; reader supplies provider/hooks/screen. No API import into persistence except generated **type-only** DTOs.

```ts
import type { ReactNode } from "react";
import type { components } from "../api/schema.gen";
type S = components["schemas"];
export type Account = { origin: string; userId: string };
export type BookRef = { kind: "local"; localId: string } |
  { kind: "server"; account: Account; documentId: string };
export type ReadingAccess = { kind: "loading" } | { kind: "anonymous" } |
  { kind: "authenticated"; account: Account } | { kind: "expired"; account: Account } |
  { kind: "logout"; account: Account };
export type Checkpoint = { position: string | null; fraction: number | null };
export type StoredBook = { ref: BookRef; title: string | null; author: string | null;
  cover: Blob | null; availability: "available" | "unavailable"; checkpoint: Checkpoint };
export type Conflict = { eventId: string; ref: BookRef; local: Checkpoint; server: S["ReadingState"] };
export type SyncStatus = "idle" | "pending" | "syncing" | "auth-required" | "retryable-error" |
  "conflict" | "quota-error" | "blocked";
export interface ReadingBridge {
  registerDevice(account: Account, device: S["Device"], signal: AbortSignal): Promise<S["Device"]>;
  getState(account: Account, documentId: string, signal: AbortSignal): Promise<S["ReadingState"]>;
  fetchFile(account: Account, documentId: string, signal: AbortSignal): Promise<Response>;
  fetchCover(account: Account, documentId: string, signal: AbortSignal): Promise<Response>;
  submitProgress(account: Account, event: S["ProgressEvent"], signal: AbortSignal): Promise<Delivery>;
  submitActivity(account: Account, event: S["ActivityEvent"], signal: AbortSignal): Promise<Delivery>;
}
export type Delivery = { status: number; body: unknown };
export declare class ReadingHTTPError extends Error {
  constructor(status: number, problem: S["Problem"]);
  readonly status: number; readonly problem: S["Problem"];
}
export interface ReadingSnapshot {
  ready: boolean; resumeAccount: Account | null; books: readonly StoredBook[];
  sync: SyncStatus; pendingCount: number; conflicts: readonly Conflict[];
  downloads: readonly { ref: BookRef; receivedBytes: number; totalBytes: number | null }[];
  update: "idle" | "available" | "blocked" | "error"; error: string | null;
}
export interface ReadingActions {
  importLocal(file: File, signal?: AbortSignal): Promise<BookRef>;
  download(document: S["Document"], signal?: AbortSignal): Promise<BookRef>;
  removeBook(ref: BookRef): Promise<void>;
  replay(): Promise<void>;
  applyUpdate(): Promise<void>;
  refreshConflict(eventId: string): Promise<Conflict>;
  resolveConflict(eventId: string, choice: "local" | "server", observedRevision: string): Promise<void>;
}
export declare function ReadingProvider(props: { access: ReadingAccess; bridge: ReadingBridge;
  onSessionExpired: (account: Account) => void; children: ReactNode }): ReactNode;
export declare function useReading(): ReadingSnapshot & ReadingActions;
export declare function ReaderScreen(props: { book: BookRef; onClose: () => void }): ReactNode;
```

- Account equality uses canonical origin plus exact user ID. Local IDs are independent of protocol hash; matching bytes/titles never merge/upload. `books` is the already access-filtered durable library projection; frontend combines it with authorized query results by **server identity only**, applies search/source/availability and computes visible counts. Reader owns stored metadata/covers; ephemeral query results/object URLs are not another persistence layer.
- Loading shows local books only, without clearing remembered expiry eligibility. `resumeAccount` supplies an eligible prior account after startup when HTTP is unavailable, never an explicitly logged-out account. Successful anonymous bootstrap after expiry maps to `expired` for that eligible account; first visit maps to anonymous. Explicit logout is persisted immediately, fences leases/hides server books even if offline logout HTTP fails; retry invalidation before later authenticated use. Switching A→B hides/fences A. Expiry retains A's offline access but pauses replay; reauth of the same account resumes. Tokens remain memory/session credentials, never reader IDB. Late A responses cannot expire B or acknowledge A after an epoch change.
- Bridge owns credentials/CSRF, current-account checks before/after each response and JSON read validation; account mismatch aborts, network failure throws, JSON read/registration HTTP failures throw ReadingHTTPError with validated Problem, and event HTTP failures return Delivery unchanged with untrusted body. Binary methods return streaming Response, including errors; reader checks status/MIME/budgets before reading. Device identity is generated/persisted by reader per origin/account/installation; registration precedes replay. Frontend does not implement a second queue, acknowledgement rule, browser schema or React Query mutation persistence.
- Books become available only after the complete disk-backed original is staged and validated, then its source/index/integrity references, metadata and checkpoint are atomically published. Cross-store staging is not an atomic whole-book RAM/IDB write: quota/abort/crash leaves no available partial book and cleanup preserves prior verified sources. A failed cover is optional; failed/partial EPUB is never available. Server ID stays authoritative, not recomputed from title/partial hash; retain a full-byte checksum for corruption detection separately from the KO partial-MD5 compatibility hash (include short reads at sampled offsets). A reading save commits checkpoint+immutable event before reporting saved; local-only saves never enqueue. `removeBook` removes stored bytes/offline availability, not unsent server events; local deletion removes its own local records. Replay uses expiring, epoch/fence-checked cross-tab leases and exact immutable snapshots/receipts. Durable conflict resolution/history and audit of explicit supersession belong here, not in UI or bridge.
- `ReaderScreen` owns compact themed controls and engine lifecycle, not application routing/auth. It opens local/stored server bytes without an API prerequisite; uncached server books use the same bounded download owner. Preserve full-viewport real EPUB pagination, taps/swipes/keyboard/TOC/themes/fonts, logical KO anchor through reflow/orientation, visible-word/activity heuristics and wake-lock cleanup. Initial forward-turn/WPM measurement stays unchanged; map its legacy `page/pages` and `(page+1)/pages` to start/end fractions and seconds to RFC3339 `start_time`, not rendition display percentages. No new idle/reread/TOC/close credit. Promote M2 hardened controller/policy/codec/lifecycle seams, not its fake page or unsafe old flags. Recoverable KO disagreement leaves saved strings/checkpoints intact; no automatic start fallback or historical position rewrite. Canonical child-axis source paths for **new client writes** have [bounded automated acceptance](m3-streaming-final.md#canonical-positions-and-separate-limitations); native CRengine interoperability remains open. No historical string rewrite or KOSync redesign.

## Large-book source and working-set invariants

- Selected ideal: persisted disk-backed original sources for imports/downloads; range-indexed ZIP access, incremental full-original integrity hashing and sequential incremental validation. No full-book ArrayBuffer, concatenation/copy, expanded-entry map, all-chapter DOM preload or full-source hash/inflate pass on every reader open. File/Blob range reads or durable chunk storage are implementation choices inside the reader owner, not another frontend store.
- Separate **compressed disk capacity** and cumulative validation/expanded capacity from **bounded active-entry, DOM, asset/decoded-image memory and stream-input chunks**. Per-entry/working-set ceilings do not cap total compressed book size; cumulative expanded-validation capacity is not retained RAM. Concrete measured budgets live in the [reader report](m3-reader.md), not duplicated constants here. Raising eager caps or rejecting large originals with a temporary 32 MiB whole-book cap does not satisfy this target.
- Index raw ZIP ranges/names/counts/duplicates/overlaps and declared bounds before inflation; enforce actual streamed output/CRC, incremental original and entry/chunk integrity, bounded metadata/CSS/media and terminable worker CPU deadlines. Validate the complete original before publication, then verify touched stored ranges/assets lazily without weakening corruption detection. Quota, cancellation and interrupted staging release resources and retain earlier verified books.
- Keep bounded active chapter DOMs/engine sections and asset leases; lazy visible assets must actually decode/render and release offscreen resources. Never claim readiness through missing images, lost logical anchors or bypassed policy. Early CSP/no-script chapters, inert source-tree/body preservation and validated archive/navigation policy remain mandatory. Native decoder/GPU/worker memory needs measurement; cache counters alone are not an RSS ceiling or qualification.

## Production build, dependencies and worker

Frontend is the **only** package.json/lock writer. Frontend-managed pins: React/DOM 19.3.1, TypeScript 5.9.3, Vite 8.3.8, plugin-react 6.3.0, react-router 8.5.1 (Data Mode), @tanstack/react-query 5.107.1, openapi-fetch 0.17.0; reader requires css-tree 3.2.1, Dexie 4.4.7, epubjs 0.3.93, JSZip 3.10.1 and spark-md5 3.0.2, with @xmldom/xmldom override 0.9.12. Tooling: openapi-typescript 7.13.0, Vitest 5.1.0, Playwright 1.65.1 and matching necessary type packages (css-tree types 3.2.0). Installed/locked **fflate 0.8.3** and **@noble/hashes 2.0.1** are frontend pins. Production uses native raw-DEFLATE with bounded streaming feeds and incremental noble SHA-256; target-browser decoder qualification is open. Use streaming APIs in terminable workers, not whole-archive unzip/digest buffering. Node 22.23.4 build/dev only. M2 proof results do not qualify the current full integration; current lock/install/build/audit evidence belongs in the frontend report, not a fabricated M2 runtime pass. CSS Modules/tokens/native controls; no UI/state/form framework needed initially. Custom small Vite SW plugin avoids adding Workbox/PWA frameworks. Further concrete dependency requests go through owner reports and are pinned/audited by frontend only.

- Source/range/lazy integration replaces eager JSZip whole-archive/entry-map assumptions; post-allocation size checks are insufficient. The source/validation workers enforce the large-book invariants above; renderer DOM access remains lazy and policy-checked. Package availability is not reader acceptance.
- Frontend `npm --prefix web run build` emits ignored `assets/app/index.html`, hashed `assets/app/assets/*`, `assets/app/sw.js`, `assets/app/manifest.json`. Router basename `/app`; asset base `/assets/app/`. Backend owns `.gitignore` entry `assets/app/`, invokes build before Go embed in Make/CI/both containers; Node stays in build stages only. Missing compiled shell fails release build, not a blank successful deploy.
- Go keeps embedding existing assets tree. Serve `/app/` and known `/app/*` navigation with shell, `/assets/app/assets/*` immutable hashed files, `/sw.js` from compiled worker (JS/no-cache), `/manifest.json` from compiled manifest (revalidate). Missing assets/API/KO/OPDS never fall through to HTML. Shell no-cache. Plain SSR `/` and unported routes remain; reserved `/?antholume-retirement=legacy-v1` serves new bootstrap shell without auth. Explicit links expose Insights `/`, history `/activity` and `/progress`, settings `/settings`, metadata/edit/delete/upload `/documents`, enabled acquisition `/search`, and authorized admin `/admin` rather than fake dashboards/actions. M4 owns their React parity, M6 owns root cutover/SSR removal.
- Frontend dev binds loopback, proxies `/api`, `/sw.js`, `/manifest.json` and legacy SSR destinations to Go without changing Origin to bypass checks; configure PUBLIC_ORIGIN to dev origin and use browser same-origin credentials. Keep listeners/test ports owned and isolated.
- Backend pins root `go 1.26.11`, CI and both Go container builders to 1.26.11; qualify compatible M2 graph (Gin 1.12.0, runtime 1.8.0, middleware 1.2.1, kin-openapi 0.152.0, x/net 0.62.0, x/crypto 0.59.0) rather than blindly copy nested modules. Generator 2.8.2 and SQLC 1.29.0 are pinned tooling. Existing SHA-verified SDK `_scratch/m2/api-contract/toolchains/go/bin` can run with command-scoped PATH and `GOTOOLCHAIN=local`; no global environment change. Nix declaration may need adjustment, **never flake.lock**. Root tests/race/vet/build/mod-verify and refreshed vulnerability finding parsing qualify the actual graph, not prior nested scans.
- Reader `sw.ts` consumes build-injected `self.__ANTHOLUME_PRECACHE__: {url:string,sha256:string}[]` and `self.__ANTHOLUME_BUILD__: string`; frontend plugin bundles it separately, injects complete shell/lazy-reader chunk hashes and emits manifest (no self-hash cycle). ReadingProvider alone registers `/sw.js` with scope `/`, `updateViaCache:none`, owns client handshakes and exposes update status/applyUpdate; frontend renders the update prompt, never a second registration coordinator. Preserve manifest start_url `/`, scope `/`, inferred identity (do not add/change id in M3). Offline installed `/` launch may serve verified app shell; online `/` remains SSR until M6.
- [Worker retirement contract](service-worker-contract.md) governs exact allowlisted cleanup, control-IDB fenced marker and nonce/build/schema handshake, bounded reload/recovery and no new-data deletion. Quarantine identified stale legacy clients during one-time retirement, not every fresh SSR visit forever; retained M4 SSR workflows must work online. SW owns shell/control state only, never book/outbox writes or background replay. Named caches, no authenticated API caching, failed precache cannot activate/reset; updates wait during reading and after durable saves, no unconditional skipWaiting/reload. Preserve unrelated/new storage and pending events across update/restart.

## Automated M3 acceptance (required evidence, not claimed results)

| Owner | Passing contracts required |
| --- | --- |
| Backend | Schema/Go/TS deterministic drift and request/response negatives; production login/register/logout/CSRF/origin/current-role/expiry/revocation tests; owned-device collisions; list/detail/cover/full-file/range/errors; fresh and populated migration with historical rows/orphans/basepaths unchanged and repeat-open idempotence. Real server shutdown/reopen retains receipts/heads; lost post-commit response, effect/receipt failure rollback, concurrent CAS, cross-kind ID collision, exact retry and activity credit once. |
| Backend | **Actual KOSync HTTP**, no private shim: pin upstream contract evidence and test routes/auth/payloads/errors against it, not just existing handler expectations. Preserve opaque progress exactly across PUT/GET and internal web-head participation; stale web CAS conflicts and a new accepted backward choice is readable externally. Audit missing/empty state and timestamps before asserting normative fields/types. Qualify SyncNinja registrations/activity/documents separately, plus owner isolation/rollback and OPDS regressions. Real wire tests do not establish CRengine path mapping or physical-client qualification. |
| Reader | Promote codec/body/CSS/font/SVG/NAV/NCX/security/lifecycle/lease/receipt tests and real paginated gestures/reflow/themes/activity. Qualify disk-source/range/incremental hash+CRC, bounded lazy DOM/native assets, malicious archive/CPU/quota/cancel/corruption recovery and no full-book buffers. Actual large originals require complete workflow, visible-anchor/image and repeated cold-open qualification plus worker/native memory measurements; a cap bump, bounded counters or import success is insufficient. Local-only reading sends zero events. Two-tab/account/startup ordering, late 401/ack and explicit conflicts survive restart; faulted saves never report success. |
| Frontend + reader | Production Go-served build, no mock transport: download → verify complete availability → stop browser → launch **new browser process/context using same persistent profile**, network disabled from startup → shell/deep link/book render → page-turn and durable activity/progress → restart offline again → reconnect and replay exactly once. No retained JS realm or merely loaded-shell test; local import works with no account. Record browser/version/profile restart mechanics. |
| Frontend | Real login/expiry/reauth A→B→A and explicit offline logout; A metadata/counts/covers/source filters hidden from B/logout, local books remain; expiry permits stored A reading but no replay. Malformed HTTP 200 receipts and HTTP 500 valid-looking receipts retain events. Conflicting KO progress allows explicit backward/server choice; another KO advance invalidates choice, activity still credits once. |
| Frontend + reader | Seed real old root worker/cache/legacy keys plus unrelated/new outbox; update actual `/sw.js`; verify complete cold shell, exact cleanup, bounded client/reload handshake, blocked storage/failure retry, failed precache preservation and update deferred while reading. Fresh SSR links still work. Production embed/deep links/hash cache/MIME/CSP/binary integrity and no SPA API fallback. |

Preserve continuing root DB/statistics/credentials/upload/OPDS contracts; KOSync tests must be judged against upstream, with deliberate dispositions for pre-existing deviations rather than treating baseline handlers as normative. Adapt tests for moved ownership and replace proof fake/composition assumptions with real production assertions. Owners report preserve/adapt/replace/remove/investigate when touching multiple tests; do not delete SSR tests before M6. Synthetic public fixtures are CI inputs, private archive is optional isolated qualification. Physical iOS/Android installed-PWA, broad corpus/platform/performance/a11y, full M4 workflows and M5 upgrade/rollback remain pending; automated M3 is not device/production approval.

## Delegated decisions and limits

Delegated implementation choices: exact web paths/DTOs/provider seam, internal historical tie seeding, retained receipts, package single writer, SW build seam and temporary mount/SSR links. Streaming/lazy large-book architecture and upstream KOSync authority are **user decisions**, not autonomous compromises. Bounded results below do not waive original contracts, expand native compatibility claims, or close the milestone.

## Current checkpoint evidence

| Subset | Result |
| --- | --- |
| Root backend | [79 tests plus 52 subtests, race, vet, module verification and zero vulnerability findings; deterministic Go/TS generation and 21/21 mutations plus drift](m3-backend-final.md). |
| External KOSync | [Classic F1–F5 and explicit header precedence/account aliases pass upstream recheck](kosync-compatibility.md); F6 limits/coercion and F7 additional routes remain declared gaps. KO partial-MD5 includes short reads; server IDs and historical position/activity rows are unchanged. `/api/v1` is the separate new web API. |
| Actual Go↔React | [34/34 browser, 40/40 unit, typechecked production build](m3-integration-check.md); startup/access, real HTTP/replay, cold restart and worker recovery pass in this scope. |
| Streaming | [Public S1/S2 and worker allocation checks](m3-streaming-final.md); bounded [A](m3-large-book-A-check.md), [B](m3-large-book-B-check.md), [C](m3-large-book-C-check.md), [D](m3-large-book-D-check.md) workflows pass, with D’s earlier warm and current cold evidence kept distinct. The [earlier workflow report](m3-large-books.md) is historical. |
| Full reader / production SW | [Reader 70/71: public `large-media` open remains unresolved; SW 6/6, including both cold-process scenarios](m3-reader-final-check.md). |

Manual M3 exit remains open: verify download → disconnect → terminate/reopen → read → reconnect/synchronize without lost or duplicate credit, anonymous local reading, expiry recovery without queue loss, and native KOReader position interoperability. Secure remote human review needs separately provisioned trusted HTTPS; Headscale cannot provision it automatically. Physical iOS/iPadOS and Android installed-PWA, target Safari/Firefox raw-DEFLATE, broad benign corpus/security/accessibility, repeated image-bearing native/renderer memory plateaus, remaining M4 parity and M5 upgrade/rollback are not qualified by this checkpoint.
