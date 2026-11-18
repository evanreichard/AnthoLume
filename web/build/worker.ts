import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, type Plugin, type ResolvedConfig } from 'vite';

export function readingWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'antholume-worker-retirement',
    apply: 'build',
    enforce: 'post',
    configResolved(value) { config = value; },
    async generateBundle() {
      const result = await build({
        configFile: false,
        root: config.root,
        logLevel: 'warn',
        build: {
          write: false,
          target: 'es2022',
          minify: true,
          lib: { entry: resolve(config.root, 'src/reading/sw.ts'), formats: ['iife'], name: 'AnthoLumeWorker', fileName: () => 'sw.js' },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const worker = outputs.flatMap((output) => 'output' in output ? output.output : []).find((entry) => entry.type === 'chunk');
      if (!worker || worker.type !== 'chunk') throw new Error('Missing compiled retirement worker');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.code });
      const manifest = JSON.parse(await readFile(resolve(config.root, '../assets/manifest.json'), 'utf8'));
      if (manifest.start_url !== '/' || manifest.scope !== '/' || 'id' in manifest) throw new Error('Manifest install identity changed');
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) });
    },
  };
}
