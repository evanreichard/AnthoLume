import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('when chapter callbacks are blocked, center taps and swipes work without enabling chapter scripts', async ({ page }) => {
  await page.addInitScript(() => {
    const dispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (event) {
      if ((this as Node).ownerDocument?.title === 'Reader input check') return true;
      return dispatch.call(this, event);
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => {
    const api = window.readingTest, ref = { kind: 'local' as const, localId: 'gesture-layer' };
    const repo = new api.Repository();
    await repo.install(ref, await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(), 'Gesture test', null, null);
    repo.db.close();
    const forbidden = async () => { throw new Error('Local reading must not call the server'); };
    api.mount({ registerDevice: forbidden, getState: forbidden, fetchFile: forbidden, fetchCover: forbidden, submitProgress: forbidden, submitActivity: forbidden }, ref);
  });
  const reader = page.getByRole('region', { name: 'Book reader' });
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  const layer = reader.locator('[data-reader-gesture-layer]'), footer = reader.locator('footer span');
  await expect(layer).toBeVisible();
  await expect(reader.locator('iframe')).toHaveAttribute('sandbox', 'allow-same-origin');
  const box = (await layer.boundingBox())!, x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
  await page.touchscreen.tap(x, y);
  const select = reader.getByRole('button', { name: 'Select Text', exact: true });
  await expect(select).toBeHidden();
  const progress = reader.getByRole('button', { name: 'Reading progress and appearance' });
  await progress.tap();
  const panel = reader.getByRole('complementary', { name: 'Appearance', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Reading progress', { exact: true })).toHaveCount(0);
  await expect(progress).toHaveText(/\d+ \/ \d+ · \d+%/);
  const fonts = reader.getByRole('combobox', { name: 'Font' });
  await expect(fonts.getByRole('option', { name: 'System Serif', exact: true })).toHaveAttribute('value', 'serif');
  await expect(fonts.getByRole('option', { name: 'System Sans Serif', exact: true })).toHaveAttribute('value', 'sans-serif');
  await expect(fonts.getByRole('option', { name: 'System Monospace', exact: true })).toHaveAttribute('value', 'monospace');
  await expect(select).toBeVisible();
  await expect(reader.getByRole('button', { name: 'Contents' })).toBeVisible();
  await select.tap();
  await expect(layer).toHaveCount(0);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.localName, { x, y })).toBe('iframe');
  await reader.getByRole('button', { name: 'Done', exact: true }).tap();
  await expect(layer).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (dx: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const t of [.25, .5, .75, 1]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * t, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const before = await footer.textContent();
  await swipe(-120);
  await expect.poll(() => footer.textContent()).not.toBe(before);
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');
  const after = await footer.textContent();
  await swipe(120);
  await expect.poll(() => footer.textContent()).not.toBe(after);
  await expect(reader).toHaveAttribute('data-reader-state', 'ready');

  const checkpoint = () => page.evaluate(async () => {
    const db = new window.readingTest.ReadingDB();
    try { return (await db.books.toArray())[0]?.checkpoint; } finally { db.close(); }
  });
  const position = await checkpoint();
  const twoFingers = (radius: number) => [{ x: x - radius, y, id: 1 }, { x: x + radius, y, id: 2 }];
  const pinch = async (from: number, to: number, size: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: twoFingers(from) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: twoFingers(to) });
    const hud = reader.getByLabel('Text size', { exact: true });
    await expect(hud).toHaveText(`Aa ${size}%`);
    await expect(reader).toHaveAttribute('data-reader-state', 'ready');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(hud).toHaveCount(0);
    await expect(reader).toHaveAttribute('data-reader-state', 'ready');
    expect(await checkpoint()).toEqual(position);
  };
  await pinch(60, 90, 150);
  await pinch(90, 20, 50);
  await reader.getByRole('button', { name: 'Show reader controls' }).press('Enter');
  await progress.tap();
  await expect(reader.getByRole('slider', { name: 'Text size' })).toHaveValue('50');
  await expect(reader.getByRole('button', { name: 'Decrease text size' })).toBeDisabled();
});
