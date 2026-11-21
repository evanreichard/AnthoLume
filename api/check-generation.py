from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='antholume-generation-') as directory:
    work = Path(directory)
    for iteration in (1, 2):
        config = (root / 'api/oapi-codegen.yaml').read_text().replace('output: contract.gen.go', f'output: {work / f"go{iteration}"}')
        (work / 'config.yaml').write_text(config)
        subprocess.run(['go', 'run', 'github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2', '--config', str(work / 'config.yaml'), 'openapi.yaml'], cwd=root / 'api', env={**os.environ, 'GOWORK': 'off'}, check=True, timeout=180)
        subprocess.run(['node', 'api/generate-ts.mjs', str(work / f'ts{iteration}')], cwd=root, check=True, timeout=60)
    drift = []
    for source, prefix in [('api/contract.gen.go', 'go'), ('web/src/api/schema.gen.ts', 'ts')]:
        expected = (work / f'{prefix}1').read_bytes()
        if expected != (work / f'{prefix}2').read_bytes():
            raise SystemExit(f'nondeterministic generation: {source}')
        if expected != (root / source).read_bytes():
            drift.append(f'generated artifact drift: {source}')
    if drift:
        raise SystemExit('\n'.join(drift))
print('Go and TypeScript: two passes identical; checked-in outputs match')
