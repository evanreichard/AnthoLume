import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';
test('React StrictMode owns actual full-viewport renderer, edge/keyboard/swipe navigation, appearance/reflow and unmount', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => {
    const p = window.readingTest;
    // Shell Coordination Is Separately Tested - Isolate React's StrictMode lifecycle without pretending this dev server is a qualified SW.
    p.WorkerCoordinator.prototype.start = async function () { this.ready = true; };
    const repo = new p.Repository(), ref = { kind: 'local' as const, localId: 'ui-local' }, bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    await p.validateEPUB(bytes); await repo.install(ref, bytes, 'Real local book', null, null); repo.db.close();
    const forbidden = async () => { throw new Error('Local reader must not use bridge'); };
    const bridge: ReadingBridge = { registerDevice: forbidden, getState: forbidden, fetchFile: forbidden, fetchCover: forbidden, submitProgress: forbidden, submitActivity: forbidden };
    p.mount(bridge, ref);
  });
  const region = page.getByRole('region', { name: 'Book reader', exact: true });
  const readerReady = async (font?: string, anchor?: string | null) => {
    await expect(region).toHaveAttribute('data-reader-state', 'ready');
    await expect.poll(() => region.evaluate((reader, { font, anchor }) => {
      const frame = reader.querySelector('iframe'), doc = frame?.contentDocument, body = doc?.querySelector('body');
      if (reader.getAttribute('data-reader-state') !== 'ready' || !frame?.src.startsWith('blob:') || doc?.contentType !== 'application/xhtml+xml' || !body?.textContent || doc.fonts.status !== 'loaded') return false;
      if (font && ![...doc.fonts].some(face => face.family === font && face.status === 'loaded')) return false;
      const viewport = reader.querySelector(':scope > div')!.getBoundingClientRect(), origin = frame.getBoundingClientRect();
      const visible = (element: Element) => [...element.getClientRects()].some(r => r.right + origin.left > viewport.left && r.left + origin.left < viewport.right && r.bottom + origin.top > viewport.top && r.top + origin.top < viewport.bottom);
      if ([...doc.images].some(image => visible(image) && (!image.hasAttribute('src') || !image.complete || !image.naturalWidth))) return false;
      if (!anchor) return [...body.children].some(visible);
      const target = window.readingTest.primaryElementFromKO(doc, anchor);
      return !!target && visible(target);
    }, { font, anchor })).toBe(true);
  };
  await expect(page.locator('iframe')).toHaveCount(1); await readerReady();
  await expect(page.locator('footer span')).toHaveText(/\d+ \/ \d+/);
  const checkpoint = () => page.evaluate(async () => { const db = new window.readingTest.ReadingDB(); const book = (await db.books.toArray())[0]!; db.close(); return book.checkpoint; });
  await page.getByRole('button', { name: 'Next page' }).click(); await expect.poll(async () => (await checkpoint()).position).toMatch(/^\/body\/DocFragment/); const first = await checkpoint();
  await readerReady(undefined, first.position);
  await page.keyboard.press('ArrowRight'); await expect.poll(checkpoint).not.toEqual(first); const second = await checkpoint();
  await readerReady(undefined, second.position);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click(); await page.getByLabel('Theme').selectOption('black'); await readerReady(); await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption('Lato'); await readerReady('Lato', second.position); await page.getByLabel('Size').fill('120'); await readerReady('Lato', second.position); await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await checkpoint()).toEqual(second);
  await page.setViewportSize({ width: 720, height: 1000 }); await page.waitForTimeout(400); await readerReady('Lato', second.position); expect(await checkpoint()).toEqual(second);
  const metrics = await page.evaluate(() => { const reader = document.querySelector('section[aria-label="Book reader"]')!, frame = reader.querySelector('iframe')!; return { rootHeight: reader.getBoundingClientRect().height, height: innerHeight, scroll: frame.contentDocument!.documentElement.scrollHeight, viewport: frame.clientHeight }; });
  expect(metrics.rootHeight).toBe(metrics.height);
  await readerReady('Lato', second.position);
  const viewport = await region.locator(':scope > div').first().boundingBox(); await page.mouse.click(viewport!.x + viewport!.width * .9, viewport!.y + viewport!.height * .5);
  await expect.poll(checkpoint).not.toEqual(second); const third = await checkpoint(); await readerReady('Lato', third.position);
  await page.frameLocator('iframe').locator('body').evaluate(() => { const target = document.body; target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, changedTouches: [new Touch({ identifier: 1, target, screenX: 600, screenY: 300 })] })); target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [new Touch({ identifier: 1, target, screenX: 100, screenY: 300 })] })); });
  await expect.poll(checkpoint).not.toEqual(third); await readerReady('Lato', (await checkpoint()).position);
  await page.evaluate(() => window.readingTest.unmount()); await expect(page.locator('iframe')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ listeners: window.readingTest.lifecycle.listeners, content: window.readingTest.lifecycle.contentListeners, engines: window.readingTest.lifecycle.engines - window.readingTest.lifecycle.destroyed }))).toEqual({ listeners: 0, content: 0, engines: 0 });
  expect(await page.evaluate(async () => { const db = new window.readingTest.ReadingDB(); const count = await db.events.count(); await db.delete(); return count; })).toBe(0);
});
test('real visible-word forward-turn capture credits before navigation; previous/reflow/TOC/open give no extra credit', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(), host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    const captures: import('../../controller').CapturedActivity[] = []; let publications = 0; const order: string[] = [];
    let status: import('../../controller').ReaderStatus = { state: 'opening', message: '' };
    const reader = new p.ReaderController(host, next => { status = next; }, async () => { order.push('progress'); publications++; }, { credit: async capture => { order.push('activity'); captures.push(capture); } });
    await reader.open(bytes); const realNow = Date.now; Date.now = () => realNow() + 30000;
    try { await reader.next(); await reader.previous(); await reader.reflow(110); if (status.toc?.[0]) await reader.toc(status.toc[0].href); }
    finally { Date.now = realNow; await reader.dispose(); host.remove(); }
    return { captures, publications, order };
  });
  expect(result.captures).toHaveLength(1); expect(result.captures[0]!.duration).toBeGreaterThan(0); expect(result.captures[0]!.pages).toBeGreaterThan(0); expect(result.order.slice(0, 2)).toEqual(['activity', 'progress']); expect(result.publications).toBe(3);
});
test('native wake lock cleanup releases a late acquisition and removes its visibility listener', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    let complete!: (value: WakeLockSentinel) => void, releases = 0, requests = 0;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => { requests++; return new Promise<WakeLockSentinel>(resolve => { complete = resolve; }); } } });
    const lock = new window.readingTest.ReaderWakeLock(); lock.interact(); lock.dispose(); complete({ release: async () => { releases++; }, addEventListener: () => {} } as unknown as WakeLockSentinel);
    await new Promise(resolve => setTimeout(resolve, 0)); document.dispatchEvent(new Event('visibilitychange'));
    return { requests, releases };
  });
  expect(result).toEqual({ requests: 1, releases: 1 });
});
