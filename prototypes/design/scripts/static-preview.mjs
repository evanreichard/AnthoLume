import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function inside(root, path) {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export async function createPreviewServer() {
  const root = await realpath(dist);
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (
        pathname.includes('\\') ||
        pathname.includes('\0') ||
        pathname.split('/').some((part) => part.startsWith('.'))
      ) {
        response.writeHead(404).end();
        return;
      }
      const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!inside(root, target)) {
        response.writeHead(404).end();
        return;
      }
      const actual = await realpath(target);
      if (!inside(root, actual) || !(await stat(actual)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const bytes = await readFile(actual);
      response.writeHead(200, {
        'Content-Type': contentTypes[extname(actual)] || 'application/octet-stream',
        'Content-Length': bytes.length,
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 404).end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PREVIEW_PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PREVIEW_PORT');
  const server = await createPreviewServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Static dist-only M2 preview: http://127.0.0.1:${port}/`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
