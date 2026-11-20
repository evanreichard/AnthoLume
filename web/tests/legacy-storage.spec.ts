import { test, expect } from './fixtures';

const bookId = '00000000000000000000000000000001';

test('app startup waits for neither a legacy connection nor migration, and deletes only the legacy database', async ({ page, context, server }) => {
  const oldTab = await context.newPage();
  await oldTab.goto(`${server.origin}/assets/manifest.json`);
  await oldTab.evaluate(async id => {
    function seed(name: string, entries: [string, unknown][]) {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('keyval');
          for (const [key, value] of entries) store.put(value, key);
        };
        request.onsuccess = () => resolve(request.result);
      });
    }
    (await seed('unrelated-data', [['keep', 'preserved']])).close();
    const legacy = await seed('keyval-store', [
      [`FILE-${id}`, new Blob(['original EPUB'])],
      [`PROGRESS-${id}`, { percentage: 0.5 }],
      ['ACTIVITY', [{ duration: 30 }]],
    ]);
    legacy.onversionchange = () => { document.title = 'Legacy deletion requested'; };
  }, bookId);

  await page.goto(`${server.origin}/login`);
  await expect(oldTab).toHaveTitle('Legacy deletion requested');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await oldTab.close();
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).map(db => db.name).sort())).toEqual(['antholume-reading-v1', 'unrelated-data']);
  expect(await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('unrelated-data');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('keyval');
      const result = tx.objectStore('keyval').get('keep');
      tx.oncomplete = () => { db.close(); resolve(result.result); };
      tx.onerror = () => reject(tx.error);
    };
  }))).toBe('preserved');
});
