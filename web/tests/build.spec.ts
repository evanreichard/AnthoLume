import { readFile } from 'node:fs/promises';
import { test, expect, root } from './fixtures';

test('Go serves the compiled application, offline shell worker and real errors instead of SPA fallback', async ({
  request,
  server,
}) => {
  const worker = await request.get(`${server.origin}/sw.js`);
  expect(worker.status()).toBe(200);
  expect(worker.headers()['content-type']).toMatch(/javascript/);
  expect(worker.headers()['cache-control']).toContain('no-cache');
  const compiled = await readFile(`${root}assets/app/sw.js`, 'utf8');
  expect(await worker.text()).toBe(compiled);
  expect(compiled).not.toContain('__ANTHOLUME_PRECACHE__');
  const index = await request.get(server.origin);
  expect(index.status()).toBe(200);
  const indexHTML = await index.text();
  expect(indexHTML).toBe(await readFile(`${root}assets/app/index.html`, 'utf8'));
  const assets = [...indexHTML.matchAll(/(?:src|href)="(\/assets\/app\/assets\/[^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  expect(assets).toEqual(expect.arrayContaining([expect.stringMatching(/\.js$/), expect.stringMatching(/\.css$/)]));
  for (const asset of assets) {
    const response = await request.get(`${server.origin}${asset}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('immutable');
    expect(response.headers()['content-type']).toMatch(asset.endsWith('.js') ? /javascript/ : /text\/css/);
  }
  const shell = await request.get(`${server.origin}/books/server?id=book_001&account=missing`);
  expect(shell.status()).toBe(200);
  expect(shell.headers()['content-security-policy']).toContain("script-src 'self'");
  const html = await shell.text();
  expect(html).toContain('<link rel="manifest" href="/manifest.json"');
  expect(html).toContain('<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png"');
  expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
  const manifest = await request.get(`${server.origin}/manifest.json`);
  expect(manifest.status()).toBe(200);
  const identity = await manifest.json();
  expect(identity.display).toBe('standalone');
  expect(identity.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  );
  for (const { src, sizes } of identity.icons) {
    const icon = await request.get(new URL(src, server.origin).href);
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toMatch(/image\/png/);
    const png = await icon.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)].join('x')).toBe(sizes);
  }
  expect(identity.start_url).toBe('/');
  expect(identity.scope).toBe('/');
  expect(identity).not.toHaveProperty('id');
  for (const path of ['/assets/app/assets/missing.js', '/not-a-route', '/api/v1/missing']) {
    const response = await request.get(`${server.origin}${path}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('<div id="root">');
  }
  const privateFile = await request.get(`${server.origin}/api/v1/documents/book_001/file`);
  expect(privateFile.status()).toBe(401);
  expect(privateFile.headers()['content-type']).toContain('application/problem+json');
  const bootstrap = await request.get(`${server.origin}/?antholume-retirement=legacy-v1`);
  expect(bootstrap.status()).toBe(200);
  expect(await bootstrap.text()).toContain('<div id="root">');
});
