import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium } = require('playwright');
const [origin, output] = process.argv.slice(2);
const browser = await chromium.launch({
  ...(process.env.ANTHOLUME_CHROMIUM ? { executablePath: process.env.ANTHOLUME_CHROMIUM } : {}),
  headless: true,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 120, height: 100 }, serviceWorkers: 'block' });
let measuring = false;
let sessionRequestEvents = 0;
const results = [];
context.on('request', request => {
  if (measuring && new URL(request.url()).pathname === '/api/v1/session') sessionRequestEvents++;
});
try {
  const page = await context.newPage();
  await page.goto(`${origin}/api/v1/session`);
  const control = await page.evaluate(async () => {
    const session = await (await fetch('/api/v1/session')).json();
    const response = await fetch('/api/v1/session/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token },
      body: JSON.stringify({ username: 'alice', password: 'password' }),
    });
    const authenticated = await (await fetch('/api/v1/session')).json();
    return { status: response.status, authenticated: authenticated.user?.id === 'alice', csrfReadable: authenticated.csrf_token?.length === 64 };
  });
  assert.deepEqual(control, { status: 201, authenticated: true, csrfReadable: true });
  // Real OPDS Basic Auth - No route interception, response mocking or test bootstrap endpoint.
  await context.setExtraHTTPHeaders({ Authorization: `Basic ${Buffer.from('alice:password').toString('base64')}`, 'X-Cover-Qualification': '1' });
  measuring = true;
  let index = 0;
  for (const prefix of ['/api/v1/documents/', '/documents/', '/api/opds/documents/']) {
    const svg = `${origin}${prefix}browser-svg/cover`;
    const response = await page.goto(svg);
    assert.equal(response.status(), 200);
    await page.waitForTimeout(250);
    const top = await page.evaluate(() => ({
      executed: document.documentElement.getAttribute('data-cover-executed'),
      user: document.documentElement.getAttribute('data-cover-user'),
      csrf: document.documentElement.getAttribute('data-cover-csrf'),
      origin: window.origin,
    }));
    assert.deepEqual(top, { executed: null, user: null, csrf: null, origin: 'null' });
    await page.screenshot({ path: path.join(output, `svg-top-${index}.png`), clip: { x: 0, y: 0, width: 40, height: 40 } });
    results.push({ path: new URL(svg).pathname, mode: 'top-level', isolated: true });
    for (const kind of ['svg', 'raster']) {
      await page.goto(`${origin}/api/v1/capabilities`);
      await page.evaluate(url => {
        document.body.replaceChildren();
        const image = document.createElement('img'); image.id = 'cover-image'; image.width = 40; image.height = 40; image.src = url;
        document.body.append(image);
      }, `${origin}${prefix}browser-${kind}/cover`);
      await page.waitForFunction(() => { const image = document.getElementById('cover-image'); return image.complete && image.naturalWidth > 0; });
      await page.locator('#cover-image').screenshot({ path: path.join(output, `${kind}-img-${index}.png`) });
      results.push({ path: `${prefix}browser-${kind}/cover`, mode: 'image', displayed: true });
    }
    for (const kind of ['iframe', 'object', 'embed']) {
      await page.goto(`${origin}/api/v1/capabilities`);
      await page.evaluate(({ url, kind }) => {
        document.body.replaceChildren(); document.documentElement.removeAttribute('data-cover-parent');
        window.__coverMessages = 0;
        window.addEventListener('message', event => { if (event.data?.bookCover) window.__coverMessages++; });
        const embedded = document.createElement(kind); embedded.id = 'embedded-cover';
        if (kind === 'object') embedded.data = url; else embedded.src = url;
        if (kind !== 'iframe') embedded.type = 'image/svg+xml';
        document.body.append(embedded);
      }, { url: svg, kind });
      await page.waitForTimeout(250);
      const embedded = await page.evaluate(() => {
        const element = document.getElementById('embedded-cover');
        let readableSVG = false;
        try { readableSVG = (element.contentDocument ?? element.getSVGDocument?.())?.documentElement?.localName === 'svg'; } catch { /* Opaque/blocked documents are expected. */ }
        return { parent: document.documentElement.getAttribute('data-cover-parent'), messages: window.__coverMessages, readableSVG };
      });
      assert.deepEqual(embedded, { parent: null, messages: 0, readableSVG: false });
      results.push({ path: new URL(svg).pathname, mode: kind, isolated: true });
    }
    index++;
  }
  // Wire Assertions - Chromium emits request events even when CSP blocks them; the Go server measures actual session/resource delivery.
  const summary = { browser: browser.version(), checks: results.length, sessionRequestEvents, results };
  await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ browser: summary.browser, checks: summary.checks, sessionRequestEvents }));
} finally {
  await context.close();
  await browser.close();
}
