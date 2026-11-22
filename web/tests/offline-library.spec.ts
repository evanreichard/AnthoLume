import { test, expect, register } from './fixtures';
import { storedRows, serverEffects } from './storage';

test('pin, cold start offline, read, replay the durable queue and lock the shelf after sign-out', async ({ page, context, server }) => {
  const user = 'offline-library';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('button', { name: 'Keep on this device' }).click();
  await expect(page.getByRole('button', { name: 'Unpin offline copy' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.close();
  await context.setOffline(true);
  const cold = await context.newPage();
  await cold.goto(`${server.origin}/`);
  await expect(cold.getByText(/Offline · Showing books/)).toBeVisible();
  await expect(cold.getByRole('article')).toHaveCount(1);
  await expect(cold.getByRole('article')).toContainText('Public book 01');
  const started = Date.now();
  await cold.clock.setFixedTime(started);
  await cold.getByRole('article').getByRole('link').click();
  await expect(cold.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  for (const next of [2, 3]) {
    await cold.clock.setFixedTime(started + (next - 2) * 30_000);
    await cold.keyboard.press('c');
    await cold.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(cold.locator('footer')).toContainText(`${next} /`);
  }
  await expect.poll(async () => (await storedRows(cold, 'events')).map(e => e.kind).sort()).toEqual(['activity', 'progress']);
  const checkpoint = (await storedRows(cold, 'books'))[0]!.checkpoint;
  await cold.reload();
  await expect(cold.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  expect((await storedRows(cold, 'books'))[0]!.checkpoint).toEqual(checkpoint);
  expect(serverEffects(server.data, user).head).toBeUndefined();
  await context.setOffline(false);
  await expect.poll(() => serverEffects(server.data, user).head?.position).toBe(checkpoint!.position);
  await expect.poll(async () => (await storedRows(cold, 'events')).length).toBe(0);
  expect(serverEffects(server.data, user)).toMatchObject({ activity: 1, activitySeconds: 30 });
  await cold.goto(`${server.origin}/library`);
  await context.setOffline(true);
  await cold.getByRole('button', { name: 'Sign out' }).click();
  await cold.goto(`${server.origin}/library`);
  await expect(cold.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(cold.getByRole('article')).toHaveCount(0);
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
  await expect(page.getByRole('article')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Unpin offline copy' })).toHaveCount(7);
  await page.getByRole('button', { name: 'Unpin offline copy' }).first().click();
  await expect(page.getByRole('button', { name: 'Unpin offline copy' })).toHaveCount(6);
});
