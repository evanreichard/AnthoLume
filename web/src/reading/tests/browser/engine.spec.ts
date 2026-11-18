import { expect, test, type Page } from '@playwright/test';
async function watch(page: Page) {
  const forbidden: string[] = [];
  const allowed = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url());
    if (['blob:', 'data:', 'about:'].includes(url.protocol)) return true;
    return request.method() === 'GET' && url.origin === 'http://127.0.0.1:5346' && (request.frame() === page.mainFrame() || request.resourceType() === 'script') && ['/', '/harness.tsx', '/fixtures/', '/@vite/', '/@id/', '/@fs/', '/node_modules/'].some(p => url.pathname === p || url.pathname.startsWith(p));
  };
  page.on('request', request => { if (!allowed(request)) forbidden.push(request.url()); });
  await page.route('**/*', route => allowed(route.request()) ? route.continue() : route.abort()); return forbidden;
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!window.readingTest); });
test('real engine paginates, reflows logical KO anchor, routes relocated NAV/NCX; disposal owns listeners and URLs', async ({ page }) => {
  const forbidden = await watch(page);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, outcomes = [];
    for (const [fixture, toc] of [['synthetic', ''], ['closure-review-subdir-toc', '../two.xhtml'], ['closure-subdir-ncx', '../two.xhtml#second'], ['compatibility', ''], ['large-media', ''], ['alice', '']]) {
      const bytes = await (await fetch(`/fixtures/${fixture}.epub`)).arrayBuffer();
      const original = await p.checksum(bytes), host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
      let status: import('../../controller').ReaderStatus = { state: 'opening', message: '' }, publications = 0;
      const reader = new p.ReaderController(host, next => { status = next; }, async () => { publications++; }, { localOnly: fixture !== 'large-media' });
      await reader.open(bytes);
      const initial = status.state;
      if (initial !== 'ready') {
        const message = status.message;
        await reader.dispose(); host.remove();
        throw new Error(`${fixture}: open ${initial}: ${message}`);
      }
      const opened = status.location, openPublications = publications;
      let raster: { size: number[]; complete: boolean; anchor: boolean; visible: boolean } | null = null;
      if (fixture === 'large-media') {
        const frame = host.querySelector('iframe')!, doc = frame.contentDocument!, image = doc.getElementById('large-photo') as HTMLImageElement;
        const origin = frame.getBoundingClientRect(), viewport = host.getBoundingClientRect(), rect = image.getBoundingClientRect();
        raster = {
          size: [image.naturalWidth, image.naturalHeight], complete: image.complete,
          anchor: !!opened && p.primaryElementFromKO(doc, opened.ko) === image,
          visible: rect.right + origin.left > viewport.left && rect.left + origin.left < viewport.right && rect.bottom + origin.top > viewport.top && rect.top + origin.top < viewport.bottom,
        };
        await image.decode();
      }
      if (toc) await reader.toc(toc); else await reader.next();
      const anchor = status.location?.ko, nextPage = status.location?.page, count = publications, nextState = status.state, nextMessage = status.message;
      await reader.reflow(120, 'sans-serif', 'black');
      const retained = status.location?.ko === anchor && publications === count;
      const frame = host.querySelector('iframe')!, sandbox = frame.getAttribute('sandbox'), cspFirst = frame.contentDocument?.head.firstElementChild?.getAttribute('http-equiv');
      const rendered = frame.contentDocument?.body.textContent?.length || 0;
      const unchanged = original === await p.checksum(bytes);
      await reader.dispose(); host.remove();
      const restoreHost = document.createElement('div'); restoreHost.style.cssText = 'width:700px;height:480px'; document.body.appendChild(restoreHost);
      let reopened: import('../../controller').ReaderStatus = { state: 'opening', message: '' };
      const second = new p.ReaderController(restoreHost, next => { reopened = next; }, async () => { publications++; });
      await second.open(bytes, anchor); await second.dispose(); restoreHost.remove();
      outcomes.push({ fixture, initial, openPublications, firstPage: opened?.page, nextPage, state: status.state, anchor, retained, count, publications, reopened, sandbox, cspFirst, unchanged, rendered, raster, nextState, nextMessage });
    }
    return { outcomes, lifecycle: { ...p.lifecycle } };
  });
  for (const row of result.outcomes) {
    expect(row, `${row.fixture}: ${row.nextState}: ${row.nextMessage}`).toMatchObject({ initial: 'ready', openPublications: 0, nextState: 'ready', state: 'ready', retained: true, count: 1, publications: 1, sandbox: 'allow-same-origin', cspFirst: 'Content-Security-Policy', unchanged: true });
    expect(row.anchor).toBeTruthy();
    expect(row.reopened, `${row.fixture}: reopen: ${row.reopened.message}`).toMatchObject({ state: 'ready', location: { ko: row.anchor } });
    expect(row.rendered).toBeGreaterThan(10);
    if (row.fixture === 'large-media') {
      expect(row.raster).toEqual({ size: [2048, 1365], complete: true, anchor: true, visible: true });
      expect([row.firstPage, row.nextPage]).toEqual([1, 2]);
    }
  }
  expect(result.lifecycle.listeners).toBe(0); expect(result.lifecycle.contentListeners).toBe(0); expect(result.lifecycle.engines).toBe(result.lifecycle.destroyed); expect(forbidden).toEqual([]);
});
test('reviewed rawtext, whole-document, structural, CSS/font/SVG and navigation hostile fixtures reject before engines', async ({ page }) => {
  test.setTimeout(240000);
  const forbidden = await watch(page);
  const result = await page.evaluate(async () => {
    const p = window.readingTest;
    const sets = ['closure-rawtext', 'closure-invalid-navigation', 'attacks', 'structures', 'compat-hostile', 'aliases'];
    const fixtures: string[] = [];
    for (const set of sets) { const list = await (await fetch(`/fixtures/${set}.json`)).json(); const prefix = set === 'attacks' ? 'adversarial-' : set === 'structures' || set === 'aliases' ? 'review-' : set === 'compat-hostile' ? 'compat-hostile-' : ''; fixtures.push(...(Array.isArray(list) ? list : Object.keys(list)).map((name: string) => prefix + name)); }
    const failures: { name: string; phase: string }[] = [];
    for (const name of fixtures) {
      const bytes = await (await fetch(`/fixtures/${name.replace(/\.epub$/, '')}.epub`)).arrayBuffer();
      try { const policy = await p.validateEPUB(bytes); policy.dispose(); failures.push({ name, phase: 'validation' }); } catch {}
      const host = document.createElement('div'); document.body.appendChild(host); let state = '';
      const reader = new p.ReaderController(host, next => { state = next.state; }, async () => { failures.push({ name, phase: 'publication' }); });
      await reader.open(bytes); if (state !== 'error') failures.push({ name, phase: 'controller' }); await reader.dispose(); host.remove();
    }
    const doc = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><head><style><![CDATA[/* </style><img src="https://not-allowed.invalid/probe"/> */]]></style></head><body><p>source</p></body></html>', 'application/xhtml+xml');
    let wholeDoc = false; try { p.requireStableBody(doc); } catch { wholeDoc = true; }
    return { count: fixtures.length, failures, engines: p.lifecycle.engines, wholeDoc };
  });
  expect(result.count).toBeGreaterThan(65); expect(result.failures).toEqual([]); expect(result.engines).toBe(0); expect(result.wholeDoc).toBe(true); expect(forbidden).toEqual([]);
});
test('historical child-first reading remains; canonical new writing succeeds and invalid saved positions never publish', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, doc = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><div><blockquote><p id="nested">N</p></blockquote><p id="first">F</p><p id="second">S</p></div></body></html>', 'application/xhtml+xml');
    const original = '/body/DocFragment[1]/body/div[1]/p[2]';
    const chosen = p.elementFromKO(doc, original).id, canonical = p.koFromElement(0, doc.getElementById('first')!);
    const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(), host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host); let publications = 0, state = '';
    const reader = new p.ReaderController(host, next => { state = next.state; }, async () => { publications++; }); await reader.open(bytes, '/body/DocFragment[999]/body'); const failed = state; await reader.dispose(); host.remove();
    return { chosen, canonical, publications, failed, original };
  });
  expect(result).toEqual({ chosen: 'second', canonical: '/body/DocFragment[1]/body/div[1]/p[1]', publications: 0, failed: 'error', original: '/body/DocFragment[1]/body/div[1]/p[2]' });
});
test('worker cancellation and bounded stream abort never return partial original bytes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, bytes = await (await fetch('/fixtures/alice.epub')).arrayBuffer(); const abort = new AbortController();
    const parse = p.checkArchive(bytes, abort.signal); abort.abort(); let cancelled = false; try { await parse; } catch (error) { cancelled = error instanceof DOMException && error.name === 'AbortError'; }
    let pulled = 0, stopped = false; const streamAbort = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); streamAbort.abort(); }, cancel() { stopped = true; } });
    let streamCancelled = false; try { await p.boundedStream(stream, streamAbort.signal); } catch { streamCancelled = true; }
    return { cancelled, streamCancelled, stopped, pulled };
  });
  expect(result.cancelled).toBe(true); expect(result.streamCancelled).toBe(true); expect(result.stopped).toBe(true); expect(result.pulled).toBeLessThan(4);
});
