import { matchesShell, shellPaths } from './src/app-routes';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readerBoundary } from './build/reader-boundary.ts';
import { readingWorker } from './build/worker.ts';

const target = process.env.ANTHOLUME_BACKEND ?? 'http://127.0.0.1:5324';
const appNavigation = new Set(shellPaths());
const backendRoutes = [
  '^/api(?:/|$)',
  '/sw.js',
  '/manifest.json',
  '/favicon.ico',
  '/assets/icons',
  '/assets/app/assets',
];

export default defineConfig({
  base: '/assets/app/',
  appType: 'mpa',
  plugins: [
    react(),
    readerBoundary(),
    readingWorker([...appNavigation]),
    {
      name: 'antholume-development-navigation',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const wantsHTML =
            req.headers['sec-fetch-dest'] === 'document' || /\btext\/html\b/.test(req.headers.accept ?? '');
          if ((req.method === 'GET' || req.method === 'HEAD') && wantsHTML && matchesShell(appNavigation, url.pathname))
            req.url = '/assets/app/index.html';
          next();
        });
      },
    },
  ],
  server: {
    forwardConsole: false,
    host: '127.0.0.1',
    port: 5323,
    strictPort: true,
    proxy: Object.fromEntries(backendRoutes.map((path) => [path, { target, changeOrigin: false }])),
  },
  build: { outDir: '../assets/app', emptyOutDir: true, target: 'es2022' },
});
