import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';
test('reflow refreshes derived pages while retaining logical anchor with no publication', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, file = await (await fetch('/fixtures/synthetic.epub')).blob(), host = document.createElement('div'); host.style.cssText = 'width:390px;height:700px'; document.body.appendChild(host);
    let current: import('../../controller').ReaderStatus = { state: 'opening', message: '' }, events = 0;
    const reader = new p.ReaderController(host, value => { current = value; }, async () => { events++; }, { localOnly: true }); await reader.open(file); const before = { ...current.location! };
    await reader.reflow(200); const after = { ...current.location! }, type = host.querySelector('iframe')!.contentDocument!.contentType;
    host.style.cssText = 'width:844px;height:330px'; await reader.reflow(200); const landscape = { ...current.location! };
    await reader.dispose(); host.remove(); return { before, after, landscape, events, type };
  });
  expect(result.type).toBe('application/xhtml+xml'); expect(result.after.pages).toBeGreaterThan(result.before.pages); expect(result.landscape.pages).not.toBe(result.after.pages);
  expect(result.after.ko).toBe(result.before.ko); expect(result.after.cfi).toBe(result.before.cfi); expect(result.landscape.ko).toBe(result.before.ko); expect(result.events).toBe(0);
});
for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) test(`reader page buttons have >=44px hit targets at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport); await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => { const p = window.readingTest; p.WorkerCoordinator.prototype.start = async function () { this.ready = true; }; const repo = new p.Repository(), ref = { kind: 'local' as const, localId: 'targets' }; await repo.install(ref, await (await fetch('/fixtures/synthetic.epub')).blob(), null, null, null); repo.db.close(); const noHTTP = async () => { throw new Error('Local book has no bridge dependency'); }; const bridge: ReadingBridge = { getState: noHTTP, registerDevice: noHTTP, fetchFile: noHTTP, fetchCover: noHTTP, submitActivity: noHTTP, submitProgress: noHTTP }; p.mount(bridge, ref); });
  await expect(page.locator('section[aria-label="Book reader"]')).toHaveAttribute('data-reader-state', 'ready');
  for (const name of ['Previous page', 'Next page']) { const button = page.getByRole('button', { name, exact: true }), box = await button.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44); const hit = await button.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }); expect(hit).toBe(true); }
  const before = await page.locator('footer span').innerText();
  const center = await page.getByRole('region', { name: 'Book reader', exact: true }).evaluate(element => { const header = element.querySelector('header')!.getBoundingClientRect(), footer = element.querySelector('footer')!.getBoundingClientRect(); return (header.bottom + footer.top) / 2; });
  await page.mouse.click(viewport.width * .9, center); await expect(page.locator('footer span')).not.toHaveText(before);
  await page.mouse.click(viewport.width * .1, center); await expect(page.locator('footer span')).toHaveText(before);
});

test('canonical new paragraph/anchored-image positions restore visible source nodes without rewriting incoming checkpoints', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => {
    const p = window.readingTest; p.WorkerCoordinator.prototype.start = async function () { this.ready = true; };
    const zip = await p.JSZip.loadAsync(await (await fetch('/fixtures/synthetic.epub')).arrayBuffer()), chapter = await zip.file('one.xhtml')!.async('string'), nav = await zip.file('nav.xhtml')!.async('string');
    zip.file('one.xhtml', chapter.replace('</body>', '<div><blockquote><p>Nested source paragraph.</p></blockquote><p id="unsafe">First child-axis paragraph. <a href="one.xhtml#anchored">Jump to image</a></p><p>Second child-axis paragraph.</p><h1><a><img id="anchored" src="pixel.png" width="16" height="8"/></a></h1></div></body>')); zip.file('nav.xhtml', nav.replace('</ol>', '<li><a href="one.xhtml#unsafe">Canonical source anchor</a></li><li><a href="one.xhtml#anchored">Anchored image</a></li></ol>'));
    const repo = new p.Repository(), ref = { kind: 'local' as const, localId: 'ambiguous-recovery' }; await repo.install(ref, await zip.generateAsync({ type: 'blob' }), null, null, null); await repo.save(ref, { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }); repo.db.close();
    const noHTTP = async () => { throw new Error('Local book has no bridge dependency'); }; const bridge: ReadingBridge = { getState: noHTTP, registerDevice: noHTTP, fetchFile: noHTTP, fetchCover: noHTTP, submitActivity: noHTTP, submitProgress: noHTTP }; p.mount(bridge, ref);
  });
  const region = page.getByRole('region', { name: 'Book reader', exact: true }); await expect(region).toHaveAttribute('data-reader-state', 'ready');
  const read = () => page.evaluate(async () => { const repo = new window.readingTest.Repository(), row = (await repo.db.books.toArray())[0]!, events = await repo.db.events.count(); repo.db.close(); return { checkpoint: row.checkpoint, events }; });
  expect(await read()).toEqual({ checkpoint: { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }, events: 0 });
  await page.keyboard.press('c');
  for (const [name, path] of [['Canonical source anchor', '/body/DocFragment[1]/body/div[2]/p[1]'], ['Anchored image', '/body/DocFragment[1]/body/div[2]/h1[1]/a[1]/img[1]']]) {
    await page.getByRole('button', { name: 'Contents', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await expect.poll(async () => (await read()).checkpoint.position).toBe(path); await expect(region).toHaveAttribute('data-reader-state', 'ready');
    const visible = await page.evaluate(path => { const frame = document.querySelector('iframe')!, doc = frame.contentDocument!, node = window.readingTest.primaryElementFromKO(doc, path)!, origin = frame.getBoundingClientRect(), viewport = document.querySelector('section[aria-label="Book reader"] > div')!.getBoundingClientRect(); return [...node.getClientRects()].some(r => r.right + origin.left > viewport.left && r.left + origin.left < viewport.right && r.bottom + origin.top > viewport.top && r.top + origin.top < viewport.bottom); }, path); expect(visible).toBe(true);
  }
  const back = page.getByRole('button', { name: 'Back to previous spot', exact: true });
  const chapterAnchor = '/body/DocFragment[1]/body/div[2]/p[1]';
  const originalAnchor = '/body/DocFragment[1]/body/h1';
  await back.click();
  await expect.poll(async () => (await read()).checkpoint.position).toBe(chapterAnchor);
  await page.frameLocator('iframe').getByRole('link', { name: 'Jump to image' }).click();
  await expect.poll(async () => (await read()).checkpoint.position).toBe('/body/DocFragment[1]/body/div[2]/h1[1]/a[1]/img[1]');
  await back.click();
  await expect.poll(async () => (await read()).checkpoint.position).toBe(chapterAnchor);
  await back.click();
  await expect.poll(async () => (await read()).checkpoint.position).toBe(originalAnchor);
  await expect(back).toHaveCount(0);
  expect((await read()).events).toBe(0);
});

test('opening a stored EPUB logs one local summary of discarded CSS', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const collected: Promise<unknown[]>[] = [];
  page.on('console', message => {
    if (message.type() === 'warning' && message.text().startsWith('[AnthoLume reader] Skipped unsupported EPUB styling')) {
      collected.push(Promise.all(message.args().map(arg => arg.jsonValue())));
    }
  });
  const result = await page.evaluate(async () => {
    const p = window.readingTest;
    const zip = await p.JSZip.loadAsync(await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    const chapter = Object.keys(zip.files).find(name => name.endsWith('one.xhtml'))!;
    const source = await zip.file(chapter)!.async('string');
    zip.file(chapter, source.replace('</body>', '<p id="css-diag" style="private-unknown:1;color:rgb(12,34,56);margin:future(2px)">Sample</p></body>'));
    const blob = await zip.generateAsync({ type: 'blob' });
    const policy = await p.validateEPUB(blob), manifest = policy.manifest; policy.dispose();
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    let state = '';
    const reader = new p.ReaderController(host, status => { state = status.state; }, async () => {});
    try {
      await reader.open(blob, undefined, undefined, manifest);
      const node = host.querySelector('iframe')?.contentDocument?.getElementById('css-diag');
      return { state, style: node?.getAttribute('style') };
    } finally { await reader.dispose(); host.remove(); }
  });
  const warnings = await Promise.all(collected);
  expect(result).toEqual({ state: 'ready', style: 'color:rgb(12,34,56)' });
  expect(warnings).toEqual([['[AnthoLume reader] Skipped unsupported EPUB styling', { unsupportedFunction: 1, unsupportedDeclaration: 1 }]]);
});

test('native XHTML preserves XML-only body trees and passive compatibility without admitting live external navigation', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const requests: string[] = []; await page.route('https://passive-external.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  const result = await page.evaluate(async () => {
    const p = window.readingTest, bytes = await (await fetch('/fixtures/compat-hostile-html-tree-repair.epub')).arrayBuffer(), zip = await p.JSZip.loadAsync(bytes);
    const chapter = Object.keys(zip.files).find(name => name.endsWith('one.xhtml'))!;
    const original = await zip.file(chapter)!.async('string'); zip.file(chapter, original.replace('</body>', '<samp id="antholume-reader-fonts">Plain sample</samp><a id="external" href="https://passive-external.invalid/path">Reference</a></body>'));
    const blob = await zip.generateAsync({ type: 'blob' }), policy = await p.validateEPUB(blob), source = await policy.document(chapter), host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    let events = 0; const reader = new p.ReaderController(host, () => {}, async () => { events++; }); await reader.open(blob);
    const frame = host.querySelector('iframe')!, doc = frame.contentDocument!, link = doc.getElementById('external')!;
    const tree = (node: Node): unknown => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE ? node.textContent : node.nodeType === Node.ELEMENT_NODE ? [(node as Element).namespaceURI, (node as Element).localName, (node as Element).id, [...node.childNodes].filter(n => n.nodeType !== Node.COMMENT_NODE).map(tree)] : null;
    const unchanged = JSON.stringify(tree(source.body)) === JSON.stringify(tree(doc.body)), inert = link.getAttribute('href')!.startsWith('#antholume-unavailable-'); (link as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 30)); await reader.dispose(); policy.dispose(); host.remove(); return { unchanged, inert, events, type: doc.contentType };
  });
  expect(result).toEqual({ unchanged: true, inert: true, events: 0, type: 'application/xhtml+xml' }); expect(requests).toEqual([]);
});
