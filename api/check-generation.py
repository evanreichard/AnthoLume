from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='antholume-generation-') as directory:
    first, second = (Path(directory) / name for name in ('first', 'second'))
    for target in (first, second):
        subprocess.run(['bash', 'api/generate.sh', target], cwd=root, check=True, timeout=240)
    def artifacts(tree):
        return {p.relative_to(tree) for folder in ('api', 'web/src/api')
                for p in (tree / folder).glob('*.gen.*')}

    expected_files = artifacts(root)
    if not expected_files or artifacts(first) != expected_files or artifacts(second) != expected_files:
        raise SystemExit('generated file list differs from the checked-in artifacts')
    for source in sorted(expected_files):
        expected = (first / source).read_bytes()
        if expected != (second / source).read_bytes():
            raise SystemExit(f'nondeterministic generation: {source}')
        if expected != (root / source).read_bytes():
            raise SystemExit(f'generated artifact drift: {source}')
print('Go, TypeScript and response guards: two passes identical; checked-in outputs match')
