import { expect, test, type Page } from '@playwright/test';

const status = (page: Page) => page.getByRole('status', { name: '', exact: true });
const snackbar = (page: Page) => page.locator('[data-snackbar]');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const click = (page: Page, name: string) => button(page, name).dispatchEvent('click');

async function visibility(page: Page, hidden: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/snackbar.html');
  await expect(button(page, 'Show Info A')).toBeVisible();
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2030-01-01T00:01:00Z'));
});

test('announces without moving focus; repeat shows refresh one 3-second slot', async ({ page }) => {
  const trigger = button(page, 'Show Info A');
  await trigger.focus();
  await click(page, 'Show Info A');
  await expect(status(page)).toHaveText('Notice A / initial');
  await expect(trigger).toBeFocused();
  await page.clock.runFor(2500);
  await click(page, 'Show Info A');
  await expect(snackbar(page)).toHaveCount(1);
  await page.clock.runFor(2999);
  await expect(snackbar(page)).toBeVisible();
  await page.clock.runFor(1);
  await expect(snackbar(page)).toHaveCount(0);
  await expect(status(page)).toBeEmpty();
});

test('actionable notices stay for 9 seconds and Retry runs once; Dismiss does not run it', async ({ page }) => {
  await click(page, 'Show Action A');
  await expect(button(page, 'Retry')).toBeVisible();
  await page.clock.runFor(8999);
  await expect(button(page, 'Retry')).toBeVisible();
  await page.clock.runFor(1);
  await expect(snackbar(page)).toHaveCount(0);

  const trigger = button(page, 'Show Action A');
  const actions = page.getByRole('status', { name: 'Actions A', exact: true });
  await trigger.focus();
  await click(page, 'Show Action A');
  await button(page, 'Dismiss').focus();
  await page.keyboard.press('Enter');
  await expect(snackbar(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(actions).toHaveText('0');

  await click(page, 'Show Action A');
  await button(page, 'Retry').focus();
  await page.keyboard.press('Enter');
  await expect(actions).toHaveText('1');
  await expect(snackbar(page)).toHaveCount(0);
});

test('hover, keyboard focus, and a hidden tab independently pause the remaining time', async ({ page }) => {
  await click(page, 'Show Info A');
  await expect(snackbar(page)).toBeVisible();
  await page.clock.runFor(1000);
  const rect = (await snackbar(page).boundingBox())!;
  await page.mouse.move(rect.x + 4, rect.y + 4);
  await page.clock.runFor(5000);
  await expect(snackbar(page)).toBeVisible();

  await button(page, 'Dismiss').focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(5000);
  await expect(snackbar(page)).toBeVisible();

  await visibility(page, true);
  await button(page, 'Show Info A').focus();
  await page.clock.runFor(5000);
  await expect(snackbar(page)).toBeVisible();

  await visibility(page, false);
  await page.clock.runFor(1999);
  await expect(snackbar(page)).toBeVisible();
  await page.clock.runFor(1);
  await expect(snackbar(page)).toHaveCount(0);
});

test('newest wins; stale and unmounted owners cannot clear or replace it', async ({ page }) => {
  await click(page, 'Remember A');
  await click(page, 'Show Action A');
  await expect(button(page, 'Retry')).toBeVisible();
  await click(page, 'Show Info B');
  await expect(status(page)).toHaveText('Notice B');
  await expect(button(page, 'Retry')).toHaveCount(0);
  await click(page, 'Dismiss A');
  await click(page, 'Change Scope A');
  await click(page, 'Dismiss From Old Handle');
  await click(page, 'Show From Old Handle');
  await click(page, 'Unmount A');
  await click(page, 'Show From Old Handle');
  await expect(status(page)).toHaveText('Notice B');
  await click(page, 'Dismiss B');
  await expect(snackbar(page)).toHaveCount(0);
});

test('tabs in the same browser context have independent slots', async ({ page, context }) => {
  await click(page, 'Show Info A');
  await expect(status(page)).toHaveText('Notice A / initial');
  const other = await context.newPage();
  try {
    await other.goto('/snackbar.html');
    await expect(button(other, 'Show Info B')).toBeVisible();
    await expect(status(other)).toBeEmpty();
    await click(other, 'Show Info B');
    await expect(status(other)).toHaveText('Notice B');
    await expect(status(page)).toHaveText('Notice A / initial');
  } finally {
    await other.close();
  }
});

test('changing scope or unmounting removes the current owner’s action', async ({ page }) => {
  await click(page, 'Remember A');
  await click(page, 'Show Action A');
  await expect(button(page, 'Retry')).toBeVisible();
  await click(page, 'Change Scope A');
  await expect(button(page, 'Retry')).toHaveCount(0);
  await click(page, 'Show Action A');
  await expect(status(page)).toHaveText('Notice A / next');
  await click(page, 'Dismiss From Old Handle');
  await expect(button(page, 'Retry')).toBeVisible();
  await click(page, 'Unmount A');
  await expect(button(page, 'Retry')).toHaveCount(0);
  await click(page, 'Show From Old Handle');
  await expect(snackbar(page)).toHaveCount(0);
});

test('the snackbar fits narrow screens and clears navigation; the reader pill sits lower', async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await click(page, 'Show Action A');
    const rect = (await snackbar(page).boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(12);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width - 12);
    expect(Math.round(844 - rect.y - rect.height)).toBe(width <= 760 ? 74 : 16);
    const retry = (await button(page, 'Retry').boundingBox())!;
    const dismiss = (await button(page, 'Dismiss').boundingBox())!;
    for (const hit of [retry, dismiss]) {
      expect(hit.width).toBeGreaterThanOrEqual(44);
      expect(hit.height).toBeGreaterThanOrEqual(44);
    }
  }
  await click(page, 'Show Offline Bar');
  let rect = (await snackbar(page).boundingBox())!;
  expect(Math.round(844 - rect.y - rect.height)).toBe(74);
  await click(page, 'Show Reader A');
  await expect(snackbar(page)).toHaveAttribute('data-placement', 'reader');
  rect = (await snackbar(page).boundingBox())!;
  expect(Math.round(844 - rect.y - rect.height)).toBe(16);
});
