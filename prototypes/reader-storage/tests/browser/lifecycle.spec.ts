import { test, expect } from '@playwright/test';

test('engine teardown returns real global listener and object-URL counts to baseline after repeated mounts', async ({ page }) => {
  await page.addInitScript(() => {
    const urls = new Set<string>();
    const listeners: { target: EventTarget; type: string; callback: EventListenerOrEventListenerObject | null; capture: boolean }[] = [];
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const watched = new Set(['keydown', 'resize', 'orientationchange', 'orientationChange', 'unload', 'visibilitychange']);
    EventTarget.prototype.addEventListener = function(type, callback, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      if ((this === window || this === document) && watched.has(type) && !listeners.some(x => x.target === this && x.type === type && x.callback === callback && x.capture === capture)) listeners.push({ target: this, type, callback, capture });
      return add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function(type, callback, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      const index = listeners.findIndex(x => x.target === this && x.type === type && x.callback === callback && x.capture === capture);
      if (index !== -1) listeners.splice(index, 1);
      return remove.call(this, type, callback, options);
    };
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = value => { const url = create(value); urls.add(url); return url; };
    URL.revokeObjectURL = value => { urls.delete(value); revoke(value); };
    Object.defineProperty(window, 'resourceEvidence', { value: () => ({ urls: urls.size, listeners: listeners.map(x => x.type).sort() }) });
  });
  await page.goto('/');
  const evidence = () => page.evaluate(() => (window as unknown as { resourceEvidence(): { urls: number; listeners: string[] } }).resourceEvidence());
  const baseline = await evidence();
  for (const name of ['Open synthetic EPUB', 'Open synthetic EPUB', 'Open representative EPUB']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('data-state', 'ready');
    expect((await evidence()).urls).toBeGreaterThan(baseline.urls);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByRole('button', { name: 'Unmount reader' }).click();
    await expect.poll(() => page.evaluate(() => window.proof.lifecycle.engines === window.proof.lifecycle.destroyed)).toBe(true);
    await expect.poll(evidence).toEqual(baseline);
  }
  expect(await page.locator('iframe').count()).toBe(0);
  expect(await page.evaluate(() => window.proof.lifecycle.contentListeners)).toBe(0);
});

test('ten real engine commands serialize; disposal during open/navigation suppresses late publications', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const p = window.proof;
    const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    const host = document.createElement('div'); host.style.cssText = 'height:480px;width:700px'; document.body.appendChild(host);
    const publications: string[] = [];
    let disposed = false, lateUpdates = 0;
    const reader = new p.ReaderController(host, () => { if (disposed) lateUpdates++; }, async location => { if (disposed) lateUpdates++; publications.push(location.cfi); });
    await reader.open(bytes);
    await Promise.all(Array.from({ length: 10 }, () => reader.next()));
    const count = publications.length, unique = new Set(publications).size;
    const pending = reader.next();
    disposed = true;
    await reader.dispose(); await pending;
    const cancelled = new p.ReaderController(host, () => { lateUpdates++; }, async () => { lateUpdates++; });
    const opening = cancelled.open(bytes);
    await cancelled.dispose(); await opening;
    host.remove();
    return { count, unique, lateUpdates, finalCount: publications.length, engines: p.lifecycle.engines, destroyed: p.lifecycle.destroyed, listeners: p.lifecycle.listeners, contentListeners: p.lifecycle.contentListeners };
  });
  expect(result).toEqual({ count: 10, unique: 10, lateUpdates: 0, finalCount: 10, engines: 1, destroyed: 1, listeners: 0, contentListeners: 0 });
});
