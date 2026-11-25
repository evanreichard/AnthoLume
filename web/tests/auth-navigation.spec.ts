import { test, expect } from './fixtures';

test('standalone sign-in gates app routes and Settings signs out immediately', async ({ page, server }) => {
  const root = `${server.origin}`;
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const signIn = page.getByRole('heading', { name: 'Sign in', exact: true });
  await page.addInitScript(() => {
    const shell = 'nav[aria-label="Main navigation"], header';
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches(shell) || node.querySelector(shell))) {
            document.documentElement.dataset.workspaceMounted = 'true';
          }
        }
    }).observe(document, { childList: true, subtree: true });
  });
  let finishBootstrap!: () => void;
  const bootstrap = new Promise<void>((resolve) => {
    finishBootstrap = resolve;
  });
  await page.route(
    '**/api/v1/session',
    async (route) => {
      await bootstrap;
      await route.continue();
    },
    { times: 1 },
  );
  await page.goto(`${root}/`);
  await expect(page.getByRole('status')).toHaveText('Connecting…');
  await expect(page.getByRole('main').getByRole('heading')).toHaveCount(0);
  finishBootstrap();
  await expect(signIn).toBeVisible();
  expect(await page.locator('html').getAttribute('data-workspace-mounted')).toBeNull();

  const documents: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/documents')) documents.push(path);
  });
  for (const route of ['library', 'settings', 'books/server?id=book_001', 'read/server?id=book_001']) {
    expect((await page.goto(`${root}/${route}`))?.ok()).toBe(true);
    await expect(signIn).toBeVisible();
    await expect(page).toHaveURL(`${root}/login`);
    expect(await page.locator('html').getAttribute('data-workspace-mounted')).toBeNull();
  }
  expect(documents).toEqual([]);

  const username = `nav-${Date.now()}`;
  const password = 'synthetic-public-password';
  async function fillCredentials() {
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
  }
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await expect(nav).toHaveCount(0);
  await fillCredentials();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(`${root}/library`);
  await expect(nav.getByRole('link')).toHaveCount(3);
  await expect(nav.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
  const insights = nav.getByRole('link', { name: 'Insights', exact: true });
  await expect(insights).toHaveAttribute('href', '/insights');
  await insights.click();
  await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible();
  await page.goto(`${root}/login`);
  await expect(page).toHaveURL(`${root}/library`);
  await nav.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(`${root}/settings`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect((await page.request.get(`${root}/more`, { maxRedirects: 0 })).status()).toBe(404);

  let finishLogout!: () => void;
  const logout = new Promise<void>((resolve) => {
    finishLogout = resolve;
  });
  await page.route(
    '**/api/v1/session/logout',
    async (route) => {
      await logout;
      await route.continue();
    },
    { times: 1 },
  );
  try {
    await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign Out', exact: true }).click();
    await expect(signIn).toBeVisible();
    await expect(page).toHaveURL(`${root}/login`);
    await expect(nav).toHaveCount(0);
    await expect(page.getByRole('banner')).toHaveCount(0);
  } finally {
    finishLogout();
  }
  await fillCredentials();
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(`${root}/library`);
});
