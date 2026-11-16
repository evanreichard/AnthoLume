import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewServer } from './static-preview.mjs';

async function withPreview(run) {
  const server = await createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(server.address().address, '127.0.0.1');
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('static preview serves built HTML/assets and HEAD without dev middleware', async () => {
  await withPreview(async (base) => {
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    const html = await home.text();
    assert.ok(!html.includes('/@vite/client'));
    const script = html.match(/src="([^"]+\.js)"/)[1];
    const asset = await fetch(new URL(script, `${base}/`));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});

test('static preview never serves repository, dotfiles, dev endpoints, traversal or missing files', async () => {
  await withPreview(async (base) => {
    for (const path of [
      '/package.json',
      '/src/App.tsx',
      '/@fs/etc/hosts',
      '/@vite/client',
      '/.env?raw',
      '/%2e%2e%2fpackage.json',
      '/assets/missing.js',
      '/index.html/../../package.json',
    ]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 404, path);
      assert.equal(await response.text(), '', path);
    }
    assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  });
});
