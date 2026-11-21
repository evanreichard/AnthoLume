import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { epubFile } from './large-fixture.ts';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react(), { name: 'public-large-fixture', configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url !== '/public-300m.epub') return next(); try { const info = await stat(epubFile); res.setHeader('Content-Type', 'application/epub+zip'); res.setHeader('Content-Length', info.size); createReadStream(epubFile, { highWaterMark: 65536 }).pipe(res); } catch { res.statusCode = 404; res.end(); } }); } }], server: { forwardConsole: false, host: '127.0.0.1', port: 5346, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] } } });
