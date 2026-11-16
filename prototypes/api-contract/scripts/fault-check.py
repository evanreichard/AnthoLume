#!/usr/bin/env python3
"""Mutate only scratch copies. Exit successfully only when each named contract detects its fault."""
from pathlib import Path
import os
import shutil
import subprocess

source = Path(__file__).resolve().parents[1]
root = source.parents[1]
scratch = root / "_scratch/m2/api-contract/faults"
scratch.mkdir(parents=True, exist_ok=True)
faults = [
    ("dedup", "store.go", "return result, nil", "out, err := effect(tx); if err != nil { return outcome{}, err }; return out, tx.Commit()", "TestActivityReceiptDedup"),
    ("cas", "store.go", 'query += " AND revision=CAST(? AS INTEGER)"', 'query += " AND revision>=CAST(? AS INTEGER)"', "TestProgressReceiptsCASAndKO"),
    ("validation", "server.go", "s := &Server{store, epub}", 'spec.Components.Schemas["ProgressEvent"].Value.Properties["fraction"].Value.Max = nil\n\ts := &Server{store, epub}', "TestJSONValidation/high"),
    ("duplicate-json", "server.go", "if !isUpload && uniqueJSON(body) != nil {", "if false && !isUpload && uniqueJSON(body) != nil {", "TestJSONValidation/duplicate"),
    ("signed-zero", "store.go", "\t\treturn 0\n", "\t\treturn value\n", "TestSignedZeroRetries"),
    ("ko-effect", "store.go", "_, err = database.New(tx).UpdateProgress(ctx, database.UpdateProgressParams{UserID: user, DocumentID: document, DeviceID: device, Percentage: fraction, Progress: position})", "err = nil", "TestKOHTTPWriteAndRollback"),
    ("ko-position", "store.go", "Percentage: fraction, Progress: position}", 'Percentage: fraction, Progress: "/wrong/ko/position"}', "TestKOHTTPWriteAndRollback"),
    ("ko-fraction", "store.go", "Percentage: fraction, Progress: position}", "Percentage: 0.99, Progress: position}", "TestKOHTTPWriteAndRollback"),
    ("ko-rollback", "store.go", "\tif err != nil {\n\t\treturn err\n\t}\n\treturn tx.Commit()", "\tif err != nil {\n\t\t_ = tx.Commit()\n\t\treturn err\n\t}\n\treturn tx.Commit()", "TestKOHTTPWriteAndRollback"),
    ("activity-kind", "store.go", "Receipt{EventId: e.EventId, Kind: Activity}", "Receipt{EventId: e.EventId, Kind: Progress}", "TestActivityReceiptDedup"),
    ("zip-crc", "server.go", "\t\tif err != nil {\n\t\t\treturn fail(400, \"invalid_epub\")\n\t\t}\n\t\tif f.Name == \"mimetype\"", "\t\tif f.Name == \"mimetype\"", "TestUploadCRCIntegrity"),
]
for name, file, old, new, test in faults:
    target = scratch / name
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("node_modules"))
    mod = target / "go.mod"
    mod.write_text(mod.read_text().replace("=> ../..", f"=> {root}"))
    path = target / file
    text = path.read_text()
    # The dedup return has two occurrences: mutate the receipt lookup, not the committed-effect return.
    if name == "dedup":
        text = text.replace(old, new, 1)
    else:
        assert text.count(old) == 1, (name, text.count(old))
        text = text.replace(old, new)
    path.write_text(text)
    result = subprocess.run(["go", "test", "-mod=readonly", "-count=1", "-timeout=30s", "-run", f"^{test}$", "."], cwd=target, env={**os.environ, "GOWORK": "off"}, capture_output=True, text=True, timeout=90)
    log = result.stdout + result.stderr
    (scratch / f"{name}.log").write_text(log)
    if result.returncode == 0 or "--- FAIL: " not in log or "[build failed]" in log:
        raise SystemExit(f"{name}: fault not detected by intended test:\n{log}")
    print(f"{name}: detected by {test}")

# Schema drift is tested without editing generated files.
target = scratch / "schema-drift"
if target.exists():
    shutil.rmtree(target)
shutil.copytree(source, target, ignore=shutil.ignore_patterns("node_modules"))
(target / "node_modules").symlink_to(source / "node_modules", target_is_directory=True)
path = target / "openapi.yaml"
text = path.read_text()
old = "        author: {type: string, nullable: true}"
assert text.count(old) == 1
path.write_text(text.replace(old, old + "\n        proof_drift: {type: boolean}"))
result = subprocess.run(["python3", "scripts/check-drift.py"], cwd=target, env={**os.environ, "PROOF_SCRATCH": str(scratch)}, capture_output=True, text=True, timeout=240)
log = result.stdout + result.stderr
(scratch / "schema-drift.log").write_text(log)
if result.returncode == 0 or "drift: contract.gen.go" not in log or "drift: client/schema.gen.ts" not in log:
    raise SystemExit(f"drift checks did not detect both generated surfaces:\n{log}")
print("schema drift: both Go and TypeScript checks detected stale artifacts")
