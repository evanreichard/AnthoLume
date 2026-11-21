import { normalizePath, type Plugin } from 'vite';

export function readerBoundary(): Plugin {
  return {
    name: 'antholume-reader-boundary',
    apply: 'build',
    generateBundle(_, bundle) {
      const entry = Object.values(bundle).find(chunk => chunk.type === 'chunk' && chunk.isEntry && chunk.facadeModuleId && normalizePath(chunk.facadeModuleId).endsWith('/index.html'));
      if (!entry) this.error('Missing app HTML entry for reader boundary check');

      const pending = [entry.fileName];
      const visited = new Set<string>();
      while (pending.length) {
        const name = pending.pop()!;
        if (visited.has(name)) continue;
        visited.add(name);
        const chunk = bundle[name];
        if (chunk?.type !== 'chunk') continue;
        const readerModule = chunk.moduleIds.map(normalizePath).find(id => id.endsWith('/src/reading/ReaderScreen.tsx') || /\/node_modules\/(epubjs|jszip)\//.test(id));
        if (readerModule) this.error(`App startup chunk ${name} includes reader-only module ${readerModule}`);
        pending.push(...chunk.imports);
        for (const dependency of chunk.dynamicImports) {
          const target = bundle[dependency];
          if (target?.type === 'chunk' && target.facadeModuleId && normalizePath(target.facadeModuleId).endsWith('/src/routes/ReaderRoute.tsx')) continue;
          pending.push(dependency);
        }
      }
    },
  };
}
