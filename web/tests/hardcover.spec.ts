import { test, expect, register } from './fixtures';

const api = '**/api/v1/me/hardcover';
const problem = (status: number, code: string) => ({
  status, contentType: 'application/problem+json', json: { type: 'about:blank', title: code, status, code, detail: code },
});

test('Hardcover lazily loads the shelf and retries a failed next page', async ({ page, server }) => {
  await register(page, server.origin, 'shelf-reader');
  let username: string | null = 'Hardcover Reader';
  let failPage = true;
  let shelfRequests = 0;
  await page.route(api, route => {
    if (route.request().method() !== 'DELETE') return route.fulfill({ json: { enabled: true, username, reconnect_required: false } });
    username = null;
    return route.fulfill({ status: 204 });
  });
  await page.route(`${api}/shelf?*`, route => {
    shelfRequests++;
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    if (offset === 1 && failPage) {
      failPage = false;
      return route.fulfill(problem(429, 'rate_limited'));
    }
    return route.fulfill({ json: { books: [{ id: `${offset}`, title: `Private book ${offset}`, author: '' }], next_offset: offset === 0 ? 1 : null } });
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`${server.origin}/settings`);
  const card = page.getByRole('region', { name: 'Connections' });
  const preview = card.getByRole('button', { name: 'Hardcover', exact: true });
  await expect(preview).toBeVisible();
  expect(shelfRequests).toBe(0);
  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'Want to Read' });
  await expect(dialog).toContainText('Private book 0');
  await dialog.getByRole('button', { name: 'Load More Books' }).click();
  await expect(dialog).toContainText('Could not load more books from Hardcover.');
  await expect(dialog).toContainText('Private book 0');
  await dialog.getByRole('button', { name: 'Retry Loading Books' }).click();
  await expect(dialog).toContainText('Private book 1');
  await dialog.getByRole('button', { name: 'Close Dialog' }).click();
  await expect(preview).toBeFocused();
  await preview.click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('dialog', { name: 'Disconnect?' }).getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Connect Hardcover' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

for (const enabled of [false, true]) {
  test(`a failed status check can be retried when Hardcover is ${enabled ? 'enabled' : 'disabled'}`, async ({ page, server }) => {
    await register(page, server.origin, 'status-retry-reader');
    if (enabled) await page.route(api, route => route.fulfill({ json: { enabled: true, username: 'Linked reader', reconnect_required: false } }));
    await page.route(api, route => route.fulfill(problem(502, 'hardcover_unavailable')), { times: 1 });
    await page.goto(`${server.origin}/settings${enabled ? '' : '?hardcover=error'}`);
    const card = page.getByRole('region', { name: 'Connections' });
    await expect(card).toContainText('Could not check your Hardcover connection.');
    await expect(card.getByRole('button', { name: 'Connect Hardcover' })).toHaveCount(0);
    if (!enabled) {
      await expect(card).toContainText('Hardcover was not connected. Try connecting again.');
      await expect(page).toHaveURL(`${server.origin}/settings`);
    }
    const checked = page.waitForResponse(response => response.url().endsWith('/me/hardcover') && response.ok());
    await card.getByRole('button', { name: 'Retry Connection Check' }).click();
    expect((await (await checked).json()).enabled).toBe(enabled);
    if (enabled) {
      await expect(card).toContainText('Connected as Linked reader');
      await expect(card.getByRole('button', { name: 'Retry Connection Check' })).toHaveCount(0);
    } else await expect(card).toHaveCount(0);
  });
}

for (const lostBy of ['shelf disconnect', 'status disconnect', 'status reconnect required']) {
  test(`${lostBy} closes the open Hardcover shelf`, async ({ page, server }) => {
    await register(page, server.origin, 'remote-disconnect-reader');
    let username: string | null = 'Linked reader';
    let reconnectRequired = false;
    let relinked = false;
    let releaseShelf!: () => void;
    const pendingShelf = new Promise<void>(resolve => { releaseShelf = resolve; });
    await page.route(api, route => route.fulfill({ json: { enabled: true, username, reconnect_required: reconnectRequired } }));
    await page.route(`${api}/shelf?*`, async route => {
      if (!username) return route.fulfill(problem(409, 'hardcover_not_connected'));
      if (relinked) {
        await pendingShelf;
        return route.fulfill({ json: { books: [{ id: 'new', title: 'New shelf book', author: '' }], next_offset: null } });
      }
      const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
      return route.fulfill({ json: { books: [{ id: `old-${offset}`, title: `Old shelf book ${offset}`, author: '' }], next_offset: offset + 1 } });
    });
    await page.goto(`${server.origin}/settings`);
    const card = page.getByRole('region', { name: 'Connections' });
    const preview = card.getByRole('button', { name: 'Hardcover', exact: true });
    await preview.click();
    const dialog = page.getByRole('dialog', { name: 'Want to Read' });
    await expect(dialog.getByText('Old shelf book 0')).toBeVisible();
    const loadMore = dialog.getByRole('button', { name: 'Load More Books' });
    const detectedOnShelf = lostBy === 'shelf disconnect';
    if (detectedOnShelf) {
      await loadMore.click();
      await expect(dialog.getByText('Old shelf book 1')).toBeVisible();
    }
    reconnectRequired = lostBy === 'status reconnect required';
    if (!reconnectRequired) username = null;
    const rechecked = page.waitForResponse(response => response.url().endsWith('/me/hardcover') && response.ok());
    if (detectedOnShelf) await loadMore.click();
    else await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
    await rechecked;
    await expect(card.getByRole('button', { name: reconnectRequired ? 'Reconnect Hardcover' : 'Connect Hardcover' })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry Loading Books' })).toHaveCount(0);
    if (lostBy === 'status disconnect') return;

    relinked = true;
    username = 'Linked reader';
    reconnectRequired = false;
    try {
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
      await expect(preview).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await preview.click();
      await expect(dialog).toContainText('Loading your Want to Read shelf…');
      await expect(dialog).not.toContainText('Old shelf book');
    } finally { releaseShelf(); }
    await expect(dialog).toContainText('New shelf book');
  });
}

test('a revoked shelf prompts the reader to reconnect without reloading Settings', async ({ page, server }) => {
  await register(page, server.origin, 'revoked-reader');
  let reconnectRequired = false;
  await page.route(api, route => route.fulfill({ json: { enabled: true, username: 'Linked reader', reconnect_required: reconnectRequired } }));
  await page.route(`${api}/shelf?*`, route => {
    reconnectRequired = true;
    return route.fulfill(problem(409, 'hardcover_reconnect'));
  });
  await page.route(`${api}/connect`, route => route.fulfill({ json: { authorization_url: 'https://hardcover.app/oauth2/authorize?state=reconnect' } }));
  await page.route('https://hardcover.app/oauth2/authorize?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Hardcover Consent</h1>' }));
  await page.goto(`${server.origin}/settings`);
  const connections = page.getByRole('region', { name: 'Connections' });
  await connections.getByRole('button', { name: 'Hardcover', exact: true }).click();
  const reconnect = connections.getByRole('button', { name: 'Reconnect Hardcover' });
  await expect(reconnect).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Want to Read' })).toHaveCount(0);
  await expect(connections.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await reconnect.click();
  await expect(page.getByRole('heading', { name: 'Hardcover Consent' })).toBeVisible();
});

for (const outcome of ['linked', 'disconnected', 'unknown']) {
  test(`a failed disconnect checks whether the local link is ${outcome}`, async ({ page, server }) => {
    await register(page, server.origin, 'disconnect-reader');
    let attempted = false;
    await page.route(api, route => {
      if (route.request().method() === 'DELETE') {
        attempted = true;
        return route.fulfill(problem(502, 'hardcover_unavailable'));
      }
      if (attempted && outcome === 'unknown') return route.fulfill(problem(502, 'hardcover_unavailable'));
      const linked = !attempted || outcome === 'linked';
      return route.fulfill({ json: { enabled: true, username: linked ? 'Expired reader' : null, reconnect_required: linked } });
    });
    await page.goto(`${server.origin}/settings`);
    const connections = page.getByRole('region', { name: 'Connections' });
    await connections.getByRole('button', { name: 'Disconnect', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Disconnect?' });
    await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (outcome === 'linked') {
      await expect(connections).toContainText('Could not disconnect Hardcover. Try again.');
      await expect(connections.getByRole('button', { name: 'Reconnect Hardcover' })).toBeVisible();
    } else if (outcome === 'disconnected') {
      await expect(connections.getByRole('button', { name: 'Connect Hardcover' })).toBeVisible();
      await expect(connections.getByRole('alert')).toHaveCount(0);
    } else {
      await expect(connections.getByRole('button', { name: 'Retry Connection Check' })).toBeVisible();
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
