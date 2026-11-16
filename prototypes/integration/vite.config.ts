import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { preserveSymlinks: true, dedupe: ['css-tree', 'dexie', 'jszip', 'openapi-fetch'] },
  plugins: [{
    name: 'integration-runtime-closure',
    generateBundle() {
      const root = fileURLToPath(new URL('./node_modules/', import.meta.url));
      const dependencies = [...this.getModuleIds()].map(id => id.replaceAll('\u0000', '').split('?')[0]!).filter(id => id.includes('/node_modules/')).sort();
      for (const id of dependencies) {
        if (!id.startsWith(root)) this.error(`Dependency resolved outside integration node_modules: ${id}`);
      }
      this.emitFile({ type: 'asset', fileName: 'dependency-closure.json', source: JSON.stringify({ root, dependencies }, null, 2) });
    },
  }],
  build: {
    target: 'es2022',
    outDir: fileURLToPath(new URL('../../_scratch/m2/integration/dist', import.meta.url)),
    emptyOutDir: true,
  },
});
