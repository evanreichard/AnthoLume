import { test, expect, register, importBook } from './fixtures';

test('one named 44px Clear search clears draft and applied q, preserves filters, and returns focus to search', async ({ page, server }) => {
  await register(page, server.origin, `clear-${Date.now()}`);
  await page.goto(`${server.origin}/app/library?q=Public+book+01&source=server&availability=unavailable`);
  await expect(page.getByRole('article')).toHaveCount(1);
  const search = page.getByRole('searchbox', { name: 'Search title or author', exact: true });
  await search.fill('Different unsubmitted draft');
  const clear = page.getByRole('button', { name: 'Clear search', exact: true });
  await expect(clear).toHaveCount(1);
  const box = await clear.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="search"]' });
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: -1, pierce: true });
    type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
    function findCancel(node: Node): Node | undefined {
      if (node.attributes?.includes('-webkit-search-cancel-button')) return node;
      for (const child of [...node.children || [], ...node.shadowRoots || []]) { const found = findCancel(child); if (found) return found; }
    }
    const cancel = findCancel(node);
    const box = cancel ? await cdp.send('DOM.getBoxModel', { backendNodeId: cancel.backendNodeId }).catch((error) => {
      if (String(error).includes('Could not compute box model')) return null;
      throw error;
    }) : null;
    expect(!!box && box.model.width > 0 && box.model.height > 0).toBe(false);
  } finally { await cdp.detach(); }
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.getByRole('article')).toHaveCount(24);
  const params = new URL(page.url()).searchParams;
  expect(params.has('q')).toBe(false);
  expect(params.get('source')).toBe('server');
  expect(params.get('availability')).toBe('unavailable');
  await expect(clear).toHaveCount(0);
});

test('filter draft count, Reset, Apply and Cancel/Escape/Back operate on real loaded books without draft API calls', async ({ page, server }) => {
  await register(page, server.origin, `filters-${Date.now()}`);
  await importBook(page, 'Filter local original');
  await expect(page.getByRole('article')).toHaveCount(25);
  const requests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/documents') requests.push(request.url()); });
  const filter = page.getByRole('button', { name: 'Filter books', exact: true });
  await filter.click();
  await page.getByLabel('Source', { exact: true }).selectOption('local');
  await page.getByLabel('Availability', { exact: true }).selectOption('available');
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('1 matching loaded title');
  await expect(page.getByRole('article')).toHaveCount(25);
  expect(new URL(page.url()).searchParams.has('source')).toBe(false);
  expect(requests).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(25);
  await expect(filter).toBeFocused();
  await filter.click();
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('all');
  await page.getByLabel('Source', { exact: true }).selectOption('server');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(25);
  await filter.click();
  await page.getByLabel('Source', { exact: true }).selectOption('local');
  await page.getByLabel('Availability', { exact: true }).selectOption('available');
  await page.getByRole('button', { name: 'Apply filters · 1 loaded', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(filter).toBeFocused();
  await expect(page).toHaveURL(/source=local/);
  await filter.click();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('25 matching loaded titles');
  await expect(page.getByRole('dialog')).toContainText('25 loaded or stored titles only');
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(requests).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article')).toHaveCount(1);
  await filter.click();
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('local');
  await expect(page.getByLabel('Availability', { exact: true })).toHaveValue('available');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.getByRole('button', { name: 'Apply filters · 25 loaded', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(25);
  await page.goBack();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page).toHaveURL(/source=local/);
  await filter.click();
  await page.getByLabel('Source', { exact: true }).selectOption('server');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(filter).toBeFocused();
});
