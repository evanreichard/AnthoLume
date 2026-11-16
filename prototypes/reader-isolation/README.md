# M2 reader isolation feasibility

**No-go for EPUB.js 0.3.93 in the preferred opaque-outer/passive-inner topology.** This is an executable falsification harness, not a working isolated reader or production implementation. [Decision, evidence and acceptance gates](../../docs/evaluation/m2-reader-isolation.md).

Chromium creates distinct opaque origins for descendants of an outer `sandbox="allow-scripts"`. EPUB.js cannot read its passive chapter iframe's `contentDocument`, throws, and never shows the chapter. The original-DOM KO codec does run inside the opaque trusted viewer. There is no flag-changing fallback.

## Reproduce

Node 22.12+; tested with Node 22.23.4 and Chromium 157.0.8103.38. From this directory:

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

Playwright owns the temporary static server on **127.0.0.1:5318**, refuses reuse, and stops it after testing. Development tests use the real React StrictMode double effect; production tests assert a single initial setup. Results/traces, logs and the rejected-control screenshot belong under `_scratch/m2/reader-isolation/`. No persistent preview, service worker, database or real API is used.

`npm run fixtures` regenerates four original synthetic EPUBs and copies public `_test_files/alice.epub`. The synthetic packages reuse the repository's public Lato WOFF2 asset from `assets/reader/fonts/`; they contain no private content. Already-generated fixtures are included; their deterministic SHA-256/size manifest is `public/fixtures/manifest.json`.

The trusted viewer is a bundled IIFE authorized by an exact CSP hash, not a cross-origin ES module workaround. `codec.ts` and `identity.ts` are read-only source imports from the reader/storage proof. Bundling/typechecking resolve their packages to **this proof's own node_modules**; the build rejects sibling dependency inputs. No sibling installation or dependency edits are required.

## Reading the tests

- Green tests establish the **failure**, not reader acceptance: original bytes/identity and parsed KO work, but preferred-topology rendition/DOM integration and internal navigation fail.
- Hostile scripts/events/SVG, images/CSS imports/fonts/background URLs and meta refresh produce no forbidden network attempts or application DOM/localStorage mutation in the named passive-frame tests. A positive request allowlist has explicit sentinels.
- The only bridge is source + origin + nonce + exact validated shapes. Parent sends original bytes or a KO string; viewer returns typed observations/codec results. There is no fetch/RPC/storage/sync privilege.
- A **test-only rejected `data:` control** permits outer `allow-same-origin`: actual EPUB styles, @media/rgb, font, SVG and rendered-DOM codec work, but stock internal links fail and deliberate self-navigation restores application origin. This is a confinement counterexample, not proof that book scripts executed. That control is absent from the application/controller code.
- Disposal removes the entire isolated realm, its passive descendants and the parent message listener. Tests instrument actual parent listener registration/removal, frame disappearance, stale messages and pending-byte-fetch cleanup. They do not prove heap reclamation.

Archive decompression hardening, complete EPUB compatibility, real KOReader and other browsers remain open. The 8 MiB message check occurs after allocation/transfer; it is **not** a preallocation, ZIP-bomb or cancellation bound. Expected engine exceptions remain visible.
