import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { aliceFixture } from './alice-fixture.ts';
import { epubFile } from './large-fixture.ts';

const fixtures = new Map([
  ['/fixtures/alice.epub', aliceFixture],
  ['/public-300m.epub', epubFile],
]);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), {
    name: 'external-epub-fixtures',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const file = fixtures.get(req.url ?? '');
        if (!file) return next();
        try {
          const info = await stat(file);
          res.setHeader('Content-Type', 'application/epub+zip');
          res.setHeader('Content-Length', info.size);
          await pipeline(createReadStream(file, { highWaterMark: 65536 }), res);
        } catch {
          if (!res.destroyed) {
            res.statusCode = 404;
            res.end();
          }
        }
      });
    },
  }],
  server: { forwardConsole: false, host: '127.0.0.1', port: 5346, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] } },
});
