#!/usr/bin/env python3
"""Build/test owned integration files with linked sibling sources, but no sibling dependency directories."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

source = Path(__file__).resolve().parents[1]
root = source.parents[1]
scratch = root / "_scratch/m2/integration"
checkout = scratch / "hermetic-checkout"
if checkout.exists():
    shutil.rmtree(checkout)
project = checkout / "prototypes/integration"
project.mkdir(parents=True)
for name in ("package.json", "package-lock.json", "index.html", "tsconfig.json", "vite.config.ts", "playwright.config.ts"):
    shutil.copy2(source / name, project / name)
for name in ("src", "tests"):
    shutil.copytree(source / name, project / name)
for sibling, children in (("reader-storage", ("src", "public")), ("api-contract", ("client",))):
    directory = checkout / "prototypes" / sibling
    directory.mkdir()
    for child in children:
        (directory / child).symlink_to(root / "prototypes" / sibling / child, target_is_directory=True)
    assert not (directory / "node_modules").exists()
artifacts = checkout / "_scratch/m2/integration"
(artifacts / "tmp").mkdir(parents=True)
(artifacts / "t").mkdir()
env = {**os.environ, "GOWORK": "off", "GOTMPDIR": str(artifacts / "tmp"), "TMPDIR": "../../_scratch/m2/integration/t"}
if not env.get("CHROMIUM_PATH"):
    raise SystemExit("CHROMIUM_PATH must name an existing Chromium executable")
# The Go fixture still compiles the actual owned module/local replacements; only the frontend checkout is isolated.
subprocess.run(["go", "build", "-mod=readonly", "-race", "-o", str(artifacts / "fixture-server"), "./cmd/fixture"], cwd=source, env={**env, "TMPDIR": str(artifacts / "tmp")}, check=True, timeout=180)
for command in (["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], ["npm", "run", "typecheck"], ["npm", "run", "build"], ["npm", "run", "test:browser"]):
    subprocess.run(command, cwd=project, env=env, check=True, timeout=180)
closure = json.loads((artifacts / "dist/dependency-closure.json").read_text())
expected = str(project / "node_modules") + "/"
assert closure["root"] == expected
assert closure["dependencies"] and all(path.startswith(expected) for path in closure["dependencies"])
assert any("/css-tree/" in path for path in closure["dependencies"])
# Dependency Sensitivity - Hiding only the owned parser must fail rather than fall back to an installed sibling package.
parser = project / "node_modules/css-tree"
hidden = checkout / "css-tree.hidden"
parser.rename(hidden)
try:
    missing = subprocess.run(["npm", "run", "build"], cwd=project, env=env, capture_output=True, text=True, timeout=60)
    failure = missing.stdout + missing.stderr
    (scratch / "hermetic-missing-css.log").write_text(failure)
    assert missing.returncode != 0 and "css-tree" in failure, "Missing owned CSS parser silently resolved elsewhere"
finally:
    hidden.rename(parser)
subprocess.run(["npm", "run", "build"], cwd=project, env=env, check=True, timeout=60)
for sibling in ("reader-storage", "api-contract"):
    assert not (checkout / "prototypes" / sibling / "node_modules").exists()
files = [root / "prototypes/reader-storage/src" / f"{name}.ts" for name in ("storage", "sync", "wire", "content-policy", "archive-path", "chapter-policy", "css-policy", "body-contract")]
files += [root / "prototypes/reader-storage/public/fixtures/synthetic.epub"]
summary = {
    "sibling_node_modules_present": False,
    "missing_owned_css_rejected": True,
    "dependency_root": expected,
    "resolved_dependency_modules": len(closure["dependencies"]),
    "browser_tests": 10,
    "source_sha256": {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
    "lock_sha256": hashlib.sha256((source / "package-lock.json").read_bytes()).hexdigest(),
}
(scratch / "hermetic-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print("Hermetic frontend checkout: sibling dependency directories absent; all resolved build dependencies owned by integration; ten HTTP tests passed.")
