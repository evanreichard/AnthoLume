import { test, expect, register } from './fixtures';

const api = '**/api/v1/me/hardcover';

test('Hardcover shows generic callback feedback and previews an account-bound shelf without storing it', async ({ page, server }) => {
  await register(page, server.origin, 'shelf-reader');
  const { user } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
  let username: string | null = 'Hardcover Reader';
  let failPage = true;
  let shelfRequests = 0;
  await page.route(api, async route => {
    expect(route.request().headers()['x-antholume-account']).toBe(user.account_id);
    expect(route.request().headers()['x-antholume-reading-generation']).toBe(user.reading_generation);
    if (route.request().method() === 'DELETE') {
      expect(route.request().headers()['x-csrf-token']).toBeTruthy();
      username = null;
      await route.fulfill({ json: { revocation_confirmed: true } });
    } else await route.fulfill({ json: { enabled: true, username, reconnect_required: false } });
  });
  await page.route(`${api}/shelf?*`, async route => {
    shelfRequests++;
    expect(route.request().headers()['x-antholume-account']).toBe(user.account_id);
    const offset = new URL(route.request().url()).searchParams.get('offset');
    if (offset === '1' && failPage) {
      failPage = false;
      await route.fulfill({ status: 429, headers: { 'content-type': 'application/problem+json' }, json: { type: 'about:blank', title: 'Rate limited', status: 429, code: 'rate_limited', detail: 'Throttled' } });
      return;
    }
    await route.fulfill({ json: offset === '0' ? { books: [{ id: '1', title: 'Private first book', author: 'First author' }], next_offset: 1 } : { books: [{ id: '2', title: 'Private second book', author: 'Second author' }], next_offset: null } });
  });
  await page.goto(`${server.origin}/settings?hardcover=error`);
  const card = page.getByRole('region', { name: 'Connections', exact: true });
  await expect(card).toContainText('Hardcover was not connected. Try connecting again.');
  await expect(page).toHaveURL(`${server.origin}/settings`);
  await expect(card.getByText('Connected as Hardcover Reader', { exact: true })).toBeVisible();
  const preview = card.getByRole('button', { name: 'Hardcover', exact: true });
  expect(shelfRequests).toBe(0);
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'Want to Read' });
  await expect(dialog).toContainText('Private first book');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await dialog.getByRole('button', { name: 'Load More Books' }).click({ trial: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Load More Books' }).click();
  await expect(dialog).toContainText('Could not load more books from Hardcover.');
  await expect(dialog).toContainText('Private first book');
  await dialog.getByRole('button', { name: 'Retry Loading Books' }).click();
  await expect(dialog).toContainText('Private second book');
  await dialog.getByRole('button', { name: 'Close Dialog' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(preview).toBeFocused();
  expect(await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat().some(path => path.startsWith('/api/v1/me/hardcover')))).toBe(false);
  await preview.click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('dialog', { name: 'Disconnect?', exact: true }).getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Connect Hardcover' })).toBeVisible();
  await expect(card).not.toContainText('Private first book');

  await page.route(`${api}/connect`, route => route.fulfill({ json: { authorization_url: 'https://hardcover.app/oauth2/authorize?state=fixture' } }));
  await page.route('https://hardcover.app/oauth2/authorize?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Hardcover Consent</h1>' }));
  await card.getByRole('button', { name: 'Connect Hardcover' }).click();
  await expect(page.getByRole('heading', { name: 'Hardcover Consent' })).toBeVisible();
});

test('an unconfigured server never shows the Hardcover card, even after a stale callback', async ({ page, server }) => {
  await register(page, server.origin, 'unconfigured-reader');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(api, async route => { await pending; await route.continue(); });
  const check = page.waitForRequest(request => request.url().endsWith('/me/hardcover'));
  await page.goto(`${server.origin}/settings?hardcover=error`);
  await check;
  const card = page.getByRole('region', { name: 'Connections', exact: true });
  try { await expect(card).toHaveCount(0); } finally { release(); }
  await expect(page).toHaveURL(`${server.origin}/settings`);
  await expect(card).toHaveCount(0);
});

test('an initial Hardcover status error stays visible and can be retried', async ({ page, server }) => {
  await register(page, server.origin, 'status-retry-reader');
  let available = false;
  await page.route(api, route => available
    ? route.fulfill({ json: { enabled: true, username: 'Linked reader', reconnect_required: false } })
    : route.fulfill({ status: 502, contentType: 'application/problem+json', json: { type: 'about:blank', title: 'Unavailable', status: 502, code: 'hardcover_unavailable', detail: 'Try later' } }));
  await page.goto(`${server.origin}/settings`);
  const card = page.getByRole('region', { name: 'Connections' });
  await expect(card.getByText('Could not check your Hardcover connection.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Connect Hardcover' })).toHaveCount(0);
  available = true;
  await card.getByRole('button', { name: 'Retry Connection Check' }).click();
  await expect(card.getByText('Connected as Linked reader')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Retry Connection Check' })).toHaveCount(0);
});

for (const detection of ['loading another page', 'a status refresh']) {
  test(`a disconnect detected by ${detection} clears the open Hardcover shelf`, async ({ page, server }) => {
    await register(page, server.origin, 'remote-disconnect-reader');
    let username: string | null = 'Linked reader';
    let relinked = false;
    let releaseShelf!: () => void;
    const pendingShelf = new Promise<void>(resolve => { releaseShelf = resolve; });
    await page.route(api, route => route.fulfill({ json: { enabled: true, username, reconnect_required: false } }));
    await page.route(`${api}/shelf?*`, async route => {
      if (!username) return route.fulfill({ status: 409, contentType: 'application/problem+json', json: { type: 'about:blank', title: 'Disconnected', status: 409, code: 'hardcover_not_connected', detail: 'No link' } });
      const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
      if (relinked) {
        await pendingShelf;
        return route.fulfill({ json: { books: [{ id: 'new', title: 'New shelf book', author: '' }], next_offset: null } });
      }
      return route.fulfill({ json: { books: [{ id: `old-${offset}`, title: `Old shelf book ${offset}`, author: '' }], next_offset: offset + 1 } });
    });
    await page.goto(`${server.origin}/settings`);
    const card = page.getByRole('region', { name: 'Connections' });
    const preview = card.getByRole('button', { name: 'Hardcover', exact: true });
    await preview.click();
    const dialog = page.getByRole('dialog', { name: 'Want to Read' });
    await expect(dialog.getByText('Old shelf book 0')).toBeVisible();
    await dialog.getByRole('button', { name: 'Load More Books' }).click();
    await expect(dialog.getByText('Old shelf book 1')).toBeVisible();

    username = null;
    const rechecked = page.waitForResponse(response => response.url().endsWith('/me/hardcover') && response.ok());
    if (detection === 'loading another page') await dialog.getByRole('button', { name: 'Load More Books' }).click();
    else await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
    await rechecked;
    await expect(dialog).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Connect Hardcover' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry Loading Books' })).toHaveCount(0);

    relinked = true;
    username = 'Linked reader';
    try {
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
      await expect(preview).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await preview.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).not.toContainText('Old shelf book');
    } finally { releaseShelf(); }
    await expect(dialog).toContainText('New shelf book');
  });
}

test('a revoked shelf switches to an account-bound reconnect action without a reload', async ({ page, server }) => {
  await register(page, server.origin, 'revoked-reader');
  const { user } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
  let reconnectRequired = false;
  await page.route(api, route => route.fulfill({ json: { enabled: true, username: 'Linked reader', reconnect_required: reconnectRequired } }));
  await page.route(`${api}/shelf?*`, route => {
    reconnectRequired = true;
    return route.fulfill({ status: 409, contentType: 'application/problem+json', json: { type: 'about:blank', title: 'Reconnect required', status: 409, code: 'hardcover_reconnect', detail: 'Access revoked' } });
  });
  await page.route(`${api}/connect`, route => {
    expect(route.request().headers()['x-antholume-account']).toBe(user.account_id);
    expect(route.request().headers()['x-antholume-reading-generation']).toBe(user.reading_generation);
    return route.fulfill({ json: { authorization_url: 'https://hardcover.app/oauth2/authorize?state=reconnect' } });
  });
  await page.route('https://hardcover.app/oauth2/authorize?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Hardcover Consent</h1>' }));
  await page.goto(`${server.origin}/settings`);
  const connections = page.getByRole('region', { name: 'Connections' });
  const checked = page.waitForResponse(response => response.url().endsWith('/me/hardcover') && reconnectRequired);
  await connections.getByRole('button', { name: 'Hardcover', exact: true }).click();
  await checked;
  await expect(page.getByRole('dialog', { name: 'Want to Read' })).toHaveCount(0);
  await expect(connections.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await connections.getByRole('button', { name: 'Reconnect Hardcover' }).click();
  await expect(page.getByRole('heading', { name: 'Hardcover Consent' })).toBeVisible();
});

for (const localFailure of [false, true]) {
  test(localFailure ? 'a failed disconnect rechecks the local connection' : 'an uncertain revocation removes the local link and explains manual revocation', async ({ page, server }) => {
    await register(page, server.origin, 'disconnect-reader');
    const { user } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
    let username: string | null = 'Expired reader';
    await page.route(api, route => {
      expect(route.request().headers()['x-antholume-account']).toBe(user.account_id);
      if (route.request().method() !== 'DELETE') return route.fulfill({ json: { enabled: true, username, reconnect_required: !!username } });
      if (localFailure) return route.fulfill({ status: 502, contentType: 'application/problem+json', json: { type: 'about:blank', title: 'Unavailable', status: 502, code: 'hardcover_unavailable', detail: 'Try later' } });
      username = null;
      return route.fulfill({ json: { revocation_confirmed: false } });
    });
    await page.goto(`${server.origin}/settings`);
    const connections = page.getByRole('region', { name: 'Connections' });
    await expect(connections.getByRole('button', { name: 'Reconnect Hardcover' })).toBeVisible();
    await connections.getByRole('button', { name: 'Disconnect', exact: true }).click();
    const recheck = localFailure ? page.waitForResponse(response => response.url().endsWith('/me/hardcover') && response.request().method() === 'GET') : undefined;
    await page.getByRole('dialog', { name: 'Disconnect?', exact: true }).getByRole('button', { name: 'Disconnect', exact: true }).click();
    if (localFailure) {
      await recheck;
      await expect(connections).toContainText('Could not confirm the disconnect.');
      await expect(connections).not.toContainText('Disconnected from AnthoLume.');
      await expect(connections.getByRole('button', { name: 'Reconnect Hardcover' })).toBeVisible();
    } else {
      await expect(connections.getByRole('button', { name: 'Connect Hardcover' })).toBeVisible();
      await expect(connections).toContainText('Disconnected from AnthoLume. Hardcover did not confirm that access was revoked.');
      await expect(connections.getByRole('link', { name: 'Authorized Apps on Hardcover' })).toHaveAttribute('href', 'https://hardcover.app/account/api/authorized-apps');
      await expect(connections.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
    }
  });
}

test('leaving the initiating account while connect is pending never opens Hardcover consent', async ({ page, server }) => {
  await register(page, server.origin, 'first-shelf-reader');
  let finishConnect!: () => void;
  const pending = new Promise<void>(resolve => { finishConnect = resolve; });
  await page.route(api, route => route.fulfill({ json: { enabled: true, username: null, reconnect_required: false } }));
  await page.route(`${api}/connect`, async route => {
    await pending;
    await route.fulfill({ json: { authorization_url: 'https://hardcover.app/oauth2/authorize?state=stale' } });
  });
  let visitedConsent = false;
  await page.route('https://hardcover.app/oauth2/authorize?*', route => { visitedConsent = true; return route.abort(); });
  await page.goto(`${server.origin}/settings`);
  const sent = page.waitForRequest(request => request.url().endsWith('/api/v1/me/hardcover/connect'));
  await page.getByRole('button', { name: 'Connect Hardcover' }).click();
  await sent;
  try {
    await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign Out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  } finally { finishConnect(); }
  await register(page, server.origin, 'second-shelf-reader');
  await page.goto(`${server.origin}/settings`);
  await expect(page.getByRole('button', { name: 'Connect Hardcover' })).toBeEnabled();
  expect(visitedConsent).toBe(false);
});
