import { test, expect, register } from './fixtures';

test('a real authenticated cookie cold-starts a new reader database without losing the selected account', async ({ page, browser, server }) => {
  await register(page, server.origin, 'reader-cold-cookie');
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const cold = await context.newPage();
    await cold.goto(`${server.origin}/app/library`);
    await cold.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    await cold.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(cold.getByRole('button', { name: 'Remove offline', exact: true })).toBeEnabled();
    await cold.getByRole('link', { name: 'Resume', exact: true }).click();
    await expect(cold.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready');
  } finally { await context.close(); }
});
