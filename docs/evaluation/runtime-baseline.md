# M1 — Snapshot and Runtime Baseline

## Result and Limits

The existing application starts against an isolated copy of the supplied snapshot. All **32 HTTP smoke checks passed**. Existing Go tests, race tests, vet, and the native embedded build also pass; see [architecture/tooling verification](architecture-tooling.md#confirmed-verification).

This is baseline evidence for the current application, not certification of the proposed frontend or complete runtime parity. HTML status checks do not establish visual correctness or browser execution. No browser/PWA, external-provider, destructive administration, or new-schema migration proof was performed.

## Isolation and Reproduction

- Original archive: `_scratch/AnthoLumeBackup_20261116191232.zip`; never modified.
- Disposable extraction/config/data: `_scratch/evaluation/runtime/restore/`. The pre-existing `_scratch/db` was not used or changed.
- Archive entries were checked for absolute/traversing/duplicate paths, unexpected roots, symbolic links, and aggregate extraction size before extraction. All ZIP CRC checks passed.
- Runtime used a Linux user/network namespace with only loopback enabled. The existing server binds all interfaces, but no host network interface or external network was available inside this namespace. The process was stopped after verification.
- One existing account in the disposable database received random local-only credentials and administrator permissions to exercise real reading history and admin pages. Original archive credentials were neither used nor disclosed. These copied-account changes are not migrations or production requirements.
- Registration and external acquisition search were disabled; secure cookies were disabled only for isolated loopback HTTP. External linked-import paths were not rebound. Raw response bodies, account names, titles, stored paths, hashes, and cookies are not committed as evidence.
- Scratch scripts: `prepare.py` (validate/extract/aggregate), `credentials.go` (generate temporary password hash), `smoke.py` (launch and exercise server). Scratch evidence: `summary-before.json`, `smoke-summary.json`, `smoke-run.log`, and private server logs. These paths are under `_scratch/evaluation/runtime/` and are intentionally untracked.
- Reproduction from the repository root uses `python3 _scratch/evaluation/runtime/prepare.py`, `go run _scratch/evaluation/runtime/credentials.go`, then `unshare --user --map-root-user --net python3 _scratch/evaluation/runtime/smoke.py`. Preparation deliberately refuses to overwrite an existing extraction; use a fresh disposable target. Runtime also requires the baseline binary produced by `_scratch/evaluation/backend-tooling/validate.sh`. Linux user/network namespaces and `ip` are prerequisites, not application deployment requirements.

## Snapshot Characteristics

| Property | Observed value |
| --- | --- |
| Archive entries / uncompressed size | 402 / 1,292,129,068 bytes |
| SQLite integrity check | `ok`, before and after runtime |
| Users / devices | 2 / 10 |
| Document rows | 216: 201 active, 15 deleted |
| Progress / activity rows | 230 / 151,593 |
| Metadata rows | 319 |
| Archived EPUBs / covers | 201 / 186 |
| Managed file references | 111 available, zero missing |
| External-basepath references | 90; availability at original roots not qualified |
| No-filepath rows / unknown word counts | 15 / 16 |
| Applied Goose migrations | 20240128012356, 20240311121111, 20240510123707 |
| Existing foreign-key violations | 2 `metadata → documents` references, unchanged after runtime |

The two orphaned metadata records are a pre-existing dataset condition, not introduced by evaluation. Future migrations must decide how to handle them explicitly; neither a destructive cleanup nor a global foreign-key rebuild is assumed.

External-basepath rows are important server compatibility evidence. Existing DIRECT imports cannot silently be converted into managed-only paths. The backup's inclusion of EPUB bytes does not itself prove that original absolute root references resolve on a different machine. Restore/rebinding policy needs separate verification.

## Verified HTTP Contracts

| Group | Checks |
| --- | --- |
| Unauthenticated access | Protected web/admin redirect to login; KO request without credentials rejects with 401 |
| Public/offline assets | Reader shell, local shell, JSON manifest, service-worker script served successfully |
| Session lifecycle | Login establishes cookie session; authenticated routes do not redirect; logout redirects; the same client is rejected from protected routes afterward |
| Web views | Dashboard, library, second library page, activity, progress, settings, admin overview/users/logs/import return 200 |
| Reader/document resources | Detail, JSON reader state, JSON device list, cached cover; downloaded EPUB matches restored source bytes by SHA-256 |
| External protocol reads | KO header authentication and stored progress JSON; OPDS root/documents/search descriptor parse as XML using Basic authentication |
| Feature flags | Disabled search returns 404; disabled registration submission returns 401 |

The smoke harness deliberately disables automatic redirects for authenticated view checks, so a login page returning 200 cannot masquerade as a passing protected view. Compatibility checks cover read/auth wire behavior, not complete plugin synchronization or progress/activity mutation semantics.

The copied database's activity, document-progress, and device tables were fingerprinted before and after runtime and were unchanged. Derived-statistics refresh and copied credentials/settings are expected runtime/evaluation writes. Server shutdown exited 0; migration versions and the two existing foreign-key violations were unchanged. Source archive integrity was preserved.

## Remaining Qualification

- Browser execution, reader position round trips and sandbox behavior, installation/offline restart, and physical-device behavior.
- Write workflows and server-enforced permissions, including feature-flag combinations and failure states.
- Provider metadata/acquisition behavior under controlled responses, without leaking private dataset queries.
- Consistent backup/staged restore, separate config/data paths, non-default DB name, DIRECT-import availability, and interrupted recovery.
- New additive migrations against this populated snapshot and synthetic older schemas, including orphan handling and preservation of external protocol contracts.
- Dataset-scale performance under realistic client/network/device profiles. Observed local server latency is not a frontend performance budget.
