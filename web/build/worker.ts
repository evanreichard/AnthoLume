import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build, type Plugin, type ResolvedConfig } from 'vite';

export function readingWorker(appNavigation: string[]): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'antholume-offline-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(value) { config = value; },
    async generateBundle(_, bundle) {
      const files = ['/', '/assets/icons/mark.svg', ...Object.keys(bundle).filter(path => path.startsWith('assets/')).sort().map(path => `/assets/app/${path}`)];
      const html = bundle['index.html'];
      if (html?.type !== 'asset') throw new Error('Missing shell HTML');
      const navigation = JSON.stringify(appNavigation);
      this.emitFile({ type: 'asset', fileName: 'shell-paths.json', source: navigation });
      const version = createHash('sha256').update(JSON.stringify(files)).update(navigation).update(html.source).digest('hex');
      const result = await build({
        configFile: false,
        root: config.root,
        define: { __APP_NAVIGATION__: navigation, __SHELL_FILES__: JSON.stringify(files), __SHELL_VERSION__: JSON.stringify(version), __HTML_INTEGRITY__: JSON.stringify('sha256-' + createHash('sha256').update(html.source).digest('base64')) },
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
      if (!worker || worker.type !== 'chunk') throw new Error('Missing compiled shell worker');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.code });
      const manifest = JSON.parse(await readFile(resolve(config.root, '../assets/manifest.json'), 'utf8'));
      if (manifest.start_url !== '/' || manifest.scope !== '/' || 'id' in manifest) throw new Error('Manifest install identity changed');
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) });
    },
  };
}
