# M2 — Reader isolation feasibility

**Retained falsification artifact: NO-GO for the evaluated opaque outer iframe + passive EPUB.js chapter topology.** Actual Chromium disproves its DOM-access assumption. The user subsequently selected **single-origin hardened EPUB.js**, with no extra hostname and accepted trusted-renderer app-origin blast radius; its [representative reader proof is independently accepted](m2-reader-storage.md#independent-closure). This failed experiment is not a competing production design, an unfinished required stronger boundary or permission to enable scripted books.

Implementation: [`prototypes/reader-isolation`](../../prototypes/reader-isolation/README.md). Authority: [current migration design](../frontend-migration.md), [reader/storage proof and restrictions](m2-reader-storage.md), [reader isolation assessment](reader-offline.md#6-epub-content-security). Only the assigned prototype, this report and `_scratch/m2/reader-isolation/` were written. No private snapshot, git operations, root application/dependency changes or sibling edits were used.

## Architecture: current, target, delta

The production reader (`assets/reader/index.js:144–155,333–362`) enables scripted content in EPUB.js and appends a partial CSP. This is not a retained security contract. The then-current reader/storage proof disabled book scripts but rejected many benign features. Its subsequent selected-policy extension now supports representative CSS/fonts/SVG/internal navigation while preserving source bodies; see [current reader evidence](m2-reader-storage.md#independent-closure). The topology observations below remain historical falsification evidence, not current production requirements.

The target evaluated here is:

| Boundary | State owner and contract |
| --- | --- |
| React parent / `parent.tsx` | Credentials, application DOM and original byte acquisition remain outside the viewer. No storage/sync/API implementation is introduced. The harness only displays typed observations; it never interprets them as arbitrary commands or durable acknowledgements. |
| `controller.ts` | Owns exactly one `srcdoc` outer iframe with **only `allow-scripts`**, a random 128-bit session nonce and one message listener. Sends a copied/transferred original ArrayBuffer once, or a bounded KO string. Single-use open; idempotent disposal removes the whole realm immediately, without awaiting a hung renderer. |
| Trusted `viewer.ts` | Bundled EPUB.js, archive/DOM parsing, KO codec and rendering attempt. No parent DOM/storage access, external module import, privileged fetch or RPC bridge. Its engine request method rejects network use. |
| Passive chapter frames | EPUB.js creates `allow-same-origin` **without `allow-scripts`**. Parent sandbox restrictions are inherited; this nested token cannot undo the ancestor's sandbox-origin flag. Chapter CSP precedes book head content, with scripts/connect/object/forms/frames prohibited and data/blob styles/assets allowed. |
| `bridge.ts` | Parent accepts only exact boot/identity/codec/render shapes from its current `contentWindow`, origin `"null"`, matching nonce. Viewer requires exact parent source, exact parent origin, nonce and command shape. Opaque-target sends necessarily use `"*"`; receive validation is not relaxed. No fetch/navigation/storage commands exist. |
| Source reuse | Read-only imports of reader/storage `codec.ts` and `identity.ts` preserve its documented KO semantics and partial-MD5 algorithm. Build aliases/TypeScript paths bind dependencies to this proof's lock, not sibling node_modules. |

**Delta:** application privileges move outside the rendering realm, and all DOM/engine/codec work moves inside it. Same-origin parent DOM access and conservative feature rejection are not carried forward as a compatibility shim. This delta fails at the viewer→chapter boundary: neither trusted renderer nor codec can access the rendered passive document. The target was stated before implementation; the user authorized an honest bounded failure rather than an unsafe flag workaround.

## Exact browser blocker

Chromium **157.0.8103.38**, real desktop headless browser, not a mocked DOM:

| Outer document / sandbox | Nested frame | Outer can access nested DOM? |
| --- | --- | --- |
| `srcdoc`, `allow-scripts` | `srcdoc`, `allow-same-origin` | **No**: `contentDocument === null` |
| Same | initial `about:blank`, `allow-same-origin` | **No** |
| Same | initial blank + attempted `document.write` | **No**: null document |
| Same | `srcdoc`, no nested sandbox attribute | **No**: inherited restriction still applies |
| `data:`, `allow-scripts allow-same-origin` — rejected control | `srcdoc`, `allow-same-origin` | Yes; initially both share the inherited intrinsic opaque origin |

The real pinned engine reaches `epubjs/src/managers/views/iframe.js:434–439`: `onLoad` assigns `this.iframe.contentDocument`, then constructs `Contents(this.document, this.document.body, ...)`. The document is null; Chromium reports **`Cannot read properties of null (reading 'body')`**. Its display promise does not complete, the view remains hidden, and rendered-DOM hooks never run. The proof reports this exact condition without changing flags, swapping engines or pretending a timeout is successful rendering. Both original synthetic EPUB and public Alice reproduce it.

`self.origin` is `"null"`; trusted viewer access to parent DOM, localStorage and cookies throws. `window.frameElement` is null, so the child cannot remove the parent's sandbox attribute. A deliberate test-only self-navigation to a controlled same-origin HTML route still has origin `"null"`, cannot mutate parent DOM/storage, and leaves the parent's `allow-scripts` attribute intact. These are actual browser assertions, not inferences from attribute spelling.

### What worked, and what did not

- Original archived bytes are copied/transferred, never sanitized/repacked for display. The synthetic full MD5 matches the original fixture, and the parsed original chapter body serialization matches the viewer's body before engine URL replacement. CSP changes the head only; archive asset substitution is EPUB.js's ephemeral rendering operation, not a new book/hash/body-position format.
- Parsed-DOM KO→CFI conversion works **inside** the opaque viewer. `/body/DocFragment[1]/body/div[1]/p[1]` writes/reads the original `target` element. This is not rendered-location/restoration parity: the preferred topology never reaches the rendition content hook.
- Alice retains partial MD5 **`386d1cb51fe4a72e5c9fdad5e059bad9`**, full MD5 **`0f36c66155de34b281c4791654d0b1ce`**, and **1,402,237** original bytes; its parsed KO conversion succeeds, but its renderer fails at the same boundary.
- In the preferred topology the chapter parses, data stylesheet/SVG resources resolve and original content exists, but it is **hidden**, not a successfully rendered reader. Even automation activation of its hidden internal link does not reach chapter two. This is a failed compatibility gate, not permission to discard links.
- A **rejected test-only data-origin control** visibly renders the original EPUB with `rgb(12,34,56)`, a 3px `@media` border, a loaded packaged WOFF2 font, inline SVG and an 80px packaged SVG image. The codec also round-trips an element in its **actual rendered chapter DOM**. Screenshot: `_scratch/m2/reader-isolation/rejected-data-render.png`.
- That data control additionally produces `Error: No Section Found` for the ordinary internal link. No link-routing workaround was built: origin confinement already disqualifies this control.

### Why the data-origin control is rejected

Its outer `allow-same-origin` makes initial intrinsic `data:` opacity insufficient as a permanent invariant. A deliberate self-navigation to `/credential-target.html` changes the frame to the **application origin**; that controlled page successfully mutates the parent's synthetic DOM marker and localStorage credential sentinel. The preferred sandbox cannot do so.

This is an origin-restoration counterexample using privileged browser-test evaluation, **not a claim that EPUB scripts ran or that a book-to-parent exploit was found**. It nevertheless violates the explicit requirement that same-origin cannot accidentally be restored. The control exists only in browser tests; application/controller code never enables it. Initial page rendering is not enough to approve it.

## Named security/lifecycle evidence

| Contract | Actual assertion and limit |
| --- | --- |
| No book script execution | Original synthetic early-head inline/module scripts, image event handlers and SVG script/onload payloads cannot set `bookRan`, emit their marker message, mutate app DOM/localStorage or issue their attempted API/external fetches. Passive sandbox and early CSP are both present. This does not qualify every active EPUB construct. |
| No forbidden outbound attempts | Positive origin/path/**main-parent-frame** GET allowlist; any iframe network request or unknown HTTP(S) path/host is recorded before being aborted. Hostile image/CSS import/background/font URLs and same-origin API targets produce **zero** forbidden requests in the named tests. Passive meta refresh is blocked with a Chromium console diagnostic. Arbitrary-host and `/api/sentinel` deliberate probes prove watcher sensitivity. No real API is contacted. Controlled data/blob resources and parent harness/fixture loads are explicit exceptions. |
| No trusted-viewer impersonation | A browser-test bypass injects a correctly shaped, correct-nonce observation from the actual passive child; parent rejects its source. Current-viewer wrong nonce/extra fields/`fetch` command shapes reject; a valid codec result succeeds. Stale disposed-source messages reject after remount. Automation injection is explicitly not book execution. |
| Parent owns privileges | No viewer-origin API/storage/sync/fetch RPC surface exists. Accepted messages only update harness observations. Parent original-byte acquisition is controlled test-fixture loading, not a viewer-requested URL. Persistent storage and sync are deliberately absent, not modeled as viewer capabilities. |
| StrictMode disposal | Development Chromium asserts actual setup→cleanup→setup (2 created, 1 disposed, 1 live); production asserts one initial creation. Instrumented **real** parent message-listener registrations/removals return to zero on unmount. Three remount cycles remove all child frames; pending-byte-fetch completion and stale messages cannot publish after disposal. Double disposal is harmless; another open on one controller rejects. Realm destruction avoids waiting for the engine's hung display. No heap/GC or parser cancellation guarantee is claimed. |
| Trusted-code delivery | esbuild emits a self-contained IIFE; parent embeds it under an exact SHA-256 CSP hash. There is no opaque-origin module CORS exception, external script load, `unsafe-eval` or `unsafe-inline` script policy. The build rejects any sibling node_modules input in its metafile. |

No existing production or sibling tests were changed. **Disposition:** preserve their narrow contracts without claiming to rerun them; add three bridge unit tests and thirteen focused browser tests. Tests asserting known failure are executable falsification evidence, **not** a renamed successful acceptance gate. The rejected control and sentinel probes provide failure sensitivity without maintaining an unsafe fallback.

## Reproduction and executed results

From `prototypes/reader-isolation`:

```sh
npm ci
npm run fixtures
npm run typecheck
npm test
npm run build
CHROMIUM_PATH=/absolute/path/to/chromium npm run test:browser
M2_PRODUCTION=1 CHROMIUM_PATH=/absolute/path/to/chromium npm run test:browser
npm audit
npm audit --omit=dev
```

Executed on Linux x86_64 / kernel **6.18.60**, Node **22.23.4**, npm **10.9.9**, Chromium **157.0.8103.38**, Playwright **1.65.1**. **3/3 unit tests; 13/13 development browser tests; 13/13 production browser tests; typecheck/build pass.** Both npm audits report **zero known vulnerabilities**, not security certification. Browser native DOMParser is exercised; EPUB.js's Node XML path is not qualified.

Pinned runtime: EPUB.js **0.3.93**, JSZip **3.10.1**, React/DOM **19.3.1**, spark-md5 **3.0.2**. Tooling: esbuild **0.28.2**, TypeScript **5.9.3**; exact graph/integrity in the local lockfile. Override **@xmldom/xmldom 0.9.12** replaces the engine's old vulnerable resolution. Production viewer is **401,272 bytes**, parent **227,615 bytes**, uncompressed; no performance qualification.

Playwright builds and owns a temporary loopback static server on **5318**, refuses server reuse, and stops it on completion; a post-run socket check found no listener. No persistent preview, second host, service worker or backend was started. Parent is a development React build only for the StrictMode run; production graph is separately exercised.

Scratch evidence: `validation.log`, `development-browser.log`, `production-browser.log`, separate development/production browser JSON reports, full/production audit JSON, screenshot and browser attachments under `_scratch/m2/reader-isolation/`. Earlier diagnostic logs contain superseded failed test expectations and are not final acceptance evidence. `public/fixtures/manifest.json` records deterministic fixture SHA-256/lengths; regeneration matched the initial manifest. All four synthetic EPUBs are original packages; their packaged Lato font is copied from the repository's public reader font asset. Alice is only the checked-in public fixture. No private content is involved.

## Historical alternatives and current disposition

The alternatives below were proposed under this experiment's stronger origin-exclusion objective, **not selected requirements**. The user resolved that tradeoff with single-origin hardened EPUB.js; no new topology round is required for M2. Dedicated-origin exclusion remains optional future hardening. The experiment considered:

1. **A genuinely dedicated credential-free reader origin**, trusted outer viewer with usable passive descendants, restrictive **response-level** policy, no application routes/credentials, original-byte transfer and the same small bridge. One Go binary could serve host-routed static viewer assets, but DNS/TLS/host routing, offline behavior and cookie scope are real deployment requirements. Different ports alone do not isolate cookies; domain cookies must not reach the viewer. This task neither assumes multiple hosts nor claims this alternative was tested.
2. **A different rendering/view adapter entirely inside one opaque document**, without origin-separated nested chapters. It must establish that untrusted EPUB DOM/CSS/SVG cannot execute scripts, reach bridge nonce/code, navigate outside the boundary or request external resources; retain the existing position tree; and re-prove rendered DOM/CFI/lifecycle compatibility. A custom view or another engine may be needed. This is a substantive engine boundary change, not a small EPUB.js setting.

**Current disposition:** retain this small falsification harness without promoting its viewer or rejected data-origin control. The selected single-origin proof is a deliberate user-approved risk tradeoff, not an unsafe fallback to make this experiment green. No script-enabled book, privileged fetch bridge or competing production frontend is authorized. Human full interaction/M2 exit remain open.

Experiment outcomes and later qualification:

- **FALSIFIED:** usable opaque-outer/passive-inner EPUB.js rendering; no need to repair this unselected topology.
- **FALSIFIED:** permanent opacity for the data-origin workaround; it remains test-only, never an implicit fallback.
- **M3–M5:** broader corpus, active-content/resource/navigation policy qualification, source/version pin drift tests and genuine KOReader round trips for the selected single-origin policy. Representative compatibility/security proof is already [accepted](m2-reader-storage.md#independent-closure), not pending another stronger-boundary experiment.
- **PENDING:** archive decompression/path/duplicate/CRC/bomb/cancellation/large-media hardening. The bridge's 8 MiB ArrayBuffer check occurs **after** parent fetch buffering, copying and transfer; it is not a preallocation bound. JSZip expanded-entry allocation is not bounded by this check. No expanded-byte/count budget or hard parse watchdog is claimed.
- **PENDING:** physical iOS/Android, Safari/Firefox, offline cold launch/SW lifecycle, production Go/CSP deployment, accessibility, performance, RTL/fixed layout and complete reader/storage/API integration. Desktop Chromium is the only qualified experimental platform here.

Knowledge capture: add the **ancestor sandbox-origin restriction / distinct opaque descendant origins** pitfall and the need for a real origin-matrix probe to the **architecture-review skill**, before recommending nested opaque-frame EPUB.js designs. If an alternative is selected, capture its origin/cookie/deployment invariants in that reader package's `AGENTS.md`, not global application guidance.

### Task-end report

- **Assumptions made:** Chromium is sufficient to falsify this topology, not to qualify all platforms; only public Alice and original synthetic packages are in scope.
- **Decisions made autonomously:** stop at the demonstrated renderer boundary; retain a test-only rejected data-origin control, bundle trusted code with a CSP hash, reuse codec/hash source read-only, and dispose entire realms instead of patching engine cleanup.
- **Compromises:** no working isolated reader or dedicated-origin deployment is delivered because the preferred engine topology fails; broad compatibility, archive hardening and end-to-end persistence/API qualification remain explicit gates rather than a giant unreviewed workaround.
