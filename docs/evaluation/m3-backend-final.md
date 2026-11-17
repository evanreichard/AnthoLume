# M3 backend — bounded final regression

**Generation and fault-tooling closure PASS: Go/TypeScript outputs are byte-identical to the current OpenAPI; all 21 behavioral mutations plus generation drift are detected. The SVG policy mutation also fails actual Chromium isolation. No application, generated artifact, dependency, lock or test assertion was changed.**

Executed 2026-11-17 against the current working root. This follow-up closes only the two tooling gaps below; it does not repeat the root suite, race, vet, module verification or vulnerability audit. Current upstream-derived KOSync goldens remain authoritative, including accepted-write device snapshots, account-scoped aliases, explicit-header precedence, numeric persisted timestamps and normative external errors.

Evidence: `_scratch/m3/backend-tooling-final/`; preceding root-gate evidence remains `_scratch/m3/backend-final/`.

## Gate results and provenance

| Gate | Result |
| --- | --- |
| Previous root `go test -mod=readonly -count=1 -timeout=180s -json ./...` | **PASS:** 79 top-level tests + 52 subtests; one opt-in browser skip. Not rerun. |
| Previous root race run | **PASS:** same counts, no reported race. Not rerun. |
| Previous root vet / `go mod verify` | **PASS / PASS.** Not rerun. |
| Previous govulncheck v1.9.0 | **PASS:** zero finding records; vulnerability database timestamp `2026-11-11T02:51:11Z`. Not rerun or represented as a fresh security scan. |
| Current generation check | **PASS:** two complete generation passes identical; both current Go/TS artifacts match exactly. |
| Current disposable-source fault helper baseline | **PASS:** API/database/server baseline, with cover-browser opt-in enabled. This is the helper's bounded baseline, not another whole-root suite. |
| Current fault mutations | **PASS:** 21/21 intended behavioral failures; no build failures counted. |
| Current generation mutation | **PASS:** added schema field reports drift in both Go and TypeScript. |
| Explicit pinned Chromium cover check | **PASS baseline; mutant detected:** Chromium 157.0.8103.38, 18 healthy real-HTTP checks, then the existing policy mutant fails actual-browser isolation. |

The preceding qualifier's generation failure was caused by `GOPROXY=off` during the pinned generator's module-deprecation lookup, not by source drift. This run uses cached Go **1.26.11**, `GOTOOLCHAIN=local`, `GOWORK=off`, `GOFLAGS=-mod=readonly`, `GOPROXY=https://proxy.golang.org,direct` and standard `GOSUMDB=sum.golang.org`. Existing web dependencies are reused; no npm install or root module update occurred. The Go generator remains pinned at **oapi-codegen v2.8.2**.

## Generation equality

Executed scratch-relocated `api/check-generation.py` against the working root. It generates into disposable scratch outputs twice and compares bytes; it does not run `api/generate.sh` over root artifacts. The whole current schema is used without operation filtering: all **13 operations** are included (`getSession`, `getCapabilities`, `login`, `register`, `logout`, `listDocuments`, `getDocument`, `getDocumentCover`, `downloadDocument`, `registerDevice`, `getReadingState`, `submitProgress`, `submitActivity`).

`generation.log` reports:

```text
Go and TypeScript: two passes identical; checked-in outputs match
```

Current unchanged SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `api/openapi.yaml` | `4d5bfe3274c2391c7bd7251b401277f20ddba8bf585acafc37a52f85ff7b1613` |
| `api/contract.gen.go` | `cf638f492c466d033677aa110aed0d356c4570d5e239b3557183db5a6e60a929` |
| `web/src/api/schema.gen.ts` | `f04fa8f5166130ebc4eecc74c8ce18f668963dfb17113baa27529fc2f21f93c3` |

The helper's disposable schema mutation adds `mutation_probe` beside `demo_mode`. `faults/generation-drift.log` reports exactly:

```text
generated artifact drift: api/contract.gen.go
generated artifact drift: web/src/api/schema.gen.ts
```

## Fault-tool change and disposition

Only one tuple in `api/fault-check.py` changed: `ko-fraction` now replaces `"percentage": progress.Fraction` with `"percentage": 0.99` in the current `api/ko-routes.go` response serializer, and selects `TestKOSyncTimestampUsesPersistedAcceptedHead`.

| Subject | Disposition | Contract and reason |
| --- | --- | --- |
| Retired `ko-fraction` mutator anchor and selection | **Replace seam / adapt selection** | The old seven-argument `advance(..., f, nil)` anchor no longer exists after accepted-write snapshots. The replacement corrupts the same externally visible accepted KO fraction at the actual serializer, preserving its pointer/snapshot behavior and upstream wire contract. It is now a serialization fault, not a persisted-state fault. |
| Selected upstream normative test | **Preserve** | Its existing pinned-upstream sequence writes `.32`, then `.22`, including backward progress, and checks GET percentage against each accepted write. No expectation, setup or assertion changed. |
| Other 20 behavioral mutants and their tests | **Preserve** | Anchors, effects and selections unchanged. Normative external errors and current device/timestamp semantics are retained. |
| Existing generation drift check | **Preserve** | Both generated artifacts must detect schema drift. |

The KO mutant **compiles, reaches real PUT/GET, and fails the percentage assertion at `kosync_timestamp_test.go:90`: expected `0.32`, actual `0.99`**. This is not a missing-anchor, compile, timeout or stale-error-expectation failure.

An initial scratch run rejected a mistyped normative test name after detecting the first 13 mutations; it returned no matching test failure and was not counted as detection. Correcting only the test selection produced the complete successful run. That attempt is retained under `attempt-1/`; `fault-summary.log` and `faults/` contain the final all-21 run.

## Exact mutation detections

Every entry below produced the named top-level `--- FAIL` with a nonzero test exit; the helper rejects success, missing intended failure, and build failure.

| Mutation | Detecting test |
| --- | --- |
| `cover-alias-policy` | `TestCoverServesRealSVGWithInertNavigationPolicy`; also `TestCoverBrowserIsolation` in actual Chromium |
| `opds-opaque-links` | `TestOPDSPublishedOpaqueLinksReachOriginalResources` |
| `registration-work-status` | `TestLegacyCredentialOverloadRetryAfter` |
| `legacy-retry-after` | `TestLegacyCredentialOverloadRetryAfter` |
| `zero-duration-statistics` | `TestZeroDurationActivityPreservesCreditAndStatistics` |
| `opaque-path-plus` | `TestOpaqueDocumentIDsSurvivePathEscaping` |
| `historical-owner` | `TestRealKOHTTPDeterministicHistoricalTie` |
| `auth-revocation` | `TestWebIdentityCSRFAndRevocation` |
| `statistics-head` | `TestStatisticsFollowSharedBackwardHeadWithoutRewritingCredit` |
| `legacy-auth-rate` | `TestSuccessfulLegacyHeaderAuthDoesNotThrottleSynchronization` |
| `ssr-progress-units` | `TestSSRReaderProgressUsesHeadAndPreservesDisplayUnits` |
| `cas` | `TestRealKOAndWebSharedHead` |
| `signed-zero` | `TestDurableReceiptsNormalizationAndConflicts` |
| `ko-fraction` | `TestKOSyncTimestampUsesPersistedAcceptedHead` |
| `receipt-kind` | `TestDurableReceiptsNormalizationAndConflicts` |
| `origin` | `TestWebIdentityCSRFAndRevocation` |
| `duplicate-json` | `TestWebJSONClosedValidationAndCancellation` |
| `historical-tie` | `TestReadingAdditiveMigrationPreservesHistoricalRowsAndOrphans` |
| `receipt-rollback` | `TestReadingAtomicRollbackAndConcurrentCAS` |
| `replay` | `TestDurableReceiptsNormalizationAndConflicts` |
| `worker-deadline` | `TestTaskContextStartsAtEachTickAndShutdownDrains` |

### Actual Chromium gate

The all-21 helper also detected the cover mutant in actual Chromium. A separate narrow positive/negative run explicitly pins `CHROMIUM_PATH` to `/nix/store/6d2xf2ayd9mbzqac5k0knbggk34zp0yw-chromium-157.0.8103.38/bin/chromium` and maps it to the existing launcher's `ANTHOLUME_CHROMIUM` variable. This is only the backend cover-security regression, not the browser application suite.

`browser-pinned/baseline.log` records Chromium **157.0.8103.38**, **18** real-HTTP top/image/embed checks, correct visible SVG/raster pixels, and **zero** session, external-resource or external-credential requests. Removing the legacy-alias cover policy then causes actual script execution with readable user/CSRF data; the existing browser assertions fail. The all-21 mutant log records two session requests, four external requests and two carrying credentials. No launcher or browser assertion was changed; temporary listeners are closed.

## Scope, preservation and remaining limits

No actual application bug was observed. No root full-suite/race, container, corpus, browser application suite, private backup, audit or upstream-server run was added. Generation and mutation closure removes the preceding qualifier's two tooling blockers; it does not establish full upstream parity or physical-reader compatibility.

Classic KOSync scope remains the four create/auth/PUT-progress/GET-progress routes. Existing **F1–F5**, header precedence, account aliases, accepted-write snapshots and numeric persisted timestamps retain the earlier passing root evidence. **F6 remains declared:** document/device/name and position caps plus numeric/coercion policy differ from reference permissiveness. **F7 remains unsupported:** reference healthcheck, password replacement and account deletion routes. No new endpoint scope or normative error relaxation was introduced.

The **entire raw Git index is byte-identical before/after**, SHA-256 `3ff928e292a77cbe550221018b33d6f070e093d0330b95353f28b18556e0e710`. The staged binary diff hash remains `d2367e1efbee6251a7d82760007ab4b39be68c789ad08c6ab146124895788cf0`; staged `flake.lock` blob remains `0e8326c3a7dea334f5b68f1b86f3adefd6cf7b82`. All tracked/unignored source-file hashes outside the two assigned non-scratch files are unchanged, including generated files and dependency locks. Final listener snapshot equals the starting snapshot: no task listener remains and no existing listener was stopped.

Evidence scripts: `run.py` relocates helper outputs only; `browser-pinned.py` narrows a disposable helper copy to the existing cover baseline/mutant. `results.json`, per-mutant logs, source hashes, raw-index snapshots, staged diffs and socket snapshots retain the measurements.

**Ideal and pragmatic coincide for this bounded task:** generation equality and the complete existing fault gate are now green; broader compatibility/security claims remain explicitly out of scope.

- **Assumptions made:** current upstream-derived root goldens define the external KO contract; existing root suite/race/audit evidence is inherited, not rerun.
- **Decisions made autonomously:** replace the retired internal KO anchor at the live external serializer; retain the rejected selection-typo attempt; explicitly rerun only the cover gate with pinned Chromium after the complete helper run.
- **Compromises:** the KO fraction mutant now corrupts serialization rather than persistence; it preserves the requested external fraction contract without relying on retired internals. Broader F6/F7 parity and physical-client evidence remain outside scope.

Knowledge capture: this report records that cached pinned `go run ...@version` can still require module-deprecation metadata access, and that the current browser launcher consumes `ANTHOLUME_CHROMIUM`, not `CHROMIUM_PATH` directly. No unowned guidance file was edited.
