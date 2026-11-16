# Browser → Go integration proof

Disposable M2 harness connecting the existing reader-storage Repository/SyncCoordinator to the API proof's generated bindings and actual SQLite operations. It is not a production frontend, login service, KO protocol adapter, or service worker.

From repository root, with Go 1.26.11+ and an existing Chromium executable:

```sh
CHROMIUM_PATH=/path/to/chromium bash prototypes/integration/scripts/verify.sh
CHROMIUM_PATH=/path/to/chromium python3 prototypes/integration/scripts/verify-hermetic.py
bash prototypes/integration/scripts/audit.sh
```

The verified run used the isolated Go toolchain under `_scratch/m2/api-contract/toolchains/go/bin` via command-scoped PATH, Node 22.23.4 and Chromium 157.0.8103.38. Python 3 is required for the dependency-isolated checkout check. Initial npm/Go registry access is required; sibling `node_modules` installations are not required.

- Vite builds actual sibling TS imports; no copied reader implementation or fake transport. Own runtime pins include CSS Tree 3.2.1 (types 3.2.0), Dexie 4.4.7, JSZip 3.10.1 and openapi-fetch 0.17.0.
- `verify-hermetic.py` copies only integration-owned frontend files, links actual sibling source/public/client directories, and runs locked install/typecheck/build/the same ten browser tests with no sibling dependency directories. It also verifies that removing the owned CSS parser makes the build fail, then restores it.
- Vite preserves those source links and deduplicates all direct runtime imports. A build guard rejects dependency resolution outside integration's own `node_modules`; emitted `dependency-closure.json` records the resolved build graph.
- Playwright owns the Go process/listener on `127.0.0.1:0`, teardown and temporary SQLite files. Go serves the compiled page and API at one actual origin; no proxy, preview server or request-Origin rewrite.
- A random test-process control key guards fixture bootstrap, cookie expiry, SQLite reopen, KO-style operations and response faults. Ordinary API authentication/CSRF is unchanged.
- Fixtures retain `alice`, `book-a`, `a-device` and `a-second`; EPUB bytes come read-only from the existing public reader fixture.
- Build, audit, test artifacts and databases stay under `_scratch/m2/integration/`. Chromium uses a relative scratch TMPDIR to fit Unix socket pathname limits.
- Lost-response mode stays armed until reopen because Chromium can transparently retry a closed connection. Malicious receipt modes corrupt only post-commit HTTP responses, never the durable ledger.

Named contracts, test dispositions and limits: [integration report](../../docs/evaluation/m2-integration.md).
