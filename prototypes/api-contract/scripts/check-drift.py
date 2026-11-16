#!/usr/bin/env python3
from pathlib import Path
import os
import subprocess
import tempfile

source = Path(__file__).resolve().parents[1]
scratch = Path(os.environ.get("PROOF_SCRATCH", source.parents[1] / "_scratch/m2/api-contract"))
scratch.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="drift.", dir=scratch) as work:
    work = Path(work)
    for iteration in (1, 2):
        config = (source / "oapi-codegen.yaml").read_text().replace("output: contract.gen.go", f"output: {work / f'go{iteration}'}")
        (work / "config.yaml").write_text(config)
        subprocess.run(["go", "run", "github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2", "--config", str(work / "config.yaml"), "openapi.yaml"], cwd=source, env={**os.environ, "GOWORK": "off"}, check=True, timeout=180)
        subprocess.run(["node", "scripts/generate-ts.mjs", str(work / f"ts{iteration}")], cwd=source, check=True, timeout=60)
    drift = []
    for generated, prefix in (("contract.gen.go", "go"), ("client/schema.gen.ts", "ts")):
        expected = (work / f"{prefix}1").read_bytes()
        if expected != (work / f"{prefix}2").read_bytes():
            raise SystemExit(f"nondeterministic generation: {generated}")
        if expected != (source / generated).read_bytes():
            drift.append(f"generated artifact drift: {generated}")
    if drift:
        raise SystemExit("\n".join(drift))
print("Go + TypeScript: two generations identical; checked-in artifacts match.")
