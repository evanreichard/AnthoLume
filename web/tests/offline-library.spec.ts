import { test, expect, register, signIn } from './fixtures';
import { storedRows, serverEffects } from './storage';

test('cold start, pick a profile, review offline reading and upload the selected kinds separately', async ({ page, context, server }) => {
  const user = 'offline-library';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('button', { name: 'Keep on this device' }).click();
  await expect(page.getByRole('button', { name: 'Unpin offline copy' })).toBeVisible();
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
  await expect(cold.getByText(/Offline · Books on this device/)).toBeVisible();
  await expect(cold.getByRole('article')).toHaveCount(1);
  await expect(cold.getByRole('article')).toContainText('Public book 01');
  await cold.clock.setFixedTime(started);
  await cold.getByRole('article').getByRole('link').click();
  await expect(cold.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  for (const next of [2, 3]) {
    await cold.clock.setFixedTime(+started + (next - 2) * 30_000);
    await cold.keyboard.press('c');
    await cold.getByRole('button', { name: 'Next page', exact: true }).click();
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
  await expect(review.getByText('2m', {exact:true})).toBeVisible();
  await expect(review.getByText('30s', {exact:true})).toBeVisible();
  expect(serverEffects(server.data,user)).toMatchObject({activity:2});
  expect(serverEffects(server.data,user).head).toBeUndefined();
  await expect(review.getByRole('button',{name:'Upload selected'})).toBeDisabled();
  await review.getByLabel('Activity').check();
  await review.getByRole('button',{name:'Upload selected'}).click();
  await expect.poll(() => serverEffects(server.data,user).activity).toBe(3);
  expect(serverEffects(server.data,user).head).toBeUndefined();
  await cold.getByRole('button',{name:'Review offline reading'}).click();
  await review.getByLabel('Progress').check();
  await review.getByRole('button',{name:'Upload selected'}).click();
  await expect.poll(() => serverEffects(server.data, user).head?.position).toBe(checkpoint!.position);
  await expect.poll(async () => (await storedRows(cold, 'events')).length).toBe(0);
  expect(serverEffects(server.data, user)).toMatchObject({ activity: 3, activitySeconds: 450 });
  await cold.goto(`${server.origin}/library`);
  await context.setOffline(true);
  await cold.getByRole('button', { name: `Forget ${user}` }).click();
  await cold.getByRole('button', { name: 'Forget on this device' }).click();
  await expect(cold.getByRole('button',{ name:user, exact:true })).toHaveCount(0);
  await expect(cold.getByRole('article')).toHaveCount(0);
});

test('a signed-out profile can read a shared copy; only that account sees its review', async ({page,context,server}) => {
  async function signOut() {
    await page.goto(`${server.origin}/settings`);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Sign in'})).toBeVisible();
  }
  const bob = 'offline-bob', alice = 'offline-alice';
  await register(page,server.origin,bob);
  await signOut();
  await register(page,server.origin,alice);
  await page.getByRole('heading',{name:'Public book 01',exact:true}).click();
  await page.getByRole('button',{name:'Keep on this device'}).click();
  await expect(page.getByRole('button',{name:'Unpin offline copy'})).toBeVisible();
  await page.goto(`${server.origin}/library`);
  await context.setOffline(true);
  await page.getByRole('button',{name:bob,exact:true}).click();
  await page.getByRole('article').getByRole('link').click();
  await expect(page.getByRole('region',{name:'Book reader'})).toHaveAttribute('data-reader-state','ready');
  await page.keyboard.press('c');
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect.poll(async () => (await storedRows(page,'offline')).length).toBe(1);
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
  await dialog.getByRole('button',{name:'Upload selected'}).click();
  await expect.poll(() => serverEffects(server.data,bob).head?.revision).toBe(1);
  expect(serverEffects(server.data,alice).head).toBeUndefined();
});

test('seven pins and an automatically cached book coexist on the offline shelf', async ({ page, context, server }) => {
  await register(page, server.origin, 'offline-capacity');
  for (let i = 1; i <= 8; i++) {
    await page.getByRole('heading', { name: `Public book ${String(i).padStart(2, '0')}`, exact: true }).click();
    if (i <= 7) {
      await page.getByRole('button', { name: 'Keep on this device' }).click();
      await expect(page.getByRole('button', { name: 'Unpin offline copy' })).toBeVisible();
    } else {
      await page.getByRole('link', { name: 'Read', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
    }
    await page.goto(`${server.origin}/library`);
  }
  await context.setOffline(true);
  await page.getByRole('button',{name:'offline-capacity',exact:true}).click();
  await expect(page.getByRole('article')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Unpin offline copy' })).toHaveCount(7);
  await page.getByRole('button', { name: 'Unpin offline copy' }).first().click();
  await expect(page.getByRole('button', { name: 'Unpin offline copy' })).toHaveCount(6);
});
