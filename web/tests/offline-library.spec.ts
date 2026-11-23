import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, register, signIn } from './fixtures';
import { storedRows, serverEffects } from './storage';

test('missing service worker support is attributed to Save to Device, not app recovery', async ({ page, server }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(Navigator.prototype, 'serviceWorker'); });
  await register(page, server.origin, 'no-worker-reader');
  const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Save to Device' }).click();
  const notice = page.locator('[data-snackbar]');
  await expect(notice.getByRole('status')).toHaveText('Couldn’t save for offline reading. Save to Device requires service workers. Open the app on localhost or HTTPS in a browser that supports them.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await notice.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(notice.getByRole('status')).toContainText('requires service workers');
  await expect(card.getByRole('img', { name: 'Saved to device' })).toHaveCount(0);
});

for (const status of [502, 503, 504, 'dropped body'] as const) {
  test(`a cold start with a session failure (${status}) can read a saved book`, async ({ page, context, server }) => {
    const user = 'gateway-reader';
    await register(page, server.origin, user);
    const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Save to Device' }).click();
    await expect(card.getByRole('img', { name: 'Saved to device' })).toBeVisible();
    await page.close();

    const cold = await context.newPage();
    if (status === 'dropped body') await cold.addInitScript(() => {
      const fetch = window.fetch;
      window.fetch = (input, init) => {
        if (input instanceof Request && new URL(input.url).pathname === '/api/v1/session') {
          return Promise.resolve(new Response(new ReadableStream({ pull(controller) { controller.error(new TypeError('Connection reset')); } }), { headers: { 'Content-Type': 'application/json' } }));
        }
        return fetch(input, init);
      };
    });
    else await cold.route('**/api/v1/session', route => route.fulfill({ status, contentType: 'text/html', body: 'Upstream unavailable' }));
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
  await cold.clock.install();
  await cold.getByRole('article').getByRole('link').click();
  const reader = bookReader(cold);
  const reconnect = reader.getByRole('button', { name: 'Offline Reconnect' });
  const pill = cold.getByText('Reading offline', { exact: true });
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  await expect(pill).toBeVisible();
  await cold.clock.fastForward(3100);
  await expect(pill).toHaveCount(0);
  await expect(reconnect).toHaveCount(0);
  for (const width of [320, 390, 1280]) {
    await cold.setViewportSize({ width, height: 844 });
    await cold.keyboard.press('c');
    const bounds = [];
    for (const button of [reader.getByRole('button', { name: 'Library', exact: true }), reconnect, reader.getByRole('button', { name: 'Contents' })]) {
      await button.click({ trial: true });
      bounds.push((await button.boundingBox())!);
    }
    expect(bounds[0]!.x + bounds[0]!.width).toBeLessThanOrEqual(bounds[1]!.x);
    expect(bounds[1]!.x + bounds[1]!.width).toBeLessThanOrEqual(bounds[2]!.x);
    expect(bounds[2]!.x + bounds[2]!.width).toBeLessThanOrEqual(width);
    await expect(pill).toHaveCount(0);
  }
  await reconnect.click();
  await expect(cold.getByRole('status').filter({ hasText: 'Still offline. You can keep reading.' })).toBeVisible();
  await expect(reader.locator('iframe').first()).toBeVisible();
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

test('mounted libraries observe a shared pin and removal from another tab', async ({ page, context, server }) => {
  await register(page, server.origin, 'shared-pin');
  const observer = await context.newPage();
  await observer.goto(server.origin + '/library');
  const card = (tab: Page) => tab.getByRole('article').filter({ hasText: 'Public book 01' });
  const saved = card(observer).getByRole('img', { name: 'Saved to device' });
  await expect(card(observer)).toBeVisible();
  await card(page).locator('summary').click();
  await card(page).getByRole('button', { name: 'Save to Device' }).click();
  await expect(saved).toBeVisible();
  await card(page).locator('summary').click();
  await card(page).getByRole('button', { name: 'Remove from Device' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from Device' }).click();
  await expect(saved).toHaveCount(0);
  await expect(card(observer)).toBeVisible();
});

test('an account reader queues outage turns and delivers them after the tab closes', async ({ page, context, server }) => {
  const user = 'account-reader';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(bookReader(page)).toHaveAttribute('data-reader-state', 'ready');
  await server.stop();
  await turnPage(page, 2);
  const queued = (await storedRows(page, 'events')).find(row => row.kind === 'progress')!;
  expect(queued.payload?.position).toBeTruthy();
  await turnPage(page, 3);
  const latest = (await storedRows(page, 'positions')).find(row => row.ref?.documentId === 'book_001')!.checkpoint!;
  expect(latest.position).not.toBe(queued.payload?.position);
  expect(await storedRows(page, 'offline')).toEqual([]);
  await page.close();
  await server.start();
  const next = await context.newPage();
  await next.goto(server.origin);
  await expect.poll(() => serverEffects(server.data, user).head).toMatchObject({ position: latest.position, revision: 2 });
  await expect(offlineReview(next)).toHaveCount(0);
});

test('a device-only reader stays on the same page and keeps new turns private after upload', async ({ page, context, server }) => {
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
  await turnPage(page, 4);
  await expect.poll(() => offlinePosition(page)).not.toBe(checkpoint);
  expect(await offlinePosition(page)).toBeTruthy();
  expect(head()?.revision).toBe(1);
  expect(await storedRows(page, 'events')).toEqual([]);
  // A new authenticated open uses the server checkpoint; the separate device draft is not permission to upload it.
  const draft = await offlinePosition(page);
  await page.reload();
  await offlineReview(page).getByRole('button', { name: 'Keep Reading' }).click();
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  const currentPage = Number((await reader.locator('footer').textContent())?.split('/')[0]);
  await turnPage(page, currentPage + 1);
  await expect.poll(() => head()?.revision).toBe(2);
  expect(await offlinePosition(page)).toBe(draft);
});

for (const action of ['Upload', 'Discard'] as const) {
  test(`${action} requires reselecting activity after another tab adds reading time`, async ({ page, context, server }) => {
    const started = Date.now() - 120_000;
    await page.clock.setFixedTime(started);
    await readOffline(page, context, server.origin, `changed-activity-${action.toLowerCase()}`);
    await page.clock.setFixedTime(started + 30_000);
    await turnPage(page, 4);
    await context.setOffline(false);
    await offlineReview(page).getByRole('button', { name: 'Keep Reading' }).click();

    const reviewer = await context.newPage();
    await reviewer.goto(server.origin + '/library');
    const review = offlineReview(reviewer);
    if (action === 'Discard') await review.getByRole('button', { name: 'Discard Records' }).click();
    const activity = review.getByLabel('Activity', { exact: true });
    const submit = review.getByRole('button', { name: `${action} Selected` });
    await activity.check();
    await expect(submit).toBeEnabled();
    await page.clock.setFixedTime(started + 60_000);
    await turnPage(page, 5);
    await expect(activity).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await activity.check();
    await submit.click();
    await expect.poll(async () => (await storedRows(reviewer, 'offline')).map(row => row.kind)).toEqual(['progress']);
  });
}

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

test('pinning needs no reading state, position, or reader lease and does not need localStorage profiles', async ({ page, context, server }) => {
  await context.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('antholume:offline-profile:')) throw new DOMException('Full', 'QuotaExceededError');
      set.call(this, key, value);
    };
  });
  await register(page, server.origin, 'pin-only');
  let stateRequests = 0;
  await page.route('**/me/reading-state/**', route => { stateRequests++; return route.fulfill({ status: 503 }); });
  const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Save to Device' }).click();
  await expect(card.getByRole('img', { name: 'Saved to device' })).toBeVisible();
  expect(stateRequests).toBe(0);
  expect(await storedRows(page, 'positions')).toEqual([]);
  expect(await storedRows(page, 'heads')).toEqual([]);
  expect((await storedRows(page, 'sources')).every(row => !Object.keys(row.cacheReaders ?? {}).length)).toBe(true);
  await page.getByRole('heading', { name: 'Public book 02', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'pin-only', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(card).toBeVisible();
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
