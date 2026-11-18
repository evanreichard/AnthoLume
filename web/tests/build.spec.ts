import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect, root } from './fixtures';

test('Go serves the compiled application, retirement worker and real errors instead of SPA fallback', async ({ request, server }) => {
  const worker = await request.get(`${server.origin}/sw.js`);
  expect(worker.status()).toBe(200);
  expect(worker.headers()['content-type']).toMatch(/javascript/);
  expect(worker.headers()['cache-control']).toContain('no-cache');
  const compiled = await readFile(`${root}assets/app/sw.js`, 'utf8');
  expect(await worker.text()).toBe(compiled);
  expect(compiled).not.toContain('__ANTHOLUME_PRECACHE__');
  const assets = await readdir(`${root}assets/app/assets`);
  expect(assets.some((name) => /ReaderRoute-.*\.js$/.test(name))).toBe(true);
  expect(assets.some((name) => /source\.worker-.*\.js$/.test(name))).toBe(true);
  expect(assets.some((name) => /staging\.worker-.*\.js$/.test(name))).toBe(true);
  const entries = await Promise.all([['/app/', 'index.html'], ...assets.map(name => [`/assets/app/assets/${name}`, `assets/${name}`])].map(async ([url, file]) => ({ url, sha256: createHash('sha256').update(await readFile(`${root}assets/app/${file}`)).digest('hex') })));
  for (const entry of entries) {
    const response = await request.get(`${server.origin}${entry.url}`);
    expect(response.status()).toBe(200);
    expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(entry.sha256);
    expect(response.headers()['cache-control']).toMatch(entry.url === '/app/' ? /no-cache/ : /immutable/);
    const mime: Record<string, RegExp> = { js: /javascript/, css: /text\/css/, woff2: /font\/woff2/ };
    const expected = entry.url === '/app/' ? /text\/html/ : mime[entry.url.split('.').at(-1)!];
    expect(expected).toBeDefined();
    expect(response.headers()['content-type']).toMatch(expected);
  }
  const shell = await request.get(`${server.origin}/app/books/server/book-001?account=missing`);
  expect(shell.status()).toBe(200);
  expect(shell.headers()['content-security-policy']).toContain("script-src 'self'");
  const manifest = await request.get(`${server.origin}/manifest.json`);
  const identity = await manifest.json();
  expect(identity.start_url).toBe('/'); expect(identity.scope).toBe('/'); expect(identity).not.toHaveProperty('id');
  for (const path of ['/assets/app/assets/missing.js', '/app/not-a-route', '/api/v1/missing']) {
    const response = await request.get(`${server.origin}${path}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('<div id="root">');
  }
  const privateFile = await request.get(`${server.origin}/api/v1/documents/book-001/file`);
  expect(privateFile.status()).toBe(401);
  expect(privateFile.headers()['content-type']).toContain('application/problem+json');
  const bootstrap = await request.get(`${server.origin}/?antholume-retirement=legacy-v1`);
  expect(bootstrap.status()).toBe(200);
  expect(await bootstrap.text()).toContain('<div id="root">');
});
