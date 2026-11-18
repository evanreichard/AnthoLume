import { randomUUID } from 'node:crypto';
import { test, expect, register } from './fixtures';

test('Library, Insights, Settings and Book Detail share mobile and desktop gutters', async ({ page, server }) => {
  await register(page, server.origin, 'header-reader');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const position = async (title: string) => {
      await nav.getByRole('link', { name: title, exact: true }).click();
      const heading = page.getByRole('heading', { name: title, level: 1, exact: true });
      await expect(heading).toBeVisible();
      const { x, y, height } = (await heading.boundingBox())!;
      return { x, y, height };
    };
    const library = await position('Library');
    const libraryGrid = (await page.getByRole('article').first().locator('..').boundingBox())!;
    const expectLibraryGutters = async (region: import('@playwright/test').Locator) => {
      await expect(region).toBeVisible();
      const { x, width } = (await region.boundingBox())!;
      expect({ x, width }).toEqual({ x: libraryGrid.x, width: libraryGrid.width });
    };
    expect(await position('Insights')).toEqual(library);
    await expectLibraryGutters(page.getByRole('region', { name: 'Last 30 days' }));
    expect(await position('Settings')).toEqual(library);
    await position('Library');
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    const reading = page.getByRole('region', { name: 'Your reading' });
    const info = page.getByRole('region', { name: 'Book information' });
    const cta = page.getByRole('link', { name: 'Read', exact: true });
    await expect(cta).toBeVisible();
    if (width === 320) {
      await expectLibraryGutters(cta);
      await expectLibraryGutters(reading);
      await expectLibraryGutters(info);
    } else {
      await expect(reading).toBeVisible();
      const [sidebar, details, title, resume] = await Promise.all([
        reading.boundingBox(), info.boundingBox(), page.getByRole('heading', { name: 'Public book 01', level: 1 }).boundingBox(),
        cta.boundingBox(),
      ]);
      expect(details!.x).toBe(libraryGrid.x);
      expect(sidebar!.x + sidebar!.width).toBeCloseTo(libraryGrid.x + libraryGrid.width);
      expect(sidebar!.x).toBeGreaterThan(details!.x + details!.width);
      expect(sidebar!.y).toBeLessThanOrEqual(title!.y);
      const author = (await page.getByText('Synthetic Author', { exact: true }).first().boundingBox())!;
      expect(resume!.x).toBe(title!.x);
      expect(resume!.y - (author.y + author.height)).toBeCloseTo(12);
      expect(resume!.width).toBeLessThan(160);
    }
  }
});

test('Insights shows acknowledged activity, links chart days and books, and keeps rankings secondary', async ({ page, server }) => {
  await register(page, server.origin, 'journal-reader');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Insights' }).click();
  const chart = page.getByRole('region', { name: 'Last 30 days' });
  await expect(chart.getByText('0 min read', { exact: true })).toBeVisible();
  const csrf = (await (await page.request.get(`${server.origin}/api/v1/session`)).json()).csrf_token;
  const headers = { Origin: server.origin, 'X-CSRF-Token': csrf };
  const submit = async (path: string, data: object) => {
    const response = await page.request.post(`${server.origin}/api/v1/me/${path}`, { headers, data });
    expect(response.status(), await response.text()).toBe(200);
  };
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  await submit('devices', { id: 'journal-device', name: 'Test reader' });
  await submit('activity', { event_id: randomUUID(), document_id: 'book-001', device_id: 'journal-device', start_time: timestamp, duration: 120, start_fraction: .1, end_fraction: .2 });
  await submit('reading-progress', { event_id: randomUUID(), document_id: 'book-001', device_id: 'journal-device', observed_at: timestamp, base_revision: '0', position: '/body/DocFragment[1]/body/p[2]', fraction: .2 });
  await page.reload();
  await expect(chart.getByText('2 min read', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  const rankings = page.getByRole('region', { name: 'Rankings', exact: true });
  await expect(rankings.getByText('journal-reader (you)')).toBeVisible();
  const heading = (await rankings.getByRole('heading', { name: 'Rankings' }).boundingBox())!;
  const picker = (await rankings.getByLabel('Ranking period').boundingBox())!;
  expect(heading.x + heading.width).toBeLessThan(picker.x);
  expect(picker.width).toBeLessThan(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.getByRole('heading', { name: 'Recent reading' })).toHaveCount(0);
  await rankings.getByRole('button', { name: 'Words', exact: true }).click();
  await rankings.getByLabel('Ranking period').selectOption('all');
  await expect(rankings.getByText('1,000 words', { exact: true })).toBeVisible();
  await rankings.getByRole('link', { name: 'View full rankings' }).click();
  await expect(page).toHaveURL(/\/insights\/rankings\?metric=words&days=all$/);
  await expect(rankings.getByRole('button', { name: 'Words', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rankings.getByLabel('Ranking period')).toHaveValue('all');
  await expect(rankings.getByText('1,000 words', { exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: /: 2 min$/ }).click();
  await expect(page.getByRole('heading', { name: /Activity · / })).toBeVisible();
  await page.getByRole('link', { name: 'Public book 01' }).click();
  await expect(page.getByRole('heading', { name: 'Public book 01' })).toBeVisible();
  await page.getByRole('region', { name: 'Your reading' }).getByRole('link', { name: 'View activity', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Public book 01' })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Insights sections' });
  await sections.getByRole('link', { name: 'Progress' }).click();
  await expect(page.getByText('20%', { exact: true })).toBeVisible();
  await expect(sections.getByRole('link', { name: 'Rankings', exact: true })).toHaveCount(0);
});
