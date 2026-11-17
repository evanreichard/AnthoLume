import { test, expect, register, importBook } from './fixtures';

for (const remaining of [0, 1]) {
  test(`successful local removal focuses the stable Library heading with ${remaining} remaining books; cancel restores its opener`, async ({ page, server }) => {
    await page.goto(`${server.origin}/app/library`);
    await importBook(page, 'Removal original');
    if (remaining) await importBook(page, 'Surviving original');
    await page.getByRole('heading', { name: 'Removal original', exact: true }).click();
    const opener = page.getByRole('button', { name: 'Remove offline', exact: true });
    await opener.click();
    await page.getByRole('button', { name: 'Keep book', exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove offline', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(remaining);
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.isConnected && document.activeElement?.tagName !== 'BODY')).toBe(true);
  });
}

test('completed shared download and offline removal focus the surviving book heading after projection', async ({ page, server }) => {
  await register(page, server.origin, `focus-${Date.now()}`);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'Public book 01', exact: true });
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('✓ Available offline', { exact: true })).toBeVisible();
  await expect(heading).toBeFocused();
  const opener = page.getByRole('button', { name: 'Remove offline', exact: true });
  await opener.click();
  await page.getByRole('button', { name: 'Keep book', exact: true }).click();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove offline', exact: true }).click();
  await expect(page.getByText('Not stored offline', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  await expect(heading).toBeFocused();
});
