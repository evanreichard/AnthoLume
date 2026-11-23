import { test, expect, register } from './fixtures';

test('a failed session refresh keeps the same rendition while the backend is reachable, until sign-out is confirmed', async ({ page, context, server }) => {
  await register(page, server.origin, 'session-refresh-reader');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  const readerURL = page.url();
  const originalFrame = await page.locator('iframe').first().elementHandle();
  const sessionURL = '**/api/v1/session';
  const visible = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const sameFrame = () => originalFrame.evaluate(frame => frame.isConnected && frame === document.querySelector('iframe'));

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(sessionURL, async route => { await held; await route.continue(); }, { times: 1 });
  const response = page.waitForResponse(sessionURL);
  try {
    await Promise.all([page.waitForRequest(sessionURL), visible()]);
    await expect(page.locator('footer')).toContainText('1 /');
    expect(await sameFrame()).toBe(true);
  } finally {
    release();
  }
  await response;
  await expect(page).toHaveURL(readerURL);

  await page.route(sessionURL, route => route.abort(), { times: 1 });
  await visible();
  const recovery = page.getByRole('region', { name: 'App update and recovery' });
  await expect(recovery.getByText('Connection unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offline Profiles', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(readerURL);
  await expect(page.locator('footer')).toContainText('1 /');
  expect(await sameFrame()).toBe(true);

  await recovery.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  expect(await sameFrame()).toBe(true);

  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('saved EPUB opens probe both gateway and stream failures; only an unreachable session permits fallback', async ({ page, server }) => {
  await register(page, server.origin, 'warm-gateway-reader');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const toolbar = page.getByRole('group', { name: 'Book actions' });
  await toolbar.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

  const gateway = { status: 503, contentType: 'text/html', body: 'Upstream unavailable' };
  await page.route('**/api/v1/documents/*/file', route => route.fulfill(gateway));
  const reader = page.getByRole('region', { name: 'Book reader' });
  const healthyProbe = page.waitForResponse(response => response.url().endsWith('/api/v1/session') && response.ok());
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await healthyProbe;
  await expect(reader).toHaveAttribute('data-reader-state', 'error');
  await expect(reader.getByRole('alert')).toContainText('Could not load EPUB');
  await reader.getByRole('button', { name: 'Library', exact: true }).click();

  await page.evaluate(() => {
    const fetch = window.fetch;
    window.fetch = (request, init) => request instanceof Request && new URL(request.url).pathname.endsWith('/file')
      ? Promise.resolve(new Response(new ReadableStream({ pull(c) { c.error(new TypeError('Connection reset')); } }), { headers: { 'Content-Type': 'application/epub+zip' } }))
      : fetch(request, init);
  });
  let probes = 0;
  await page.route('**/api/v1/session', route => { probes++; return route.fulfill(gateway); });
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  await expect(reader.locator('iframe').first()).toBeVisible();
  expect(probes).toBe(1);
});

test('a stalled saved-book request opens the offline copy on timeout, but leaving does not probe', async ({ page, server }) => {
  await register(page, server.origin, 'stalled-reader');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

  const file = '**/api/v1/documents/book_001/file';
  await page.route(file, () => {});
  let probes = 0;
  await page.route('**/api/v1/session', route => { probes++; return route.fulfill({ status: 504 }); });
  await page.clock.install();
  const read = page.getByRole('link', { name: 'Read', exact: true });
  const reader = page.getByRole('region', { name: 'Book reader' });
  const open = () => Promise.all([page.waitForRequest(file), read.click()]);

  await open();
  await reader.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(read).toBeVisible();
  expect(probes).toBe(0);

  await open();
  await page.clock.fastForward(90_000);
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  await expect(reader.locator('iframe').first()).toBeVisible();
  expect(probes).toBe(1);
});

test('concurrent API failures share a probe; a cold offline profile regains account settings on reconnect', async ({ page, server }) => {
  const user = 'gateway-library-reader';
  await register(page, server.origin, user);
  await page.goto(server.origin + '/settings');
  await expect(page.getByRole('button', { name: /Locale/ })).toBeEnabled();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

  const gateway = { status: 502, body: 'Gateway unavailable' };
  let probes = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/session', async route => { probes++; await held; await route.fulfill(gateway); });
  await page.route('**/api/v1/documents?*', route => route.fulfill(gateway));
  try {
    const requests = [false, true].map(resumable => page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/documents' && url.searchParams.has('resumable') === resumable && response.status() === 502;
    }));
    await page.getByRole('link', { name: 'Library', exact: true }).last().click();
    await Promise.all(requests);
    await expect.poll(() => probes).toBe(1);
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Offline Profiles' })).toBeVisible();
  expect(probes).toBe(1);

  await page.reload();
  await page.getByRole('button', { name: user, exact: true }).click();
  await page.unroute('**/api/v1/session');
  await page.unroute('**/api/v1/documents?*');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: /Locale/ })).toBeEnabled();
});

test('a pending sign-out retries without interrupting an offline reader', async ({ page, server }) => {
  const user = 'offline-after-signout';
  await register(page, server.origin, user);
  const card = page.getByRole('article').filter({hasText: 'Public book 01'});
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Save to Device' }).click();
  await expect(card.getByRole('img', { name: 'Saved to device' })).toBeVisible();
  await page.goto(server.origin + '/settings');
  await page.route('**/api/v1/session/logout', route => route.abort(), { times: 1 });
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await server.stop();
  await page.clock.install();
  await page.goto(server.origin);
  await page.getByRole('button', { name: user, exact: true }).click();
  await page.getByRole('article').getByRole('link').click();
  await expect(page.locator('footer')).toContainText('1 /');
  const frame = await page.locator('iframe').first().elementHandle();
  const probe = page.waitForEvent('requestfailed', req => req.url().endsWith('/api/v1/session'));
  await page.clock.fastForward(30_000);
  await probe;
  await expect(page.locator('footer')).toContainText('1 /');
  expect(await frame.evaluate(el => el.isConnected)).toBe(true);

  await server.start();
  const logout = page.waitForResponse(res => res.url().endsWith('/api/v1/session/logout') && res.ok());
  await page.clock.fastForward(30_000);
  await logout;
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect((await (await page.request.get(server.origin + '/api/v1/session')).json()).user).toBeFalsy();
});

test('a stopped backend preserves a live reader but a cold tab asks who is reading', async ({ page, context, server }) => {
  const user = 'session-backend-offline';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const readerURL = page.url();
  const originalFrame = await page.locator('iframe').first().elementHandle();
  const sameFrame = () => originalFrame.evaluate(frame => frame.isConnected && frame === document.querySelector('iframe'));
  const recovery = page.getByRole('region', { name: 'App update and recovery' });

  await server.stop();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(recovery.getByText('Connection unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offline Profiles', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(readerURL);
  await expect(page.locator('footer')).toContainText('1 /');
  expect(await sameFrame()).toBe(true);

  const cold = await context.newPage();
  try {
    await cold.goto(`${server.origin}/library`);
    await expect(cold.getByRole('heading', { name: 'Offline Profiles', exact: true })).toBeVisible();
    await expect(cold.getByRole('button', { name: user, exact: true })).toBeVisible();
  } finally { await cold.close(); }

  await server.start();
  await recovery.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page).toHaveURL(readerURL);
  await expect(page.locator('footer')).toContainText('1 /');
  expect(await sameFrame()).toBe(true);
});
