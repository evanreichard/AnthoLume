import { randomUUID } from 'node:crypto';
import { test, expect, register, epub } from './fixtures';

test('Library searches for literal all and Book Detail returns to the filtered Library', async ({ page, server }) => {
  await register(page, server.origin, 'literal-search-reader');
  await page.goto(`${server.origin}/library?sort=author`);
  const search = page.getByRole('searchbox', { name: 'Search title or author', exact: true });
  await search.fill('all');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/library\?sort=author&q=all$/);
  await expect(page.getByText('No matching books.', { exact: false })).toBeVisible();

  await search.fill('Public book 01');
  await search.press('Enter');
  await page.route('**/api/v1/documents/book_001', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      json: { type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' },
    }),
  );
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/server\?/);
  await expect(page.getByRole('heading', { name: 'Book not available', exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library\?q=Public\+book\+01&sort=author$/);
  await expect(search).toHaveValue('Public book 01');
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('one named 44px Clear Search clears draft and applied q, preserves sort, and returns focus to search', async ({
  page,
  server,
}) => {
  await register(page, server.origin, `clear-${Date.now()}`);
  await page.goto(`${server.origin}/library?q=Public+book+01&sort=author`);
  await expect(page.getByRole('article')).toHaveCount(1);
  const search = page.getByRole('searchbox', { name: 'Search title or author', exact: true });
  await search.fill('Different unsubmitted draft');
  const clear = page.getByRole('button', { name: 'Clear Search', exact: true });
  await expect(clear).toHaveCount(1);
  const box = await clear.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="search"]' });
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: -1, pierce: true });
    type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
    function findCancel(node: Node): Node | undefined {
      if (node.attributes?.includes('-webkit-search-cancel-button')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const found = findCancel(child);
        if (found) return found;
      }
    }
    const cancel = findCancel(node);
    const box = cancel
      ? await cdp.send('DOM.getBoxModel', { backendNodeId: cancel.backendNodeId }).catch((error) => {
          if (String(error).includes('Could not compute box model')) return null;
          throw error;
        })
      : null;
    expect(!!box && box.model.width > 0 && box.model.height > 0).toBe(false);
  } finally {
    await cdp.detach();
  }
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByRole('article')).toHaveCount(24);
  const params = new URL(page.url()).searchParams;
  expect(params.has('q')).toBe(false);
  expect(params.get('sort')).toBe('author');
  await expect(clear).toHaveCount(0);
});

test('the Library defaults to Last Read and features the last shared checkpoint independently of grid sort', async ({
  page,
  server,
}) => {
  await register(page, server.origin, 'continue-reader');
  const { csrf_token, user } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
  const headers = {
    Origin: server.origin,
    'X-CSRF-Token': csrf_token,
    'X-AnthoLume-Reading-Generation': user.reading_generation,
  };
  for (const [path, data] of [
    ['devices', { id: 'other-device', name: 'Other device' }],
    [
      'reading-progress',
      {
        event_id: randomUUID(),
        document_id: 'book_030',
        device_id: 'other-device',
        observed_at: new Date().toISOString(),
        base_revision: '0',
        position: '/body/DocFragment[1]/body/p[2]',
        fraction: 0.24,
      },
    ],
  ] as const) {
    const response = await page.request.post(`${server.origin}/api/v1/me/${path}`, { headers, data });
    expect(response.status(), await response.text()).toBe(200);
  }
  await page.reload();
  const feature = page.getByRole('region', { name: 'Continue reading' });
  await expect(feature.getByRole('heading')).toHaveText('Public book 30');
  await expect(feature.getByText('24% read', { exact: true })).toBeVisible();
  await expect(feature.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', /\/read\/server\?id=book_030&/);
  await expect(page.getByRole('article').first().getByRole('heading')).toHaveText('Public book 30');
  await page.getByRole('button', { name: 'Sort Books' }).click();
  await expect(page.getByRole('button', { name: 'Last Read', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Title A–Z', exact: true }).click();
  await expect(page.getByRole('article').first().getByRole('heading')).toHaveText('Public book 01');
  await expect(feature.getByRole('heading')).toHaveText('Public book 30');
});

test('Add book uploads to the shared library and Recently Added includes it on page one', async ({
  page,
  browser,
  server,
}) => {
  await register(page, server.origin, 'upload-reader');
  await page.goto(`${server.origin}/library?q=ZZ&sort=added`);
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await page.getByLabel('Choose EPUB to upload').setInputFiles({
    name: 'upload.epub',
    mimeType: 'application/epub+zip',
    buffer: await epub('ZZ Shared Upload'),
  });
  await expect(page.getByRole('dialog', { name: 'Add Book' })).toHaveCount(0);
  await expect(page).toHaveURL(`${server.origin}/library?q=ZZ&sort=added`);
  const notice = page.locator('[data-snackbar]');
  await expect(notice.getByRole('status')).toHaveText('Book added to the library');
  await notice.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/server\?/);
  await expect(page.getByRole('heading', { name: 'ZZ Shared Upload', exact: true })).toBeVisible();
  const read = page.getByRole('link', { name: 'Read', exact: true });
  await expect(read).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(`${server.origin}/library?q=ZZ&sort=added`);
  const other = await browser.newPage();
  try {
    await register(other, server.origin, 'other-upload-reader');
    await other.getByRole('button', { name: 'Sort Books', exact: true }).click();
    await other.getByRole('button', { name: 'Recently Added', exact: true }).click();
    await expect(other.getByRole('article').first().getByRole('heading')).toHaveText('ZZ Shared Upload');
  } finally {
    await other.close();
  }
});
