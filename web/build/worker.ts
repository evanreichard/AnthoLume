import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, type Plugin, type ResolvedConfig } from 'vite';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

export function readingWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'antholume-reading-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(value) { config = value; },
    generateBundle: { order: 'post', async handler(_options, bundle) {
      const shell = bundle['index.html'];
      if (!shell || shell.type !== 'asset') throw new Error('Missing application shell');
      const precache = Object.entries(bundle).map(([file, entry]) => ({
        url: file === 'index.html' ? '/app/' : `${config.base}${file}`,
        sha256: hash(entry.type === 'asset' ? entry.source : entry.code),
      })).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
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
      if (!worker || worker.type !== 'chunk') throw new Error('Missing compiled reading worker');
      const buildId = hash(JSON.stringify(precache) + worker.code);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `self.__ANTHOLUME_PRECACHE__=${JSON.stringify(precache)};self.__ANTHOLUME_BUILD__=${JSON.stringify(buildId)};\n${worker.code}` });
      const manifest = JSON.parse(await readFile(resolve(config.root, '../assets/manifest.json'), 'utf8'));
      if (manifest.start_url !== '/' || manifest.scope !== '/' || 'id' in manifest) throw new Error('Manifest install identity changed');
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) });
    } },
  };
}
