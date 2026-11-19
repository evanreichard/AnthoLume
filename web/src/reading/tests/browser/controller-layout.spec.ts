import { expect, test } from '@playwright/test';

test('public TOC selects visible content and reflow retains logical anchors without passive publication', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, file = await (await fetch('/fixtures/synthetic.epub')).blob();
    const host = document.createElement('div'); host.style.cssText = 'width:390px;height:700px'; document.body.append(host);
    let status: import('../../controller').ReaderStatus = { state: 'opening', message: '' };
    const publications: string[] = [], raw = '/body/DocFragment[1]/body/p[12]/text()[1].23';
    const reader = new p.ReaderController(host, value => { status = value; }, async location => { publications.push(location.ko); }, { localOnly: true });
    const snapshot = () => {
      if (status.state !== 'ready' || !status.location) throw new Error(status.message);
      const frame = host.querySelector('iframe')!, doc = frame.contentDocument!;
      const element = p.primaryElementFromKO(doc, status.location.ko);
      const origin = frame.getBoundingClientRect(), viewport = host.getBoundingClientRect();
      return { ...status.location, primaryVisible: !!element && [...element.getClientRects()].some(r => r.right + origin.left > viewport.left && r.left + origin.left < viewport.right && r.bottom + origin.top > viewport.top && r.top + origin.top < viewport.bottom) };
    };
    try {
      await reader.open(file, raw); const opened = snapshot();
      await reader.reflow(130, 'sans-serif'); const restored = snapshot(), passiveWrites = publications.length;
      await reader.toc('two.xhtml'); const toc = snapshot();
      await reader.reflow(200); const reflowed = snapshot();
      host.style.cssText = 'width:844px;height:330px';
      await reader.reflow(200); const landscape = snapshot();
      return { raw, opened, restored, passiveWrites, toc, reflowed, landscape, publications };
    } finally { await reader.dispose(); host.remove(); }
  });
  expect(result.opened.ko).toBe(result.raw);
  expect(result.restored).toMatchObject({ ko: result.raw, cfi: result.opened.cfi, primaryVisible: true });
  expect(result.passiveWrites).toBe(0);
  expect(result.toc.ko).toMatch(/^\/body\/DocFragment\[2\]\/body\//);
  expect(result.toc.primaryVisible).toBe(true);
  for (const location of [result.reflowed, result.landscape]) {
    expect(location).toMatchObject({ ko: result.toc.ko, cfi: result.toc.cfi, chapter: result.toc.chapter, fraction: result.toc.fraction, primaryVisible: true });
  }
  expect(result.reflowed.pages).toBeGreaterThan(result.toc.pages);
  expect(result.landscape.pages).not.toBe(result.reflowed.pages);
  expect(result.publications).toEqual([result.toc.ko]);
});
