import { expect, test, chromium, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin = 'http://127.0.0.1:5348';
const fixture = fileURLToPath(new URL('../fixtures/synthetic.epub', import.meta.url));
async function state(page: Page) {
  return page.evaluate(async () => {
    const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const names = await indexedDB.databases();
    if (!names.some(d => d.name === 'antholume-app-control-v1') || !names.some(d => d.name === 'antholume-reading-v1')) return { marker: null, books: [], eventIds: [], caches: await caches.keys(), controller: navigator.serviceWorker.controller?.scriptURL };
    const db = await open('antholume-app-control-v1');
    const marker = await new Promise<unknown>((resolve, reject) => { const r = db.transaction('meta').objectStore('meta').get('retirement/legacy-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close();
    const reading = await open('antholume-reading-v1');
    const read = (store: string) => new Promise<unknown[]>((resolve, reject) => { const r = reading.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const books = await read('books') as { key: string; checkpoint: { position: string | null }; availability: string }[], events = await read('events') as { id: string }[]; reading.close();
    return { marker, books, eventIds: events.map(e => e.id), caches: await caches.keys(), controller: navigator.serviceWorker.controller?.scriptURL };
  });
}
async function ready(page: Page) { await expect(page.getByText('Opening your stored library…')).toHaveCount(0); await expect.poll(async () => (await state(page)).marker).toMatchObject({ phase: 'done' }); }

test('actual old root worker retirement selectively cleans its allowlist and preserves unrelated/new pending data', async ({ page, request }) => {
  await request.get('/__test/mode?worker=legacy'); await page.goto('/local');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }); await navigator.serviceWorker.ready; });
  await page.reload();
  await page.evaluate(async () => {
    const old = await caches.open('OFFLINE_V1'); await old.put('/old', new Response('old')); const keep = await caches.open('unrelated-cache'); await keep.put('/keep', new Response('keep'));
    localStorage.setItem('readerSettings', 'legacy'); localStorage.setItem('unrelated-local', 'keep');
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open('keyval-store', 1); r.onupgradeneeded = () => r.result.createObjectStore('keyval'); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval'); for (const key of ['ACTIVITY', `FILE-${'a'.repeat(32)}`, `FILE-METADATA-${'a'.repeat(32)}`, `PROGRESS-${'a'.repeat(32)}`, 'FILE-not-hex', 'unrelated']) store.put('original', key); tx.oncomplete = () => { db.close(); resolve(); }; }; });
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open('antholume-reading-v1', 10); r.onupgradeneeded = () => {
      const schema: Record<string, [string, string[]]> = { books: ['key', ['scope']], events: ['id', ['scope', 'key', 'created']], access: ['key', []], leases: ['scope', []], decisions: ['id', []], conflicts: ['eventId', ['scope', 'key']], heads: ['key', []], meta: ['key', []], history: ['id', ['eventId']] };
      for (const [name, [keyPath, indexes]] of Object.entries(schema)) { const store = r.result.createObjectStore(name, { keyPath }); for (const index of indexes) store.createIndex(index, index); }
    }; r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction('events', 'readwrite'); tx.objectStore('events').add({ id: 'new-pending-must-survive', key: 'new-book', scope: 'retained-account', created: 1, kind: 'activity', payload: { event_id: 'new-pending-must-survive', document_id: 'original-id', device_id: 'owned-device', start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: .1, end_fraction: .2 } }); tx.oncomplete = () => { db.close(); resolve(); }; }; });
  });
  const oldTab = await page.context().newPage(); await oldTab.goto('/reader');
  await request.get('/__test/mode?worker=new'); await page.goto('/app/');
  await ready(page);
  await expect(oldTab).toHaveURL(/\/app\//);
  const result = await page.evaluate(async () => {
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { const r = indexedDB.open('keyval-store'); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction('keyval'), keys = tx.objectStore('keyval').getAllKeys(); keys.onsuccess = () => resolve(keys.result); tx.oncomplete = () => db.close(); }; });
    return { keys, legacySettings: localStorage.getItem('readerSettings'), unrelated: localStorage.getItem('unrelated-local') };
  });
  expect(result).toEqual({ keys: ['FILE-not-hex', 'unrelated'], legacySettings: null, unrelated: 'keep' });
  const durable = await state(page); expect(durable.caches).not.toContain('OFFLINE_V1'); expect(durable.caches).toContain('unrelated-cache'); expect(durable.eventIds).toContain('new-pending-must-survive'); expect(durable.controller).toBe(`${origin}/sw.js`);
  await page.goto('/settings'); await expect(page.getByText('Ordinary SSR remains online')).toBeVisible(); await oldTab.close();
});

test('complete production shell and local book survive new browser processes offline from startup, twice', async ({ request }) => {
  await request.get('/__test/mode?worker=new');
  const parent = process.env.FRAME_LIFECYCLE_SCRATCH || fileURLToPath(new URL('../../../../../_scratch/m3/reader/', import.meta.url));
  const profile = await mkdtemp(resolve(parent, 'cold-profile-'));
  const launch = () => chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  let context = await launch();
  try {
    const readerReady = async (page: Page, font?: string) => {
      const reader = page.getByRole('region', { name: 'Book reader', exact: true });
      await expect(reader).toHaveAttribute('data-reader-state', 'ready');
      await expect.poll(() => reader.evaluate((reader, font) => {
        const frame = reader.querySelector('iframe'), doc = frame?.contentDocument, body = doc?.querySelector('body');
        if (reader.getAttribute('data-reader-state') !== 'ready' || !frame?.src.startsWith('blob:') || doc?.contentType !== 'application/xhtml+xml' || !body?.textContent || doc.fonts.status !== 'loaded') return false;
        if (font && ![...doc.fonts].some(face => face.family === font && face.status === 'loaded')) return false;
        const viewport = reader.querySelector(':scope > div')!.getBoundingClientRect(), origin = frame.getBoundingClientRect();
        return [...doc.images].every(image => {
          const r = image.getBoundingClientRect(), visible = r.right + origin.left > viewport.left && r.left + origin.left < viewport.right && r.bottom + origin.top > viewport.top && r.top + origin.top < viewport.bottom;
          return !visible || image.hasAttribute('src') && image.complete && image.naturalWidth > 0;
        });
      }, font)).toBe(true);
    };
    let page = context.pages()[0]!; await page.goto(`${origin}/app/offline`); await ready(page);
    await page.getByRole('button', { name: 'Import local EPUB', exact: true }).click(); await page.getByLabel('Choose local EPUB').setInputFiles(fixture);
    await expect(page.getByText('Book saved.')).toBeVisible(); await page.getByRole('link', { name: 'Open book', exact: true }).click();
    await page.getByRole('link', { name: 'Resume', exact: true }).first().click();
    await expect(page.locator('iframe')).toHaveCount(1); await readerReady(page); await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
    await page.getByRole('button', { name: 'Reading progress and appearance', exact: true }).click(); await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption('Lato');
    await readerReady(page, 'Lato');
    await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(async () => (await state(page)).books[0]?.checkpoint.position).toMatch(/^\/body\/DocFragment/);
    const path = new URL(page.url()).pathname, first = (await state(page)).books[0]!.checkpoint.position;
    await request.get('/__test/mode?worker=offline');
    await context.close();
    context = await launch(); await context.setOffline(true); page = context.pages()[0]!;
    await page.goto(`${origin}${path}`); await expect(page.locator('iframe')).toHaveCount(1);
    await readerReady(page, 'Lato');
    await expect(page.locator('section[aria-label="Book reader"] footer span')).toHaveText(/\d+ \/ \d+/);
    await expect(page.getByRole('region', { name: 'Book reader', exact: true }).getByRole('alert')).toHaveCount(0);
    // Element Precision - Restoring a paragraph may show its preceding page; two intentional turns must advance beyond it.
    await page.getByRole('button', { name: 'Next page' }).click(); await readerReady(page, 'Lato');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(async () => (await state(page)).books[0]?.checkpoint.position).not.toBe(first);
    const second = (await state(page)).books[0]!.checkpoint.position; expect((await state(page)).eventIds).toEqual([]);
    await context.close(); context = await launch(); await context.setOffline(true); page = context.pages()[0]!;
    await page.goto(`${origin}${path}`); await expect(page.locator('iframe')).toHaveCount(1); await readerReady(page, 'Lato'); expect((await state(page)).books[0]!.checkpoint.position).toBe(second);
    await page.goto(`${origin}/`); await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  } finally { await context.close(); await request.get('/__test/mode?worker=new'); await rm(profile, { recursive: true, force: true }); }
});

test('verified updates wait during reading; failed precache cannot replace the working cache or delete new events', async ({ page, request }) => {
  await request.get('/__test/mode?worker=new'); await page.goto('/app/offline'); await ready(page);
  await page.getByRole('button', { name: 'Import local EPUB', exact: true }).click(); await page.getByLabel('Choose local EPUB').setInputFiles(fixture); await page.getByRole('link', { name: 'Open book', exact: true }).click(); await page.getByRole('link', { name: 'Resume', exact: true }).first().click(); await expect(page.locator('iframe')).toHaveCount(1);
  const before = await state(page);
  await request.get('/__test/mode?worker=bad');
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); await r!.update(); });
  await page.waitForTimeout(1500); expect((await state(page)).caches).toEqual(before.caches);
  await request.get('/__test/mode?worker=update'); await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); await r!.update(); });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.waiting)).toBe(true);
  const attempt = await page.evaluate(async () => {
    const waiting = (await navigator.serviceWorker.getRegistration('/'))!.waiting!, channel = new MessageChannel();
    return await new Promise<string>(resolve => { channel.port1.onmessage = e => { channel.port1.close(); resolve(e.data.type); }; waiting.postMessage({ type: 'APP_ACTIVATE', nonce: 'defer-reading-test' }, [channel.port2]); });
  });
  expect(attempt).toBe('APP_ERROR'); expect((await state(page)).caches).toContain(before.caches.find(n => n.startsWith('antholume-shell-'))!);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await request.get('/__test/mode?worker=new');
});
