import { unlink, writeFile } from 'node:fs/promises';
import { test, expect, register } from './fixtures';
import { pendingIds } from './storage';

const requested = (origin: string, id: string) =>
  `${origin}/?${new URLSearchParams({ 'antholume-retirement': 'legacy-v1', legacyDocument: id, origin: 'https://untrusted.example', account: 'old-account' })}`;

test('root retirement keeps only document intent through logout/login/register/reload, then opens an exact authorized BookRef', async ({
  page,
  server,
}) => {
  const user = `intent-${Date.now()}`;
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.goto(`${server.origin}/settings`);
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const resources: string[] = [];
  page.on('request', (request) => resources.push(new URL(request.url()).pathname));
  await page.goto(requested(server.origin, 'book_001'));
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?legacyDocument=book_001$/);
  await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toHaveCount(0);
  expect(resources.some((path) => path.startsWith('/api/v1/documents'))).toBe(false);
  await page.getByRole('link', { name: 'Create an account', exact: true }).click();
  await expect(page).toHaveURL(/\/register\?legacyDocument=book_001$/);
  await page.getByRole('link', { name: 'Already have an account? Sign in', exact: true }).click();
  await page.reload();
  await expect(page).toHaveURL(/\/login\?legacyDocument=book_001$/);
  await page.getByLabel('Username', { exact: true }).fill(user);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-public-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toBeVisible();
  await expect(
    page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter', exact: true }),
  ).toBeVisible();
  const destination = new URL(page.url());
  expect(destination.pathname).toBe('/read/server');
  expect(destination.searchParams.get('id')).toBe('book_001');
  expect(destination.searchParams.get('origin')).toBe(server.origin);
  const { user: signedIn } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
  expect(signedIn.id).toBe(user);
  expect(destination.searchParams.get('account')).toBe(signedIn.account_id);
  expect(destination.searchParams.has('legacyDocument')).toBe(false);
  expect(resources).not.toContain('/assets/reader/index.js');
  expect(resources).not.toContain('/assets/index.js');
});

test('expired-account retirement intent hides retained pending counts until explicit authentication selects the account', async ({
  page,
  context,
  server,
}) => {
  const user = `intent-expired-${Date.now()}`;
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await writeFile(`${server.data}/receipt-fault`, 'extra-field');
  try {
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    await expect(page.locator('footer')).toContainText('1 /');
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Next Page', exact: true }).click();
    await expect(page.locator('footer')).toContainText('2 /');
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect.poll(async () => (await pendingIds(page)).length).toBe(1);
    await context.clearCookies();
    await page.goto(requested(server.origin, 'book_001'));
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: /pending/ })).toHaveCount(0);
    await expect(page.locator('img:not([src="/assets/icons/mark.svg"])')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toHaveCount(0);
    expect(await pendingIds(page)).toHaveLength(1);
    await unlink(`${server.data}/receipt-fault`);
    await page.getByLabel('Username', { exact: true }).fill(user);
    await page.getByLabel('Password', { exact: true }).fill('synthetic-public-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toBeVisible();
    await expect(page.locator('iframe').first()).toBeVisible();
    await expect.poll(() => pendingIds(page)).toEqual([]);
  } finally {
    await unlink(`${server.data}/receipt-fault`).catch(() => undefined);
  }
});

test('already authenticated root retirement opens the original uncached document without a fake title or legacy executable', async ({
  page,
  server,
}) => {
  const user = `intent-auth-${Date.now()}`;
  await register(page, server.origin, user);
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
  });
  await page.goto(requested(server.origin, 'book_002'));
  await expect(
    page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter', exact: true }),
  ).toBeVisible();
  const destination = new URL(page.url());
  expect(destination.pathname).toBe('/read/server');
  expect(destination.searchParams.get('id')).toBe('book_002');
  expect(destination.searchParams.get('origin')).toBe(server.origin);
  const { user: signedIn } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
  expect(signedIn.id).toBe(user);
  expect(destination.searchParams.get('account')).toBe(signedIn.account_id);
  expect(
    scripts.some(
      (path) => path.startsWith('/assets/reader/') || path === '/assets/index.js' || path === '/assets/common.js',
    ),
  ).toBe(false);
});
