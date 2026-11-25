import { createHash } from 'node:crypto';
import { expect, register, test } from './fixtures';

test('KO progress without a device ID can be resumed and does not create a manageable device', async ({
  page,
  server,
}) => {
  const user = 'optional-device';
  await register(page, server.origin, user);
  const position = '/body/DocFragment[1]/body/p[20]';
  const write = await page.request.put(`${server.origin}/api/ko/syncs/progress`, {
    headers: { 'x-auth-user': user, 'x-auth-key': createHash('md5').update('synthetic-public-password').digest('hex') },
    data: { document: 'book_001', percentage: 0.3, progress: position, device: 'KO reader' },
  });
  expect(write.status()).toBe(200);
  const state = await page.request.get(`${server.origin}/api/v1/me/reading-state/book_001`);
  expect(await state.json()).toMatchObject({ device_id: null, position });
  await page.goto(`${server.origin}/settings`);
  await expect(page.getByRole('region', { name: 'Devices' })).toContainText('No devices yet.');
  await page.goto(`${server.origin}/library`);
  await page.getByRole('region', { name: 'Continue reading' }).getByRole('link', { name: 'Resume' }).click();
  await expect(page.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
});

test('Read opens online and revalidates the browser EPUB cache without transferring it again', async ({
  page,
  server,
}) => {
  await register(page, server.origin, 'online-reader');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const reader = page.getByRole('region', { name: 'Book reader', exact: true });
  for (const status of [200, 304]) {
    const file = page.waitForResponse((response) => /\/api\/v1\/documents\/[^/]+\/file$/.test(response.url()));
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    expect((await file).status()).toBe(status);
    await expect(reader).toHaveAttribute('data-reader-state', 'ready');
    await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter' })).toBeVisible();
    await page.goBack();
  }
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
});

test('saved theme is already active while the EPUB is downloading', async ({ page, context, server }) => {
  await register(page, server.origin, 'themed-reader');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('antholume-reading-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key: 'appearance', value: { theme: 'black', font: 'serif', size: 100 } });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditionsByRule', {
    offline: false,
    matchedNetworkConditions: [
      {
        urlPattern: `${server.origin}/api/v1/documents/*/file`,
        latency: 0,
        downloadThroughput: 1024,
        uploadThroughput: -1,
      },
    ],
  });
  try {
    await page.getByRole('link', { name: 'Read', exact: true }).click();
    const progress = page.getByRole('progressbar', { name: 'EPUB download progress' });
    await expect(progress).toBeVisible();
    await expect(
      page.getByText('Downloading EPUB…', { exact: true }).and(page.locator('span[aria-hidden="true"]')),
    ).toBeVisible();
    await expect(progress).toHaveAttribute('max', /[1-9]\d*/);
    await expect(page.getByRole('region', { name: 'Book reader' })).toHaveCSS('background-color', 'rgb(18, 18, 18)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121212');
  } finally {
    await cdp.detach();
  }
  await expect(page.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  await expect(page.frameLocator('iframe').locator('body')).toHaveCSS('background-color', 'rgb(18, 18, 18)');
});
