import { test, expect, type Page } from '@playwright/test';

async function open(page: Page, direction: string, route: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?direction=${direction}&theme=light#${route}`);
}

for (const direction of ['folio', 'index']) {
  test.describe(`${direction} review regressions`, () => {
    test('D2 paginated anchor and reader session survive Sync and both Back controls', async ({
      page,
    }) => {
      await open(page, direction, '/read/tidal');
      await page.getByRole('button', { name: 'Contents', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '02 A map of small things' })
        .click();
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      await page.getByLabel('Typeface').selectOption('sans');
      await page.getByRole('slider', { name: 'Text size' }).fill('26');
      await page.getByRole('button', { name: 'Ink', exact: true }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      const anchor = await page.locator('.page-text').first().getAttribute('data-anchor');
      await page.getByRole('button', { name: 'Quiet reading', exact: true }).click();
      for (const browserBack of [false, true]) {
        const sync = page.getByRole('link', { name: 'Demo · 2 pending events →' });
        await sync.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Synchronization' }),
        ).toBeVisible();
        if (browserBack) await page.goBack();
        else await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'A map of small things' }),
        ).toHaveCount(1);
        await expect(page.locator('.paginated-reader')).toHaveClass(/paper-ink quiet-reader/);
        await expect(page.locator('.page-text').first()).toHaveCSS('font-size', '26px');
        await expect(page.locator('.page-text').first()).toHaveCSS(
          'font-family',
          'system-ui, sans-serif',
        );
        await expect(page.locator('.page-text').first()).toHaveAttribute('data-anchor', anchor!);
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      }
      await page.getByRole('link', { name: 'Demo · 2 pending events →' }).click();
      await page.evaluate(() => {
        location.hash = '/read/tidal';
      });
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      const laterAnchor = await page.locator('.page-text').first().getAttribute('data-anchor');
      await page.goBack();
      await page.goBack();
      await expect(page.locator('.page-text').first()).toHaveAttribute('data-anchor', laterAnchor!);
      await expect(
        page.getByRole('heading', { level: 1, name: 'A map of small things' }),
      ).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    });

    test('D2 per-book chrome is retained without leaking appearance to another book', async ({
      page,
    }) => {
      await open(page, direction, '/read/tidal');
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      await page.getByRole('slider', { name: 'Text size' }).fill('26');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Quiet reading', exact: true }).click();
      await page.getByRole('link', { name: 'Demo · 2 pending events →' }).click();
      await page.goBack();
      await expect(page.getByRole('button', { name: 'Show reading controls' })).toBeVisible();
      await page.evaluate(() => {
        location.hash = '/read/field';
      });
      await expect(page.getByRole('button', { name: 'Quiet reading', exact: true })).toBeVisible();
      await expect(page.locator('.page-text').first()).toHaveCSS('font-size', '20px');
      await page.goBack();
      await expect(page.getByRole('button', { name: 'Show reading controls' })).toBeVisible();
      await expect(page.locator('.page-text').first()).toHaveCSS('font-size', '26px');
    });

    test('D3 page turns focus the page and TOC selection focuses its heading through the final page', async ({
      page,
    }) => {
      await open(page, direction, '/read/tidal');
      const text = page.locator('.page-text').first();
      const next = page.getByRole('button', { name: 'Next', exact: true });
      await next.click();
      await expect(text).toBeFocused();
      await expect(text).toBeInViewport();
      await page.getByRole('button', { name: 'Previous', exact: true }).click();
      await expect(text).toBeFocused();
      await expect(text).toHaveAttribute('data-anchor', '0');
      await page.keyboard.press('ArrowRight');
      await expect(text).not.toHaveAttribute('data-anchor', '0');
      const contents = page.getByRole('button', { name: 'Contents', exact: true });
      await contents.click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '04 What the water leaves' })
        .click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'What the water leaves' }),
      ).toBeFocused();
      let turns = 0;
      while ((await next.isEnabled()) && turns++ < 40) {
        await next.click();
        await expect(text).toBeFocused();
      }
      await expect(next).toBeDisabled();
      await page.getByRole('button', { name: 'Previous', exact: true }).click();
      await expect(text).toBeFocused();
      await contents.click();
      await page.keyboard.press('Escape');
      await expect(contents).toBeFocused();
    });

    test('D4 successful removals focus next item or emptied section, cancellation keeps opener', async ({
      page,
    }) => {
      await open(page, direction, '/offline');
      await page.getByRole('button', { name: 'Remove download', exact: true }).first().click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Remove download', exact: true })
        .click();
      await expect(
        page
          .locator('.offline-row')
          .filter({ hasText: 'Ordinary Light' })
          .getByRole('link', { name: 'Read sample' }),
      ).toBeFocused();
      await page.getByRole('button', { name: 'Remove download', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Remove download', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Account downloads', exact: true }),
      ).toBeFocused();
      const localDelete = page.getByRole('button', { name: 'Delete local book', exact: true });
      await localDelete.click();
      await page.keyboard.press('Escape');
      await expect(localDelete).toBeFocused();
      await localDelete.click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete local book', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Local originals', exact: true }),
      ).toBeFocused();
    });

    test('D4 detail removal success focuses book heading or destination library heading', async ({
      page,
    }) => {
      await open(page, direction, '/books/tidal');
      await page.getByRole('button', { name: 'Remove download', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Remove download', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'The Tidal Atlas', level: 1 })).toBeFocused();
      await page.getByRole('button', { name: 'More book actions' }).click();
      await page.getByRole('button', { name: 'Delete shared book', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete shared book', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'The library', level: 1 })).toBeFocused();
    });

    test('D5 logout Sync deep links reveal no metadata; expiry keeps reading context accessible', async ({
      page,
    }) => {
      await open(page, direction, '/sync?state=auth');
      await page.getByRole('link', { name: 'Keep reading offline' }).click();
      await page.getByRole('link', { name: 'The Tidal Atlas', exact: true }).click();
      await page.getByRole('link', { name: 'Resume', exact: true }).click();
      await expect(page.locator('.page-book-label')).toContainText('The Tidal Atlas');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: 'More' })
        .click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out · retain downloads' }).click();
      for (const scenario of ['conflict', 'pending', 'auth', 'quota', 'retry', 'unavailable']) {
        await page.evaluate((value) => {
          location.hash = `/sync?state=${value}`;
        }, scenario);
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { name: 'Account events paused' })).toBeVisible();
        await expect(main).not.toContainText(
          /Alex Rowan|The Tidal Atlas|24%|41%|Chapter [12]|KOReader|Browser ·/,
        );
        await expect(main.getByRole('combobox')).toHaveCount(0);
      }
    });

    test('D6 admin mock outcome survives route changes until reload', async ({ page }) => {
      await open(page, direction, '/more');
      await page.getByRole('button', { name: 'Review removal' }).click();
      await page.getByRole('textbox', { name: 'Type Sam Reed to confirm' }).fill('Sam Reed');
      await page.getByRole('button', { name: 'Remove member · demo' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'More' })).toBeFocused();
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: 'Insights' })
        .click();
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: 'More' })
        .click();
      await expect(page.getByRole('button', { name: 'Removed in demo' })).toBeDisabled();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Review removal' })).toBeEnabled();
    });

    test('primary reading action precedes description and fits initial mobile detail viewport', async ({
      page,
    }) => {
      for (const width of [320, 390]) {
        await open(page, direction, '/books/tidal');
        await page.setViewportSize({ width, height: 844 });
        const action = page.getByRole('link', { name: 'Resume', exact: true });
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        const tabs = await page
          .getByRole('navigation', { name: 'Mobile navigation' })
          .boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(tabs!.y);
        const description = await page.locator('.description').boundingBox();
        expect(box!.y).toBeLessThan(description!.y);
      }
    });
  });
}
