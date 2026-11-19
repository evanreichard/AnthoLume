import { expect, test } from '@playwright/test';

test('fractional viewport opens decoded visible assets and same-session reflow keeps the character page', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const api = window.readingTest;
    const zip = await api.JSZip.loadAsync(await (await fetch('/fixtures/synthetic.epub')).blob());
    zip.file('one.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Character anchor</title></head><body><h1>Character anchor</h1><img src="pixel.png" width="40" height="40"/><p>${'A single long paragraph spans many pages without a new element anchor. '.repeat(500)}</p></body></html>`);
    const file = await zip.generateAsync({ type: 'blob' });
    const host = document.createElement('div');
    host.style.cssText = 'width:390px;height:656.8125px'; document.body.append(host);
    let status: import('../../controller').ReaderStatus = { state: 'opening', message: '' };
    const publications: import('../../controller').ReaderSnapshot[] = [];
    const before = { ...api.lifecycle };
    const reader = new api.ReaderController(host, value => { status = value; }, async location => { publications.push(location); }, { localOnly: true });
    const snapshot = () => {
      if (status.state !== 'ready' || !status.location) throw new Error(status.message);
      if (!host.querySelector('iframe')?.contentDocument) throw new Error('Ready reader lost its frame');
      return { ...status.location };
    };
    try {
      await reader.open(file);
      const opened = snapshot(), frame = host.querySelector('iframe')!, image = frame.contentDocument!.querySelector('img')!;
      const viewport = host.getBoundingClientRect(), origin = frame.getBoundingClientRect(), rect = image.getBoundingClientRect();
      const visibleImage = { decoded: image.complete && image.naturalWidth > 0, visible: rect.right + origin.left > viewport.left && rect.left + origin.left < viewport.right && rect.bottom + origin.top > viewport.top && rect.top + origin.top < viewport.bottom, type: await (await fetch(image.src)).blob().then(blob => blob.type) };
      await reader.next(); const turned = snapshot();
      const reflows = [];
      for (let i = 0; i < 3; i++) { await reader.reflow(100); reflows.push(snapshot()); }
      const passiveWrites = publications.length;
      await reader.next(); const next = snapshot();
      await reader.dispose();
      return { opened, visibleImage, turned, reflows, passiveWrites, next, publications, cleanup: { engines: api.lifecycle.engines - before.engines, destroyed: api.lifecycle.destroyed - before.destroyed, listeners: api.lifecycle.listeners - before.listeners, contentListeners: api.lifecycle.contentListeners - before.contentListeners }, frames: host.querySelectorAll('iframe').length };
    } finally { await reader.dispose(); host.remove(); }
  });
  expect(result.opened.page).toBe(1);
  expect(result.visibleImage).toEqual({ decoded: true, visible: true, type: 'image/png' });
  expect(result.turned.page).toBe(2);
  expect(result.turned.cfi).toMatch(/:\d+/);
  for (const reflow of result.reflows) expect(reflow).toEqual(result.turned);
  expect(result.passiveWrites).toBe(1);
  expect(result.next.page).toBe(3);
  expect(result.publications).toEqual([result.turned, result.next]);
  expect(result.cleanup).toEqual({ engines: 1, destroyed: 1, listeners: 0, contentListeners: 0 });
  expect(result.frames).toBe(0);
});
