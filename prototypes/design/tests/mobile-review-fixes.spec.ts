import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const article = (page: Page) => page.locator('article.page-text');
async function open(page: Page, route: string, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`/?direction=folio&theme=light#${route}`);
}
async function touchTarget(control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  return box!;
}
type ShadowNode = {
  nodeId: number;
  attributes?: string[];
  children?: ShadowNode[];
  shadowRoots?: ShadowNode[];
};
// UA Shadow Check - Chromium's host/pseudo getComputedStyle result does not expose the real cancel decoration.
async function nativeCancelHidden(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type="search"]',
    });
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: -1, pierce: true });
    function findCancel(node: ShadowNode): ShadowNode | undefined {
      if (node.attributes?.includes('-webkit-search-cancel-button')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const found = findCancel(child);
        if (found) return found;
      }
    }
    const cancel = findCancel(node);
    expect(cancel).toBeDefined();
    await cdp.send('CSS.enable');
    const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', {
      nodeId: cancel!.nodeId,
    });
    expect(computedStyle.find((style) => style.name === 'display')?.value).toBe('none');
  } finally {
    await cdp.detach();
  }
}

async function edge(page: Page, side: 'left' | 'right' | 'center') {
  const box = (await article(page).boundingBox())!;
  return {
    x: box.x + box.width * (side === 'left' ? 0.03 : side === 'right' ? 0.97 : 0.5),
    y: box.y + box.height / 2,
  };
}
async function expectAnchor(page: Page, anchor: number) {
  await expect(article(page)).toHaveAttribute('data-anchor', String(anchor));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
}

for (const width of [320, 390]) {
  test(`M1 ${width}: populated search has one clear action, a 44px target and keyboard return`, async ({
    page,
  }) => {
    await open(page, '/library', width);
    const search = page.getByRole('searchbox', { name: 'Search title or author' });
    await search.fill('Field');
    const clear = page.getByRole('button', { name: 'Clear search', exact: true });
    await expect(clear).toHaveCount(1);
    const clearBox = await touchTarget(clear);
    await nativeCancelHidden(page);
    const filterBox = await touchTarget(
      page.getByRole('button', { name: 'Filter library', exact: true }),
    );
    const searchBox = (await search.boundingBox())!;
    expect(clearBox.x + clearBox.width).toBeLessThan(filterBox.x);
    expect(Math.abs(clearBox.y - filterBox.y)).toBeLessThan(8);
    expect(searchBox.width).toBeGreaterThan(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const directory = resolve(
      process.env.M2_SCREENSHOT_DIR || '../../_scratch/m2/design/screenshots',
    );
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/folio-clear-${width}.png` });
    await search.focus();
    await page.keyboard.press('Tab');
    await expect(clear).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page).not.toHaveURL(/q=/);
    await search.fill('no matching title');
    await expect(clear).toHaveCount(1);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page.locator('.book-card')).toHaveCount(5);
  });
}

async function assertEdgeTaps(page: Page, tap: (x: number, y: number) => Promise<void>) {
  await open(page, '/read/tidal');
  const nextAnchor = Number(await article(page).getAttribute('data-page-end'));
  const right = await edge(page, 'right');
  await tap(right.x, right.y);
  await expectAnchor(page, nextAnchor);
  await expect(article(page)).toBeFocused();
  await page.waitForTimeout(250);
  await expectAnchor(page, nextAnchor);
  const center = await edge(page, 'center');
  await tap(center.x, center.y);
  await expectAnchor(page, nextAnchor);
  await expect(page.getByRole('button', { name: 'Contents', exact: true })).toBeVisible();
  const left = await edge(page, 'left');
  await tap(left.x, left.y);
  await expectAnchor(page, 0);
  await tap(left.x, left.y);
  await expectAnchor(page, 0);
}

test('M2 mouse edge taps turn once and center tap leaves controls unchanged', async ({ page }) => {
  await assertEdgeTaps(page, (x, y) => page.mouse.click(x, y));
});

test.describe('M2 real touch', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('edge taps turn once without a compatibility-click second turn', async ({ page }) => {
    await assertEdgeTaps(page, (x, y) => page.touchscreen.tap(x, y));
  });

  test('horizontal swipe plus synthesized click never double-advances; the next real tap works', async ({
    page,
  }) => {
    await open(page, '/read/tidal');
    const expected = Number(await article(page).getAttribute('data-page-end'));
    const box = (await article(page).boundingBox())!;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 280, y }],
      });
      for (const x of [240, 200, 160, 100]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expectAnchor(page, expected);
      const right = await edge(page, 'right');
      await article(page).dispatchEvent('click', { clientX: right.x, clientY: right.y, detail: 1 });
      await page.waitForTimeout(250);
      await expectAnchor(page, expected);
      const following = Number(await article(page).getAttribute('data-page-end'));
      await page.touchscreen.tap(right.x, right.y);
      await expectAnchor(page, following);
    } finally {
      await cdp.detach();
    }
  });
});

test('M2 selection and interactive descendants do not turn pages or suppress their own actions', async ({
  page,
}) => {
  await open(page, '/read/tidal');
  const right = await edge(page, 'right');
  const selectText = () =>
    page.evaluate(() => {
      const paragraph = document.querySelector('article.page-text p')!;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await selectText();
  await page.mouse.click(right.x, right.y);
  await expectAnchor(page, 0);
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.mouse.move(right.x, right.y);
  await page.mouse.down();
  await selectText();
  await page.mouse.up();
  await expectAnchor(page, 0);
  await page.evaluate(() => {
    getSelection()?.removeAllRanges();
    const paragraph = document.querySelector('article.page-text p')!;
    for (const [tag, top] of [
      ['button', '20px'],
      ['a', '75px'],
    ]) {
      const control = document.createElement(tag);
      control.textContent = `Sample ${tag}`;
      if (tag === 'a') control.setAttribute('href', '#');
      control.setAttribute(
        'style',
        `position:absolute;right:0;top:${top};width:70px;height:44px;z-index:5`,
      );
      control.addEventListener('click', (event) => {
        event.preventDefault();
        control.dataset.activated = 'true';
      });
      paragraph.appendChild(control);
    }
  });
  for (const name of ['Sample button', 'Sample a']) {
    const control = page.getByText(name, { exact: true });
    await control.click();
    await expect(control).toHaveAttribute('data-activated', 'true');
    await expectAnchor(page, 0);
  }
  await page.evaluate(() =>
    document
      .querySelectorAll('article.page-text button, article.page-text a')
      .forEach((element) => element.remove()),
  );
  const next = Number(await article(page).getAttribute('data-page-end'));
  await page.mouse.click(right.x, right.y);
  await expectAnchor(page, next);
});

test('M2 a drag returning to its start, vertical travel, cancelled pointers and click-only events do not flip', async ({
  page,
}) => {
  await open(page, '/read/tidal');
  const point = await edge(page, 'right');
  const props = { pointerId: 1, isPrimary: true, button: 0, clientX: point.x, clientY: point.y };
  await article(page).dispatchEvent('pointerdown', props);
  await article(page).dispatchEvent('pointermove', { ...props, clientX: point.x - 45 });
  await article(page).dispatchEvent('pointerup', props);
  await expectAnchor(page, 0);
  await article(page).dispatchEvent('pointerdown', props);
  await article(page).dispatchEvent('pointerup', { ...props, clientY: point.y + 45 });
  await expectAnchor(page, 0);
  await article(page).dispatchEvent('pointerdown', props);
  await article(page).dispatchEvent('pointercancel', props);
  await article(page).dispatchEvent('pointerup', props);
  await article(page).dispatchEvent('click', { clientX: point.x, clientY: point.y, detail: 1 });
  await expectAnchor(page, 0);
});
