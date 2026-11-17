import { expect, test, chromium } from '@playwright/test';
import { copyFile, mkdtemp, rm, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
test.use({ trace: 'off' });
test('large local original survives true cold offline processes without the input file or whole-book opening reads', async ({ request }) => {
  test.setTimeout(240000); await request.get('/__test/mode?worker=new');
  const root = fileURLToPath(new URL('../../../../../_scratch/m3/reader/', import.meta.url)), profile = await mkdtemp(resolve(root, 'large-cold-')), input = resolve(profile, 'public-input.epub');
  await copyFile(resolve(root, 'public-300m.epub'), input);
  const launch = () => chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'], viewport: { width: 390, height: 844 } });
  let context = await launch();
  try {
    let page = context.pages()[0]!; await page.goto('http://127.0.0.1:5348/app/'); await expect(page.getByText('Opening your stored library…')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add book', exact: true }).click(); await page.getByLabel('Choose local EPUB').setInputFiles(input); await expect(page.getByText('Book saved.')).toBeVisible({ timeout: 180000 });
    await page.getByRole('link', { name: 'Open book', exact: true }).click(); await page.getByRole('link', { name: 'Resume', exact: true }).first().click();
    const region = page.getByRole('region', { name: 'Book reader', exact: true }); await expect(region).toHaveAttribute('data-reader-state', 'ready');
    await page.getByRole('button', { name: 'Contents', exact: true }).click(); await page.getByRole('button', { name: 'Section 37', exact: true }).click(); await expect(region).toHaveAttribute('data-reader-state', 'ready');
    const path = new URL(page.url()).pathname;
    const checkpoint = async () => page.evaluate(async () => new Promise<{ position: string | null; fraction: number | null }>((resolve, reject) => { const r = indexedDB.open('antholume-reading-v1'); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction('books'), get = tx.objectStore('books').getAll(); get.onsuccess = () => resolve(get.result[0].checkpoint); tx.oncomplete = () => db.close(); }; }));
    const visibleAnchor = async () => page.evaluate(position => {
      const frame = document.querySelector('iframe')!, doc = frame.contentDocument!, namespace = doc.documentElement.namespaceURI, suffix = position!.replace(/^\/body\/DocFragment\[\d+\]\/body/, '');
      const xpath = '/n:html/n:body' + suffix.replace(/\/([a-zA-Z][\w-]*)/g, '/n:$1'), node = doc.evaluate(xpath, doc, () => namespace, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null;
      const origin = frame.getBoundingClientRect(), viewport = document.querySelector('section[aria-label="Book reader"] > div')!.getBoundingClientRect();
      return !!node && [...node.getClientRects()].some(r => r.right + origin.left > viewport.left && r.left + origin.left < viewport.right && r.bottom + origin.top > viewport.top && r.top + origin.top < viewport.bottom);
    }, (await checkpoint()).position);
    await expect.poll(async () => (await checkpoint()).position).toMatch(/^\/body\/DocFragment\[38\]/); const before = await checkpoint();
    await context.close(); await unlink(input); await request.get('/__test/mode?worker=offline');
    context = await launch(); await context.setOffline(true); page = context.pages()[0]!; await page.goto(`http://127.0.0.1:5348${path}`);
    const offline = page.getByRole('region', { name: 'Book reader', exact: true }); await expect(offline).toHaveAttribute('data-reader-state', 'ready');
    const metrics = JSON.parse((await offline.getAttribute('data-reader-metrics'))!); expect(metrics.source.maxRead).toBeLessThanOrEqual(262144); expect(metrics.source.readBytes).toBeLessThan(16 * 1024 * 1024); expect(metrics.cache.peakDOMs).toBeLessThanOrEqual(2);
    expect(await checkpoint()).toEqual(before); expect(await visibleAnchor()).toBe(true);
    const decoded = await page.locator('iframe').evaluate((frame: HTMLIFrameElement) => [...frame.contentDocument!.images].some(image => { if (!image.complete || image.naturalWidth !== 1024) return false; const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8; const cx = canvas.getContext('2d')!; cx.drawImage(image, 0, 0, 8, 8, 0, 0, 8, 8); return [...cx.getImageData(0, 0, 8, 8).data].some((value, index) => index % 4 === 3 && value > 0); })); expect(decoded).toBe(true);
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect.poll(checkpoint).not.toEqual(before); const after = await checkpoint();
    await context.close(); context = await launch(); await context.setOffline(true); page = context.pages()[0]!; await page.goto(`http://127.0.0.1:5348${path}`); await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready'); expect(await checkpoint()).toEqual(after); expect(await visibleAnchor()).toBe(true);
    const eventCount = await page.evaluate(async () => new Promise<number>(resolve => { const r = indexedDB.open('antholume-reading-v1'); r.onsuccess = () => { const db = r.result, tx = db.transaction('events'), q = tx.objectStore('events').count(); q.onsuccess = () => resolve(q.result); tx.oncomplete = () => db.close(); }; })); expect(eventCount).toBe(0);
  } finally { await context.close(); await request.get('/__test/mode?worker=new'); await rm(profile, { recursive: true, force: true }); }
});
