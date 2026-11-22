import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, register, signIn } from './fixtures';
import { storedRows, serverEffects } from './storage';

test('offline startup failure is reported once above the library, not under the book', async ({ page, server }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(Navigator.prototype, 'serviceWorker'); });
  await register(page, server.origin, 'no-worker-reader');
  const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Save to Device' }).click();
  await expect(page.getByRole('region', { name: 'App update and recovery' }).getByRole('alert')).toContainText('service workers');
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect(card.getByRole('img', { name: 'Saved to device' })).toHaveCount(0);
});

for (const status of [502, 503, 504]) {
  test(`a cold start behind a gateway returning ${status} can read a saved book`, async ({ page, context, server }) => {
    const user = 'gateway-reader';
    await register(page, server.origin, user);
    const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Save to Device' }).click();
    await expect(card.getByRole('img', { name: 'Saved to device' })).toBeVisible();
    await page.close();

    const cold = await context.newPage();
    await cold.route('**/api/v1/session', route => route.fulfill({ status, contentType: 'text/html', body: 'Upstream unavailable' }));
    await cold.goto(server.origin);
    await cold.getByRole('button', { name: user, exact: true }).click();
    await cold.getByRole('article').getByRole('link').click();
    await expect(bookReader(cold)).toHaveAttribute('data-reader-state', 'ready');
  });
}

test('a saved book opens without a recovery prompt when the browser is online but the server is stopped', async ({ page, context, server }) => {
  await register(page, server.origin, 'offline-update-reader');
  const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Save to Device' }).click();
  await expect(card.getByRole('img', { name: 'Saved to device' })).toBeVisible();
  await page.close();
  await server.stop();

  const cold = await context.newPage();
  await cold.goto(server.origin);
  expect(await cold.evaluate(() => navigator.onLine)).toBe(true);
  await cold.getByRole('button', { name: 'offline-update-reader', exact: true }).click();
  await expect(cold.getByRole('article')).toContainText('Public book 01');
  await expect(cold.getByRole('region', { name: 'App update and recovery' })).toHaveCount(0);
  await cold.getByRole('article').getByRole('link').click();
  await expect(cold.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  await expect(cold.getByRole('region', { name: 'App update and recovery' })).toHaveCount(0);
});

test('cold start, pick a profile, review offline reading and upload the selected kinds separately', async ({ page, context, server }) => {
  const user = 'offline-library';
  await register(page, server.origin, user);
  const onlineCard = page.getByRole('article').filter({hasText:'Public book 01'});
  await onlineCard.locator('summary').click();
  await onlineCard.getByRole('button', { name: 'Save to Device' }).click();
  await expect(onlineCard.getByRole('img', {name:'Saved to device'})).toBeVisible();
  await expect(page).toHaveURL(/\/library/);
  const started = new Date(); started.setUTCHours(12,0,0,0); started.setUTCDate(started.getUTCDate()-1);
  const { csrf_token, user: identity } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
  const headers = { Origin: server.origin, 'X-CSRF-Token': csrf_token, 'X-AnthoLume-Reading-Generation': identity.reading_generation };
  await page.request.post(`${server.origin}/api/v1/me/devices`, {headers, data:{id:'other',name:'Other reader'}});
  for (const [daysAgo, duration] of [[0,120],[3,300]] as const) {
    const response = await page.request.post(`${server.origin}/api/v1/me/activity`, {headers,data:{event_id:crypto.randomUUID(),document_id:'book_001',device_id:'other',start_time:new Date(+started-daysAgo*86400000).toISOString(),duration,start_fraction:0,end_fraction:0.1}});
    expect(response.status()).toBe(200);
  }
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.close();
  await context.setOffline(true);
  const cold = await context.newPage();
  await cold.goto(`${server.origin}/`);
  await cold.getByRole('button', {name: user, exact:true}).click();
  const bar = cold.getByRole('region', {name:'Offline controls'});
  await expect(bar.getByRole('button', {name:`Switch Profile: ${user}`})).toBeVisible();
  expect(Math.round((await bar.boundingBox())!.y + (await bar.boundingBox())!.height)).toBe(cold.viewportSize()!.height);
  await expect(cold.getByRole('navigation',{name:'Main navigation'})).toHaveCount(0);
  await expect(cold.getByRole('button',{name:'Switch Profile'})).toBeVisible();
  await expect(cold.getByRole('article')).toHaveCount(1);
  await expect(cold.getByRole('article')).toContainText('Public book 01');
  await cold.clock.setFixedTime(started);
  await cold.getByRole('article').getByRole('link').click();
  await expect(cold.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  for (const next of [2, 3]) {
    await cold.clock.setFixedTime(+started + (next - 2) * 30_000);
    await cold.keyboard.press('c');
    await cold.getByRole('button', { name: 'Next Page', exact: true }).click();
    await expect(cold.locator('footer')).toContainText(`${next} /`);
  }
  await expect.poll(async () => (await storedRows(cold, 'offline')).map(e => e.kind).sort()).toEqual(['activity', 'progress']);
  const checkpoint = (await storedRows(cold, 'offline')).find(r => r.kind === 'progress')!.checkpoint;
  await cold.reload();
  await expect(cold.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  expect((await storedRows(cold, 'offline')).find(r => r.kind === 'progress')!.checkpoint).toEqual(checkpoint);
  expect(serverEffects(server.data, user).head).toBeUndefined();
  await context.setOffline(false);
  const review = cold.getByRole('dialog', {name:'Offline reading'});
  await expect(review).toBeVisible();
  for (const width of [320, 1280, 390]) {
    await cold.setViewportSize({width, height:844});
    const box = await review.boundingBox();
    if (width < 760) expect(Math.round(box!.y + box!.height)).toBe(844);
    else expect(box!.width).toBeLessThan(width / 2);
    expect(await review.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await expect(review.getByText('2m', {exact:true})).toBeVisible();
  await expect(review.getByText('30s', {exact:true})).toBeVisible();
  expect(serverEffects(server.data,user)).toMatchObject({activity:2});
  expect(serverEffects(server.data,user).head).toBeUndefined();
  await expect(review.getByRole('button',{name:'Upload Selected'})).toBeDisabled();
  await review.getByLabel('Activity').check();
  await review.getByRole('button',{name:'Upload Selected'}).click();
  await expect.poll(() => serverEffects(server.data,user).activity).toBe(3);
  expect(serverEffects(server.data,user).head).toBeUndefined();
  await cold.getByRole('button',{name:'Review Offline Reading'}).click();
  await review.getByLabel('Progress').check();
  await review.getByRole('button',{name:'Upload Selected'}).click();
  await expect.poll(() => serverEffects(server.data, user).head?.position).toBe(checkpoint!.position);
  await expect.poll(async () => (await storedRows(cold, 'events')).length).toBe(0);
  expect(serverEffects(server.data, user)).toMatchObject({ activity: 3, activitySeconds: 450 });
  await cold.goto(`${server.origin}/library`);
  await context.setOffline(true);
  await cold.getByRole('button', { name: 'Manage Profiles' }).click();
  await cold.getByRole('button', { name: `Forget ${user}` }).click();
  await cold.getByRole('button', { name: 'Forget on This Device' }).click();
  await expect(cold.getByRole('button',{ name:user, exact:true })).toHaveCount(0);
  await expect(cold.getByRole('article')).toHaveCount(0);
});

const bookReader = (page: Page) => page.getByRole('region', { name: 'Book reader', includeHidden: true });
const offlineReview = (page: Page) => page.getByRole('dialog', { name: 'Offline reading' });
const offlineProgress = async (page: Page) => (await storedRows(page, 'offline')).find(row => row.kind === 'progress');
const offlinePosition = async (page: Page) => (await offlineProgress(page))?.checkpoint?.position;

async function turnPage(page: Page, next: number) {
  await page.keyboard.press('c');
  const nextButton = page.getByRole('button', { name: 'Next Page', exact: true });
  await expect(nextButton).toBeVisible();
  await nextButton.click();
  await expect(bookReader(page).locator('footer')).toContainText(`${next} /`);
}

async function readOffline(page: Page, context: BrowserContext, origin: string, user: string) {
  await register(page, origin, user);
  const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Save to Device' }).click();
  await expect(card.getByRole('img', { name: 'Saved to device' })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: user, exact: true }).click();
  await page.getByRole('article').getByRole('link').click();
  await expect(bookReader(page)).toHaveAttribute('data-reader-state', 'ready');
  await turnPage(page, 2);
  await turnPage(page, 3);
  await expect.poll(() => offlinePosition(page)).toBeTruthy();
}

test('the first turn during a backend-only outage stays local through restart and reload until approved', async ({ page, server }) => {
  const user = 'backend-outage-reader';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const started = Date.now();
  await page.clock.setFixedTime(started);
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  const reader = bookReader(page), frame = reader.locator('iframe').first();
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  const openedFrame = await frame.elementHandle();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

  const submissions: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /\/me\/(activity|reading-progress)$/.test(path)) submissions.push(path);
  });
  await server.stop();
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await page.clock.setFixedTime(started + 30_000);
  await turnPage(page, 2);
  await expect.poll(async () => (await storedRows(page, 'offline')).map(row => row.kind).sort()).toEqual(['activity', 'progress']);
  const firstPosition = await offlinePosition(page);
  expect(firstPosition).toBeTruthy();
  await turnPage(page, 3);
  await expect.poll(async () => (await offlinePosition(page)) ?? firstPosition).not.toBe(firstPosition);
  const checkpoint = await offlinePosition(page);
  expect(await frame.evaluate((current, original) => current === original, openedFrame)).toBe(true);
  expect(await storedRows(page, 'events')).toEqual([]);
  expect(submissions).toEqual([]);

  await server.start();
  await page.reload();
  const review = offlineReview(page);
  await expect(review.getByLabel('Progress')).toBeEnabled();
  await expect(review.getByLabel('Activity')).toBeEnabled();
  expect(submissions).toEqual([]);
  expect(serverEffects(server.data, user)).toMatchObject({ head: undefined, activity: 0, receipts: [] });
  await review.getByLabel('Progress').check();
  await review.getByLabel('Activity').check();
  await review.getByRole('button', { name: 'Upload Selected', exact: true }).click();
  await expect.poll(() => serverEffects(server.data, user)).toMatchObject({ head: { revision: 1, position: checkpoint }, activity: 1, activitySeconds: 30 });
});

test('closing the tab during preflight preserves the turn for review without another tab submitting it', async ({ page, context, server }) => {
  const user = 'abandoned-preflight-reader';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const started = Date.now();
  await page.clock.setFixedTime(started);
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(bookReader(page)).toHaveAttribute('data-reader-state', 'ready');

  const originalSubmissions: string[] = [];
  context.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /\/me\/(activity|reading-progress)$/.test(path) &&
      request.postDataJSON().document_id === 'book_001') originalSubmissions.push(path);
  });
  const preflightURL = '**/api/v1/me/devices';
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(preflightURL, async route => { await held; await route.abort().catch(() => undefined); });
  const preflight = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/me/devices'));
  try {
    await page.clock.setFixedTime(started + 30_000);
    await turnPage(page, 2);
    await preflight;
    // Inspect immediately: settling the request could also move a premature outbox row back to a draft.
    expect((await storedRows(page, 'offline')).map(row => row.kind).sort()).toEqual(['activity', 'progress']);
    const draft = await offlineProgress(page);
    expect(draft?.checkpoint?.position).toBeTruthy();
    expect(await storedRows(page, 'events')).toEqual([]);
    expect(originalSubmissions).toEqual([]);

    const survivor = await context.newPage();
    await survivor.goto(`${server.origin}/library`);
    await expect(survivor.getByRole('heading', { name: 'Library', exact: true, includeHidden: true })).toBeAttached();
    expect(await storedRows(survivor, 'events')).toEqual([]);
    expect(await offlineProgress(survivor)).toEqual(draft);

    await page.close();
    await survivor.reload();
    const review = offlineReview(survivor);
    await expect(review.getByLabel('Progress')).toBeEnabled();
    await expect(review.getByLabel('Activity')).toBeEnabled();
    expect(await offlineProgress(survivor)).toEqual(draft);
    expect(await storedRows(survivor, 'events')).toEqual([]);
    expect(originalSubmissions).toEqual([]);
    expect(serverEffects(server.data, user)).toMatchObject({ head: undefined, activity: 0 });
  } finally { release(); }
});

test('reconnect keeps the open page and frame through review, then syncs the first turn after upload', async ({ page, context, server }) => {
  const user = 'offline-upload-open-book';
  await readOffline(page, context, server.origin, user);
  const checkpoint = await offlinePosition(page);
  const reader = bookReader(page), review = offlineReview(page);
  const frame = reader.locator('iframe').first();
  const openedFrame = await frame.elementHandle();
  await context.setOffline(false);
  await expect(review.getByLabel('Progress')).toBeEnabled();
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  await expect(reader.locator('footer')).toContainText('3 /');
  expect(await frame.evaluate((current, original) => current === original, openedFrame)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(reader.locator('footer')).toContainText('3 /');
  expect(serverEffects(server.data, user).head).toBeUndefined();

  await review.getByLabel('Progress').check();
  await review.getByRole('button', { name: 'Upload Selected' }).click();
  await expect(review).toBeHidden();
  const head = () => serverEffects(server.data, user).head;
  await expect.poll(head).toMatchObject({ revision: 1, position: checkpoint });
  await expect(reader.locator('footer')).toContainText('3 /');
  const uploadedFraction = Number(head()!.fraction);
  await turnPage(page, 4);
  await expect.poll(() => head()?.revision).toBe(2);
  expect(head()!.position).not.toBe(checkpoint);
  expect(Number(head()!.fraction)).toBeGreaterThan(uploadedFraction);
});

test('Keep Reading preserves pending progress locally across turns and an online reload', async ({ page, context, server }) => {
  const user = 'offline-defer-open-book';
  await readOffline(page, context, server.origin, user);
  const checkpoint = await offlinePosition(page);
  await context.setOffline(false);
  const review = offlineReview(page);
  const keepReading = review.getByRole('button', { name: 'Keep Reading', exact: true });
  await keepReading.click();
  await expect(review).toBeHidden();
  await turnPage(page, 4);
  await expect.poll(async () => (await offlinePosition(page)) ?? checkpoint).not.toBe(checkpoint);
  const deferredPosition = await offlinePosition(page);
  expect(serverEffects(server.data, user).head).toBeUndefined();

  await page.reload();
  await keepReading.click();
  const reader = bookReader(page);
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  const paragraph = deferredPosition?.match(/\/p\[(\d+)\]$/)?.[1];
  expect(paragraph).toBeTruthy();
  await expect(reader.locator('iframe').first().contentFrame().locator('body > p').nth(Number(paragraph) - 1)).toBeInViewport();
  const restored = await offlineProgress(page);
  expect(restored?.checkpoint?.position).toBe(deferredPosition);
  const currentPage = Number((await reader.locator('footer').textContent())?.split('/')[0]);
  await turnPage(page, currentPage + 1);
  await expect.poll(async () => (await offlineProgress(page))?.id ?? restored?.id).not.toBe(restored?.id);
  expect((await storedRows(page, 'events')).filter(row => row.kind === 'progress')).toEqual([]);
  expect(serverEffects(server.data, user).head).toBeUndefined();
});

for (const failed of ['Progress', 'Activity'] as const) {
  test(`a failed ${failed} comparison does not block the other upload`, async ({ page, context, server }) => {
    const user = 'partial-' + failed.toLowerCase();
    const started = Date.now() - 60_000;
    await page.clock.setFixedTime(started);
    await readOffline(page, context, server.origin, user);
    await page.clock.setFixedTime(started + 30_000);
    await turnPage(page, 4);
    const local = () => storedRows(page, 'offline');
    await expect.poll(async () => (await local()).map(row => row.kind).sort()).toEqual(['activity', 'progress']);
    const kept = (await local()).filter(row => row.kind === failed.toLowerCase());

    const endpoint = failed === 'Progress' ? '**/me/reading-state/book_001' : '**/me/insights/activity?*';
    await page.route(endpoint, route => route.fulfill({ status: 500 }));
    await context.setOffline(false);
    const review = offlineReview(page);
    const retry = review.getByRole('button', { name: `Retry ${failed} Comparison` });
    await expect(retry).toBeVisible();
    await expect(review.getByLabel(failed, { exact: true })).toBeDisabled();
    await review.getByLabel(failed === 'Progress' ? 'Activity' : 'Progress', { exact: true }).check();
    await review.getByRole('button', { name: 'Upload Selected' }).click();
    await expect.poll(local).toEqual(kept);
    const effects = () => serverEffects(server.data, user);
    if (failed === 'Progress') {
      await expect.poll(() => effects().activity).toBe(1);
      expect(effects().head).toBeUndefined();
    } else {
      await expect.poll(() => effects().head?.revision).toBe(1);
      expect(effects().activity).toBe(0);
    }

    await page.getByRole('button', { name: 'Review Offline Reading' }).click();
    await expect(retry).toBeVisible();
    await page.unroute(endpoint);
    await retry.click();
    await expect(review.getByLabel(failed, { exact: true })).toBeEnabled();
    expect(await local()).toEqual(kept);
  });
}

test('a deleted book’s draft can be discarded locally without a server comparison', async ({ page, context, server }) => {
  const user = 'discard-deleted-book';
  await readOffline(page, context, server.origin, user);
  await page.goto(server.origin + '/library');
  const { csrf_token, user: identity } = await (await page.request.get(server.origin + '/api/v1/session')).json();
  const removed = await page.request.delete(server.origin + '/api/v1/documents/book_001', { headers: {
    Origin: server.origin, 'X-CSRF-Token': csrf_token, 'X-AnthoLume-Reading-Generation': identity.reading_generation,
  } });
  expect(removed.status()).toBe(204);
  await context.setOffline(false);
  const review = offlineReview(page);
  await expect(review.getByRole('button', { name: 'Retry Progress Comparison' })).toBeVisible();
  const progress = review.getByLabel('Progress', { exact: true });
  await expect(review.getByRole('button', { name: 'Upload Selected' })).toBeDisabled();
  await review.getByRole('button', { name: 'Discard Records', exact: true }).click();
  await progress.check();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review.getByRole('button', { name: 'Upload Selected' })).toBeDisabled();
  const before = await storedRows(page, 'offline');
  expect(before.some(row => row.kind === 'progress')).toBe(true);
  await review.getByRole('button', { name: 'Discard Records', exact: true }).click();
  await progress.check();
  await review.getByRole('button', { name: 'Discard Selected', exact: true }).click();
  await expect.poll(() => storedRows(page, 'offline')).toEqual(before.filter(row => row.kind !== 'progress'));
  expect(await storedRows(page, 'events')).toEqual([]);
  expect(serverEffects(server.data, user).receipts).toEqual([]);
});

test('removing a shared download clears both shelves but preserves the offline reader’s private review', async ({page,context,server}) => {
  async function signOut() {
    await page.goto(`${server.origin}/settings`);
    await page.getByRole('button',{name:'Sign Out',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Sign Out',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Sign in'})).toBeVisible();
  }
  const bob = 'offline-bob', alice = 'offline-alice';
  await register(page,server.origin,bob);
  await signOut();
  await register(page,server.origin,alice);
  await page.getByRole('heading',{name:'Public book 01',exact:true}).click();
  const toolbar = page.getByRole('group', { name: 'Book actions' });
  await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.goto(`${server.origin}/library`);
  await context.setOffline(true);
  await page.getByRole('button',{name:bob,exact:true}).click();
  await page.getByRole('article').getByRole('link').click();
  await expect(page.getByRole('region',{name:'Book reader'})).toHaveAttribute('data-reader-state','ready');
  const start = Date.now();
  for (const [index, next] of [2, 3].entries()) {
    await page.clock.setFixedTime(start + index * 30_000);
    await page.keyboard.press('c');
    await page.getByRole('button',{name:'Next Page',exact:true}).click();
    await expect(page.locator('footer')).toContainText(`${next} /`);
  }
  await expect.poll(async () => (await storedRows(page,'offline')).map(row => row.kind).sort()).toEqual(['activity', 'progress']);
  const checkpoint = (await storedRows(page, 'offline')).find(row => row.kind === 'progress')!.checkpoint!;
  await page.goto(`${server.origin}/library`);
  const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
  await expect(card.getByRole('img', {name:'Saved to device'})).toBeVisible();
  await card.locator('summary').click();
  await card.getByRole('button', {name:'Remove from Device'}).click();
  await page.getByRole('dialog').getByRole('button', {name:'Remove from Device'}).click();
  const emptyShelf = page.getByText('No matching books on this device.');
  await expect(emptyShelf).toBeVisible();
  await page.getByRole('button', {name:`Switch Profile: ${bob}`}).click();
  await page.getByRole('button', {name:alice, exact:true}).click();
  await expect(page.getByRole('button', {name:`Switch Profile: ${alice}`})).toBeVisible();
  await expect(emptyShelf).toBeVisible();
  await context.setOffline(false);
  await page.goto(`${server.origin}/library`);
  await expect(page.getByRole('button',{name:'Add Book'})).toBeEnabled();
  await expect(page.getByRole('dialog',{name:'Offline reading'})).toHaveCount(0);
  await signOut();
  await signIn(page,server.origin,bob);
  const dialog = page.getByRole('dialog',{name:'Offline reading'});
  await expect(dialog).toBeVisible();
  expect(serverEffects(server.data,bob).head).toBeUndefined();
  await dialog.getByLabel('Progress').check();
  await dialog.getByLabel('Activity').check();
  await dialog.getByRole('button',{name:'Upload Selected'}).click();
  await expect.poll(() => serverEffects(server.data,bob).head?.position).toBe(checkpoint.position);
  await expect.poll(() => serverEffects(server.data,bob).activity).toBe(1);
  expect(serverEffects(server.data,alice).head).toBeUndefined();
  expect(serverEffects(server.data,alice).activity).toBe(0);
});

test('the detail toolbar only checks pinned copies and confirms before removing one', async ({ page, server }) => {
  await register(page, server.origin, 'detail-device-toolbar');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const detailURL = page.url();
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  await page.goto(detailURL);
  const toolbar = page.getByRole('group', { name: 'Book actions' });
  const save = toolbar.getByRole('button', { name: 'Save', exact: true });
  const saved = toolbar.getByRole('button', { name: 'Saved', exact: true });
  await expect(save).toBeEnabled();
  await expect(saved).toHaveCount(0);
  await save.click();
  await expect(saved).toBeEnabled();
  await saved.click();
  const confirmation = page.getByRole('dialog', { name: 'Remove this download?' });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(saved).toBeEnabled();
  await saved.click();
  await confirmation.getByRole('button', { name: 'Remove from Device', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(save).toBeEnabled();
  await expect(saved).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^(Read|Resume)$/ })).toBeVisible();
});

test('seven pins and an automatically cached book coexist on the offline shelf', async ({ page, context, server }) => {
  await register(page, server.origin, 'offline-capacity');
  for (let i = 1; i <= 8; i++) {
    await page.getByRole('heading', { name: `Public book ${String(i).padStart(2, '0')}`, exact: true }).click();
    if (i <= 7) {
      const toolbar = page.getByRole('group', { name: 'Book actions' });
      await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(toolbar.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    } else {
      await page.getByRole('link', { name: 'Read', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
    }
    await page.goto(`${server.origin}/library`);
  }
  await context.setOffline(true);
  await page.getByRole('button',{name:'offline-capacity',exact:true}).click();
  await expect(page.getByRole('article')).toHaveCount(8);
  const kept = page.getByRole('img', { name: 'Saved to device' });
  await expect(kept).toHaveCount(7);
  const card = page.getByRole('article').filter({hasText:'Public book 01'});
  for (const action of ['Cancel', 'Remove from Device']) {
    await card.locator('summary').click();
    await card.getByRole('button',{name:'Remove from Device'}).click();
    await expect(kept).toHaveCount(7);
    await page.getByRole('dialog',{name:'Remove this download?'}).getByRole('button',{name:action,exact:true}).click();
  }
  await expect(kept).toHaveCount(6);
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(7);
  await context.setOffline(false);
  await expect(card).toBeVisible();
  await card.locator('summary').click();
  await card.getByRole('button',{name:'Save to Device'}).click();
  await expect(card.getByRole('img',{name:'Saved to device'})).toBeVisible();
});
