import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readingWorker } from './build/worker.ts';

const target = process.env.ANTHOLUME_BACKEND ?? 'http://127.0.0.1:5324';
const legacy = ['/api', '/app', '/sw.js', '/manifest.json', '/favicon.ico', '/assets/icons', '/assets/app/assets', '/documents', '/activity', '/progress', '/settings', '/search', '/admin', '/login', '/logout'];

export default defineConfig({
  base: '/assets/app/',
  plugins: [react(), readingWorker(), {
    name: 'antholume-development-navigation',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        // Safari Navigation - HTML requests may omit Sec-Fetch-Dest; worker precache fetches still use Go's compiled shell.
        const wantsHTML = req.headers['sec-fetch-dest'] === 'document' || /\btext\/html\b/.test(req.headers.accept ?? '');
        if ((wantsHTML && /^\/app(?:\/|$)/.test(url.pathname)) || (url.pathname === '/' && url.searchParams.get('antholume-retirement') === 'legacy-v1')) req.url = '/assets/app/index.html';
        next();
      });
    },
  }],
  server: {
    forwardConsole: false,
    host: '127.0.0.1',
    port: 5323,
    strictPort: true,
    proxy: {
      ...Object.fromEntries(legacy.map((path) => [path, { target, changeOrigin: false }])),
      '^/assets/(?!app/)': { target, changeOrigin: false },
      '^/\\?(?!.*antholume-retirement)': { target, changeOrigin: false },
      '^/$': { target, changeOrigin: false },
    },
  },
  build: { outDir: '../assets/app', emptyOutDir: true, target: 'es2022' },
});
