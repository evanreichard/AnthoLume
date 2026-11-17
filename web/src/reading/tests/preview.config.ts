import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const project = fileURLToPath(new URL('../../../../', import.meta.url));
let mode = 'new';
export default defineConfig({ root: resolve(project, 'web'), base: '/assets/app/', build: { outDir: resolve(project, 'assets/app') }, preview: { host: '127.0.0.1', port: 5348, strictPort: true }, plugins: [{ name: 'reader-owned-sw-qualification', configurePreviewServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1:5348');
    try {
      if (url.pathname === '/__test/mode') { mode = url.searchParams.get('worker') || 'new'; res.end('OK'); return; }
      if (mode === 'offline') { res.destroy(); return; }
      if (url.pathname === '/sw.js') {
        res.setHeader('Content-Type', 'application/javascript'); res.setHeader('Cache-Control', 'no-cache');
        let source = await readFile(resolve(project, mode === 'legacy' ? 'assets/sw.js' : 'assets/app/sw.js'), 'utf8');
        if (mode === 'update' || mode === 'bad') source = source.replace(/self\.__ANTHOLUME_BUILD__="[^"]+"/, `self.__ANTHOLUME_BUILD__="reader-test-${mode}"`);
        if (mode === 'bad') source = source.replace(/"sha256":"[a-f0-9]{64}"/, `"sha256":"${'0'.repeat(64)}"`);
        res.end(source); return;
      }
      if (url.pathname.startsWith('/api/')) { res.statusCode = 503; res.setHeader('Content-Type', 'application/problem+json'); res.end(JSON.stringify({ type: 'about:blank', title: 'Offline', status: 503, code: 'storage_error', detail: 'No API in static reader qualification' })); return; }
      if (url.pathname === '/app' || url.pathname.startsWith('/app/') || url.pathname === '/' && url.searchParams.has('antholume-retirement')) { req.url = '/assets/app/index.html'; next(); return; }
      if (url.pathname === '/' || ['/local', '/reader', '/settings', '/activity'].includes(url.pathname)) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Old SSR</title><p>Ordinary SSR remains online</p>'); return; }
      if (url.pathname === '/manifest.json' || url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/assets/app/')) {
        if (url.pathname.includes('..')) { res.statusCode = 400; res.end(); return; }
        const bytes = await readFile(resolve(project, url.pathname === '/manifest.json' ? 'assets/manifest.json' : '.' + url.pathname));
        const extension = url.pathname.split('.').pop();
        res.setHeader('Content-Type', ({ js: 'application/javascript', css: 'text/css', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2' } as Record<string, string>)[extension || ''] || 'application/octet-stream'); res.end(bytes); return;
      }
      next();
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
} }] });
