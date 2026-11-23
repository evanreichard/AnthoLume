import { test, expect, register } from './fixtures';
import { pendingIds, serverEffects, storedRows } from './storage';

test('rapid turns wait for the previous receipt without changing its payload or conflicting', async ({ page, server }) => {
  const user = 'rapid-reader';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  await page.keyboard.press('c');

  const path = '**/api/v1/me/reading-progress';
  const submitted: { event_id: string; base_revision: string; position: string }[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/me/reading-progress')) submitted.push(request.postDataJSON());
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(path, async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });

  const next = page.getByRole('button', { name: 'Next Page', exact: true });
  let latest: string | null | undefined;
  try {
    await next.click();
    await expect(page.locator('footer')).toContainText('2 /');
    await expect.poll(() => serverEffects(server.data, user).receipts.length).toBe(1);
    const first = (await storedRows(page, 'events')).find(row => row.id === submitted[0].event_id);
    expect(first?.payload?.base_revision).toBe('0');
    await next.click();
    await expect(page.locator('footer')).toContainText('3 /');
    await next.click();
    await expect(page.locator('footer')).toContainText('4 /');
    await expect.poll(async () => (await storedRows(page, 'offline')).filter(row => row.kind === 'progress')).toEqual([]);
    latest = (await storedRows(page, 'positions')).find(row => row.ref?.documentId === 'book_001')?.checkpoint?.position;
    expect(latest).toBeTruthy();
    expect(latest).not.toBe(submitted[0].position);
    expect(submitted).toHaveLength(1);
    expect((await storedRows(page, 'events')).filter(row => row.kind === 'progress')).toEqual([first]);
  } finally {
    release();
  }

  await expect.poll(() => serverEffects(server.data, user).head?.position).toBe(latest);
  await expect.poll(() => pendingIds(page)).toEqual([]);
  expect(submitted.map(event => event.base_revision)).toEqual(['0', '1']);
  expect(submitted[1].event_id).not.toBe(submitted[0].event_id);
  expect(serverEffects(server.data, user).receipts.filter(row => row.kind === 'progress').map(row => row.status)).toEqual([200, 200]);
});
