import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });
async function open(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open synthetic EPUB', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'ready');
}

test('real StrictMode setup/cleanup, page/TOC/reflow KO-CFI round trips, remount and teardown', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const initial = await page.getByTestId('position').innerText();
  expect(initial).toMatch(/^\/body\/DocFragment\[1\]\/body/);
  const life = await page.evaluate(() => window.proof.lifecycle);
  expect(life.created).toBe(2); expect(life.disposed).toBe(1); expect(life.listeners).toBe(1);
  expect(await page.locator('[data-testid="reader-host"] iframe').count()).toBe(1);
  const sandbox = await page.locator('[data-testid="reader-host"] iframe').getAttribute('sandbox');
  expect(sandbox).toContain('allow-same-origin'); expect(sandbox).not.toContain('allow-scripts');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.proof.publications.length)).toBe(1);
  const next = await page.getByTestId('position').innerText();
  expect(next).not.toBe(initial);
  await page.getByRole('button', { name: 'Reflow 150%' }).click();
  await expect(page.getByRole('status')).toContainText('Reflow retained');
  expect(await page.getByTestId('position').innerText()).toBe(next);
  expect(await page.locator('[data-testid="reader-host"] iframe').evaluate((frame: HTMLIFrameElement, ko) => {
    const element = window.proof.elementFromKO(frame.contentDocument!, ko);
    return Array.from(element.getClientRects()).some(rect => rect.right > 0 && rect.left < frame.clientWidth && rect.bottom > 0 && rect.top < frame.clientHeight);
  }, next)).toBe(true);
  expect(await page.evaluate(() => window.proof.publications.length)).toBe(1);
  await page.screenshot({ path: '../../_scratch/m2/reader-storage/proof-page.png', fullPage: true });
  await page.getByRole('button', { name: 'Unmount reader' }).click();
  await expect(page.locator('[data-testid="reader-host"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.proof.lifecycle.listeners)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.proof.lifecycle.destroyed)).toBe(life.engines);
  await page.getByRole('button', { name: 'Reopen checkpoint' }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'ready');
  expect(await page.getByTestId('position').innerText()).toBe(next);
  const restoredVisible = await page.locator('[data-testid="reader-host"] iframe').evaluate((frame: HTMLIFrameElement, ko) => {
    const element = window.proof.elementFromKO(frame.contentDocument!, ko);
    return Array.from(element.getClientRects()).some(rect => rect.right > 0 && rect.left < frame.clientWidth && rect.bottom > 0 && rect.top < frame.clientHeight);
  }, next);
  expect(restoredVisible).toBe(true);
  await page.getByLabel('TOC', { exact: true }).selectOption({ label: 'Two' });
  await expect(page.getByTestId('position')).toContainText('DocFragment[2]');
  await expect.poll(() => page.evaluate(() => window.proof.publications.length)).toBe(2);
  const toc = await page.getByTestId('position').innerText();
  await page.getByRole('button', { name: 'Unmount reader' }).click();
  await page.getByRole('button', { name: 'Reopen checkpoint' }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'ready');
  expect(await page.getByTestId('position').innerText()).toBe(toc);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect.poll(() => page.evaluate(() => window.proof.publications.length)).toBe(3);
  // Queue Commands - Commands must not publish after unmount, including in-flight navigation.
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByRole('button', { name: 'Unmount reader' }).click();
  await expect.poll(() => page.evaluate(() => window.proof.lifecycle.destroyed === window.proof.lifecycle.engines)).toBe(true);
  const count = await page.evaluate(() => window.proof.publications.length);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.proof.publications.length)).toBe(count);
  expect(await page.evaluate(() => window.proof.lifecycle.listeners)).toBe(0);
  expect(errors).toEqual([]);
});

test('invalid saved location stays an error, retains checkpoint, never auto-publishes start', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.proof.publications.length)).toBe(1);
  const before = await page.evaluate(() => window.proof.repository.db.checkpoints.toArray());
  await page.getByRole('button', { name: 'Unmount reader' }).click();
  await page.getByRole('button', { name: 'Open invalid saved position' }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'error');
  await expect(page.getByRole('status')).toContainText('original retained');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Reader not ready');
  expect(await page.evaluate(() => window.proof.publications.length)).toBe(1);
  expect(await page.evaluate(() => window.proof.repository.db.checkpoints.toArray())).toEqual(before);
});

test('KO DOM codec retains descendant-index/omitted-anchor and namespace semantics at element precision', async ({ page }) => {
  const result = await page.evaluate(() => {
    const doc = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><h1><a><img id="image"/></a></h1><div><p id="one"/><div><p id="two"/></div></div></body></html>', 'application/xhtml+xml');
    const p = window.proof;
    return {
      image: p.elementFromKO(doc, '/body/DocFragment[19]/body/h1/img.0').id,
      written: p.koFromElement(18, doc.getElementById('image')!),
      nested: p.elementFromKO(doc, '/body/DocFragment[1]/body/div[1]/p[2]/text()[1].5').id,
      body: p.koFromElement(0, doc.querySelector('body')!)
    };
  });
  expect(result).toEqual({ image: 'image', written: '/body/DocFragment[19]/body/h1[1]/img[1]', nested: 'two', body: '/body/DocFragment[1]/body' });
});

test('stale progress requires visible explicit choice, including lower local progress', async ({ page }) => {
  await page.getByRole('button', { name: 'Stage stale local progress' }).click();
  await expect(page.getByRole('group', { name: 'Progress conflict' })).toBeVisible();
  await page.getByRole('button', { name: 'Use local position' }).click();
  await expect(page.getByText(/"fraction":0.2/)).toBeVisible();
});
