import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';
test('React StrictMode owns actual full-viewport renderer, edge/keyboard/swipe navigation, appearance/reflow and unmount', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => {
    const p = window.readingTest;
    // Shell Coordination Is Separately Tested - Isolate React's StrictMode lifecycle without pretending this dev server is a qualified SW.
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
  const contents = region.getByRole('button', { name: 'Contents', exact: true });
  const appearance = region.getByRole('button', { name: 'Reading Progress and Appearance', exact: true });
  const next = region.getByRole('button', { name: 'Next Page', exact: true });
  await expect(contents).toBeHidden();
  const center = async () => {
    const box = (await region.boundingBox())!;
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  };
  await center();
  await expect(contents).toBeVisible(); await expect(appearance).toBeVisible(); await expect(next).toBeVisible();
  await expect.poll(() => region.evaluate(reader => {
    const [topEdge, bottomEdge] = ['Top', 'Bottom'].map(edge => reader.querySelector(`[class*="edgePaint${edge}"]`)!.getBoundingClientRect());
    const pills = [...reader.querySelectorAll('header button, footer')];
    const pixel = document.createElement('canvas').getContext('2d')!;
    return pills.every(pill => {
      const rect = pill.getBoundingClientRect(), css = getComputedStyle(pill);
      pixel.clearRect(0, 0, 1, 1);
      pixel.fillStyle = css.backgroundColor;
      pixel.fillRect(0, 0, 1, 1);
      const alpha = pixel.getImageData(0, 0, 1, 1).data[3]!;
      return rect.top > topEdge!.bottom && rect.bottom < bottomEdge!.top && css.backdropFilter.includes('blur(') &&
        getComputedStyle(pill.closest('header, footer')!).opacity === '1' && alpha > 0 && alpha < 128;
    });
  })).toBe(true);
  await expect(contents).toBeHidden({ timeout: 6500 }); await expect(next).toBeHidden();
  await page.keyboard.press('c');
  await expect(region.getByRole('button', { name: 'Library' })).toBeFocused();
  await expect(next).toBeVisible();
  await expect(page.locator('footer span')).toHaveText(/\d+ \/ \d+/);
  const checkpoint = () => page.evaluate(async () => { const db = new window.readingTest.ReadingDB(); const book = (await db.books.toArray())[0]!; db.close(); return book.checkpoint; });
  await next.click(); await expect.poll(async () => (await checkpoint()).position).toMatch(/^\/body\/DocFragment/); const first = await checkpoint();
  await readerReady(undefined, first.position);
  await page.keyboard.press('ArrowRight'); await expect.poll(checkpoint).not.toEqual(first); const second = await checkpoint();
  await readerReady(undefined, second.position);
  await appearance.click(); await page.getByRole('button', { name: /Night/ }).click(); await expect(page.getByRole('button', { name: /Night/ })).toHaveAttribute('aria-pressed', 'true'); await readerReady(); await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption('Lato'); await readerReady('Lato', second.position); await page.getByRole('slider').fill('120');
  await expect.poll(() => page.frameLocator('iframe').locator('body').evaluate(body => parseFloat(getComputedStyle(body).fontSize) / parseFloat(getComputedStyle(body.ownerDocument.documentElement).fontSize))).toBeCloseTo(1.2);
  await readerReady('Lato', second.position); await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await checkpoint()).toEqual(second);
  const resized = await region.evaluateHandle(reader => ({ done: new Promise<void>(resolve => {
    const observer = new MutationObserver(changes => {
      if (innerWidth === 720 && innerHeight === 1000 && reader.getAttribute('data-reader-state') === 'ready' && changes.some(change => change.oldValue === 'opening')) {
        observer.disconnect(); resolve();
      }
    });
    observer.observe(reader, { attributes: true, attributeOldValue: true, attributeFilter: ['data-reader-state'] });
  }) }));
  await page.setViewportSize({ width: 720, height: 1000 }); await resized.evaluate(wait => wait.done);
  await readerReady('Lato', second.position); expect(await checkpoint()).toEqual(second);
  const metrics = await page.evaluate(() => { const reader = document.querySelector('section[aria-label="Book reader"]')!, frame = reader.querySelector('iframe')!; return { rootHeight: reader.getBoundingClientRect().height, height: innerHeight, scroll: frame.contentDocument!.documentElement.scrollHeight, viewport: frame.clientHeight }; });
  expect(metrics.rootHeight).toBe(metrics.height);
  await readerReady('Lato', second.position);
  const viewport = await region.locator(':scope > div').first().boundingBox(); await page.mouse.click(viewport!.x + viewport!.width * .9, viewport!.y + viewport!.height * .5);
  await expect.poll(checkpoint).not.toEqual(second); const third = await checkpoint(); await readerReady('Lato', third.position);
  await page.frameLocator('iframe').locator('body').evaluate(() => { const target = document.body; const start = new Touch({ identifier: 1, target, clientX: 600, clientY: 300 }); target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] })); target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [new Touch({ identifier: 1, target, clientX: 100, clientY: 300 })] })); });
  await expect.poll(checkpoint).not.toEqual(third); await readerReady('Lato', (await checkpoint()).position);
  expect(await page.evaluate(() => [document.body.style.backgroundColor, document.documentElement.style.backgroundColor])).toEqual(['rgb(18, 18, 18)', 'rgb(18, 18, 18)']);
  for (const edge of ['Top', 'Bottom']) {
    const strip = region.locator(`[class*="edgePaint${edge}"]`);
    await expect(strip).toHaveCSS('background-color', 'rgb(18, 18, 18)');
    expect(await strip.evaluate((element, edge) => {
      const rect = element.getBoundingClientRect();
      return getComputedStyle(element).position === 'fixed' && rect.left === 0 && rect.right === innerWidth &&
        (edge === 'Top' ? rect.top === 0 : rect.bottom === innerHeight);
    }, edge)).toBe(true);
  }
  await page.evaluate(() => window.readingTest.unmount()); await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => [document.body.style.backgroundColor, document.documentElement.style.backgroundColor])).toEqual(['', '']);
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
    const lock = new window.readingTest.ReaderWakeLock(); lock.interact(); lock.dispose();
    await new Promise<void>(released => complete({ release: async () => { releases++; released(); }, addEventListener: () => {} } as unknown as WakeLockSentinel));
    document.dispatchEvent(new Event('visibilitychange'));
    return { requests, releases };
  });
  expect(result).toEqual({ requests: 1, releases: 1 });
});
