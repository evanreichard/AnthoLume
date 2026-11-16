import { test, expect, type Page } from '@playwright/test';

async function open(page: Page, direction: string, route = '/library') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?direction=${direction}&theme=light#${route}`);
}

for (const direction of ['folio', 'index']) {
  test.describe(direction, () => {
    test('author/title search, detail, immersive reader and browser Back preserve results', async ({
      page,
    }) => {
      await open(page, direction);
      const search = page.getByRole('searchbox', { name: 'Search title or author' });
      await search.fill('Mara');
      await expect(
        page.getByRole('heading', { name: 'The Tidal Atlas', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Ordinary Light', exact: true })).toHaveCount(
        0,
      );
      await page.getByRole('link', { name: 'The Tidal Atlas', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'The Tidal Atlas' })).toBeVisible();
      await page.getByRole('link', { name: 'Resume reading' }).click();
      await expect(page.getByText('NOT an EPUB engine', { exact: false })).toBeVisible();
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await page.goBack();
      await expect(page.getByRole('heading', { level: 1, name: 'The Tidal Atlas' })).toBeVisible();
      await page.goBack();
      await expect(search).toHaveValue('Mara');
      await search.fill('Ordinary');
      await expect(
        page.getByRole('heading', { name: 'Ordinary Light', exact: true }),
      ).toBeVisible();
      await search.fill('no such title');
      await expect(page.getByRole('heading', { name: 'No matching titles' })).toBeVisible();
      await page.getByRole('button', { name: 'Clear search', exact: true }).first().click();
      await expect(search).toHaveValue('');
    });

    test('reader TOC, appearance, keyboard navigation and modal focus', async ({ page }) => {
      await open(page, direction, '/read/tidal');
      const contents = page.getByRole('button', { name: 'Contents', exact: true });
      await contents.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: '04 What the water leaves' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(contents).toBeFocused();
      await contents.click();
      await dialog.getByRole('button', { name: '02 A map of small things' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'A map of small things' }),
      ).toBeVisible();
      const appearance = page.getByRole('button', { name: 'Appearance', exact: true });
      await appearance.click();
      await page.getByLabel('Typeface').selectOption('sans');
      await page.getByRole('slider', { name: 'Text size' }).fill('26');
      await page.getByRole('button', { name: 'Ink', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(appearance).toBeFocused();
      await expect(page.locator('.reader')).toHaveClass(/paper-ink/);
      await expect(page.locator('.reader-text')).toHaveCSS('font-size', '26px');
      await page.getByRole('heading', { level: 1 }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('heading', { level: 1, name: 'The path inland' })).toBeVisible();
      await page.getByRole('button', { name: 'Quiet reading', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Show reading controls' })).toBeVisible();
      await page.getByRole('button', { name: 'Show reading controls' }).click();
      await expect(contents).toBeVisible();
    });

    test('download removal retains shared book; local and shared delete are distinct', async ({
      page,
    }) => {
      await open(page, direction, '/offline');
      await page.getByRole('button', { name: 'Remove download', exact: true }).first().click();
      let dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Remove this download?' })).toBeVisible();
      await expect(dialog.getByText(/pending events are kept/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Remove download', exact: true }).click();
      await expect(page.locator('.offline-row').filter({ hasText: 'The Tidal Atlas' })).toHaveCount(
        0,
      );
      await page.getByRole('button', { name: 'Delete local book', exact: true }).click();
      dialog = page.getByRole('dialog');
      await expect(dialog.getByText(/only original/)).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Export synthetic text first' }),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(
        page.getByRole('button', { name: 'Delete local book', exact: true }),
      ).toBeFocused();
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: 'Library' })
        .click();
      await page.getByRole('link', { name: 'The Tidal Atlas', exact: true }).click();
      await expect(
        page
          .getByRole('region', { name: 'Book details' })
          .getByText('Online only · demo', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'More book actions' }).click();
      await page.getByRole('button', { name: 'Delete shared book', exact: true }).click();
      dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Affects everyone in the shared library')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Simulate download' }).click();
      await page.getByRole('button', { name: 'Simulate verified availability' }).click();
      await expect(page.getByText('Available offline · demo', { exact: true })).toBeVisible();
    });

    test('local deletion and shared deletion apply only their own mock scope', async ({ page }) => {
      await open(page, direction, '/offline');
      await page.getByRole('button', { name: 'Delete local book', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete local book', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'No local books' })).toBeVisible();
      await expect(page.locator('.offline-row')).toHaveCount(2);
      await page.getByRole('link', { name: 'The Tidal Atlas', exact: true }).click();
      await page.getByRole('button', { name: 'More book actions' }).click();
      await page.getByRole('button', { name: 'Delete shared book', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete shared book', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'The Tidal Atlas', exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('heading', { name: 'Ordinary Light', exact: true }),
      ).toBeVisible();
    });

    test('auth expiry permits samples; logout hides retained downloads and pauses account events', async ({
      page,
    }) => {
      await open(page, direction, '/sync?state=auth');
      await expect(page.getByRole('heading', { name: 'Sign in to synchronize.' })).toBeVisible();
      await page.getByRole('link', { name: 'Keep reading offline' }).click();
      await expect(page.getByRole('link', { name: 'The Tidal Atlas', exact: true })).toBeVisible();
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: 'More' })
        .click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.getByRole('dialog').getByText(/retained and hidden/)).toBeVisible();
      await page.getByRole('button', { name: 'Sign out · retain downloads' }).click();
      await expect(
        page.getByRole('heading', { name: 'Your account downloads are retained and hidden.' }),
      ).toBeVisible();
      await expect(page.locator('.offline-row')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Field Notes', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '+ Local sample' }).click();
      await page.getByRole('button', { name: 'Add synthetic local sample' }).click();
      await expect(
        page.getByRole('link', { name: 'A Walk Before Rain', exact: true }),
      ).toBeVisible();
      await page.getByRole('link', { name: 'Sign in to demo account', exact: true }).click();
      await page.getByRole('button', { name: 'Sign in as Alex Rowan' }).click();
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: 'Offline' })
        .click();
      await expect(page.getByRole('link', { name: 'The Tidal Atlas', exact: true })).toBeVisible();
      await expect(page.locator('.offline-row')).toHaveCount(4);
    });

    test('conflict requires deliberate lower-position confirmation and supports defer', async ({
      page,
    }) => {
      await open(page, direction, '/sync?state=conflict');
      await page.getByRole('button', { name: 'Use this device · 24% (earlier)' }).click();
      await expect(page.getByRole('dialog').getByText(/back from 41% to 24%/)).toBeVisible();
      await page.getByRole('button', { name: 'Use 24% · earlier position' }).click();
      await expect(page.getByText(/Demo choice: 24%/)).toBeVisible();
      await expect(
        page.getByText(/No position was published; activity credit is unchanged/),
      ).toBeVisible();
      await page.getByLabel('Demo scenario').selectOption('conflict');
      await page.getByRole('button', { name: 'Decide later · keep both' }).click();
      await expect(page).toHaveURL(/#\/more/);
      await page.getByRole('link', { name: 'Synchronization', exact: false }).click();
      await expect(
        page.getByRole('button', { name: 'Use this device · 24% (earlier)' }),
      ).toBeVisible();
    });

    test('quota, retry and unavailable states never claim actual success', async ({ page }) => {
      await open(page, direction, '/sync?state=quota');
      await expect(
        page.getByRole('heading', { name: 'Download stopped. Not available.' }),
      ).toBeVisible();
      await page.getByLabel('Demo scenario').selectOption('retry');
      await expect(page.getByRole('heading', { name: 'No server receipt yet.' })).toBeVisible();
      await page.getByRole('button', { name: 'Simulate retry → pending' }).click();
      await expect(page.getByRole('heading', { name: 'Reading can continue.' })).toBeVisible();
      await page.getByLabel('Demo scenario').selectOption('unavailable');
      await expect(
        page.getByRole('heading', { name: 'Restore the downloaded copy.' }),
      ).toBeVisible();
    });

    test('admin typed confirmation is gated; Escape returns focus; insights remain representative', async ({
      page,
    }) => {
      await open(page, direction, '/more');
      const review = page.getByRole('button', { name: 'Review removal' });
      await review.click();
      await expect(page.getByRole('button', { name: 'Remove member · demo' })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(review).toBeFocused();
      await review.click();
      await page.getByRole('textbox', { name: 'Type Sam Reed to confirm' }).fill('Sam Reed');
      await page.getByRole('button', { name: 'Remove member · demo' }).click();
      await expect(page.getByRole('button', { name: 'Removed in demo' })).toBeDisabled();
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: 'Insights' })
        .click();
      await expect(page.getByRole('img', { name: /Illustrative minutes by day/ })).toBeVisible();
      await page.getByRole('button', { name: 'Device progress' }).click();
      await expect(page.getByRole('table')).toContainText('KOReader');
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await expect(page.getByRole('table')).toContainText('18 min');
    });

    test('desktop rail and split detail preserve search and focus the selected book', async ({
      page,
    }) => {
      await open(page, direction);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole('searchbox', { name: 'Search title or author' }).fill('Theo');
      await page.getByRole('link', { name: 'Ordinary Light', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Book library' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Book details' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Ordinary Light', level: 1 })).toBeFocused();
      await expect(
        page
          .getByRole('navigation', { name: 'Main navigation' })
          .getByRole('link', { name: 'Library' }),
      ).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Back to results' }).click();
      await expect(page.getByRole('searchbox', { name: 'Search title or author' })).toHaveValue(
        'Theo',
      );
    });

    test('explicit logout also guards shared reader and detail deep links, not local reading', async ({
      page,
    }) => {
      await open(page, direction, '/more');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out · retain downloads' }).click();
      for (const route of ['/read/tidal', '/books/tidal']) {
        await page.evaluate((value) => {
          location.hash = value;
        }, route);
        await expect(
          page.getByRole('heading', { level: 1, name: 'Account book hidden' }),
        ).toBeVisible();
        await expect(page.getByRole('link', { name: 'Resume reading' })).toHaveCount(0);
      }
      await page.evaluate(() => {
        location.hash = '/read/field';
      });
      await expect(page.locator('.reader-book-label')).toContainText('Field Notes');
      await expect(
        page.getByRole('heading', { level: 1, name: 'The harbour at first light' }),
      ).toBeVisible();
    });

    test('browser Back restores library scroll and direction changes remain linkable', async ({
      page,
    }) => {
      await open(page, direction);
      await page.setViewportSize({ width: 390, height: 568 });
      const title = page.getByRole('link', { name: 'A Garden in Winter', exact: true });
      await title.scrollIntoViewIfNeeded();
      const scroll = await page.evaluate(() => window.scrollY);
      expect(scroll).toBeGreaterThan(100);
      await title.click();
      await page.goBack();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
      await page
        .getByRole('combobox', { name: 'Direction' })
        .selectOption(direction === 'folio' ? 'index' : 'folio');
      await expect(page).toHaveURL(
        new RegExp(`direction=${direction === 'folio' ? 'index' : 'folio'}`),
      );
      await page.getByRole('button', { name: 'Switch to dark mode' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });
  });
}
