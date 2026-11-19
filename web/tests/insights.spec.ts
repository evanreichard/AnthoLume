import { randomUUID } from 'node:crypto';
import { test, expect, register } from './fixtures';

test('Library, Insights, Settings and Book Detail share mobile and desktop gutters', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'header-reader');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const position = async (title: string) => {
      await nav.getByRole('link', { name: title, exact: true }).click();
      const heading = page.getByRole('heading', { name: title, level: 1, exact: true });
      await expect(heading).toBeVisible();
      const { x, y, height } = (await heading.boundingBox())!;
      return { x, y, height };
    };
    const library = await position('Library');
    const header = (name: string) => page.locator('main header').filter({ has: page.getByRole(name === 'Book' ? 'link' : 'heading', { name: name === 'Book' ? 'Library' : name, exact: true }) });
    const libraryHeader = await header('Library').boundingBox();
    const libraryGrid = (await page.getByRole('article').first().locator('..').boundingBox())!;
    const expectLibraryGutters = async (region: import('@playwright/test').Locator) => {
      await expect(region).toBeVisible();
      const { x, width } = (await region.boundingBox())!;
      expect({ x, width }).toEqual({ x: libraryGrid.x, width: libraryGrid.width });
    };
    expect(await position('Insights')).toEqual(library);
    const chart = page.getByRole('region', { name: 'Last 30 days' });
    await expectLibraryGutters(chart);
    const cardStyle = (card: import('@playwright/test').Locator) => card.evaluate(node => {
      const { backgroundColor, borderColor, borderRadius, borderWidth, padding } = getComputedStyle(node);
      return { backgroundColor, borderColor, borderRadius, borderWidth, padding };
    });
    const insightsCard = await cardStyle(chart);
    expect(await position('Settings')).toEqual(library);
    for (const name of ['Account', 'Devices']) {
      const card = page.getByRole('region', { name, exact: true });
      await expect(card.getByRole('heading', { name, exact: true })).toBeVisible();
      expect(await cardStyle(card)).toEqual(insightsCard);
    }
    await position('Library');
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    const reading = page.getByRole('region', { name: 'Your reading' });
    const info = page.getByRole('region', { name: 'Book details' });
    await expect(info.getByRole('heading', { name: 'Book information', exact: true })).toHaveCount(0);
    const hero = page.getByRole('region', { name: 'Public book 01', exact: true });
    const cta = hero.getByRole('link', { name: 'Read', exact: true });
    await expect(cta).toBeVisible();
    expect(await header('Book').boundingBox()).toEqual(libraryHeader);
    const title = (await hero.getByRole('heading', { level: 1 }).boundingBox())!;
    const resume = (await cta.boundingBox())!;
    expect(resume.x).toBe(title.x);
    expect(resume.y).toBeGreaterThan(title.y + title.height);
    expect(resume.width).toBeLessThan(160);
    expect(resume.height).toBeGreaterThanOrEqual(44);
    const synopsis = info.getByRole('heading', { name: 'Synopsis', exact: true, level: 2 });
    const author = info.getByText('Author', { exact: true });
    expect((await author.boundingBox())!.y).toBeLessThan((await synopsis.boundingBox())!.y);
    if (width < 1040) {
      await expectLibraryGutters(hero);
      await expectLibraryGutters(reading);
      await expectLibraryGutters(info);
    } else {
      await expect(reading).toBeVisible();
      const [sidebar, details, feature] = await Promise.all([reading.boundingBox(), info.boundingBox(), hero.boundingBox()]);
      expect(details!.x).toBe(libraryGrid.x);
      expect(sidebar!.x + sidebar!.width).toBeCloseTo(libraryGrid.x + libraryGrid.width);
      expect(sidebar!.x - (feature!.x + feature!.width)).toBeCloseTo(24);
      expect(sidebar!.y).toBeCloseTo(feature!.y);
    }
    if (width !== 320) await page.screenshot({ path: testInfo.outputPath(`book-detail-${width}.png`) });
  }
});

test('Insights reserves the overview layout while loading and respects reduced motion', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'skeleton-reader');
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/v1/me/insights', async route => { await waiting; await route.continue(); });
  try {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Insights' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Loading your reading journal' })).toHaveCount(1);
    const bars = page.locator('[class*="skeletonBar"]');
    await expect(bars).toHaveCount(30);
    const animation = () => bars.first().evaluate(el => getComputedStyle(el, '::after').animationName);
    expect(await animation()).not.toBe('none');
    const rankings = page.getByRole('region', { name: 'Rankings' });
    const top = (await rankings.boundingBox())!.y;
    await page.screenshot({ path: testInfo.outputPath('overview-skeleton-320.png') });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await animation()).toBe('none');
    await page.screenshot({ path: testInfo.outputPath('overview-skeleton-1440.png') });
    await page.setViewportSize({ width: 320, height: 844 });
    finish();
    await expect(page.getByRole('region', { name: 'Last 30 days' })).toBeVisible();
    await expect(bars).toHaveCount(0);
    expect(Math.abs((await rankings.boundingBox())!.y - top)).toBeLessThan(3);
  } finally { finish(); }
});

test('Insights shows acknowledged activity, links chart days and books, and keeps rankings secondary', async ({ page, server }, testInfo) => {
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
  const period = rankings.getByLabel('Ranking period');
  await expect(period.getByRole('option')).toHaveText(['Last 7 days', 'Last 30 days', 'Last 365 days', 'All time']);
  await expect(period).toHaveValue('month');
  const metric = rankings.getByRole('button', { name: 'Time', exact: true });
  const insets = await metric.evaluate(button => {
    const group = button.parentElement!;
    const shell = group.getBoundingClientRect();
    const face = button.firstElementChild!.getBoundingClientRect();
    const track = getComputedStyle(group, '::before');
    return {
      left: face.left - shell.left - parseFloat(track.left),
      top: face.top - shell.top - parseFloat(track.top),
      bottom: shell.bottom - face.bottom - parseFloat(track.bottom),
      target: button.getBoundingClientRect().height,
    };
  });
  expect(insets.left).toBeGreaterThan(0);
  expect(insets.top).toBeCloseTo(insets.left);
  expect(insets.bottom).toBeCloseTo(insets.left);
  expect(insets.target).toBeGreaterThanOrEqual(44);
  const heading = (await rankings.getByRole('heading', { name: 'Rankings' }).boundingBox())!;
  const picker = (await rankings.getByLabel('Ranking period').boundingBox())!;
  expect(heading.x + heading.width).toBeLessThan(picker.x);
  expect(picker.width).toBeLessThan(150);
  const dropdown = await period.evaluate(select => {
    const face = getComputedStyle(select.parentElement!, '::before');
    const { fontSize, fontWeight, minHeight, paddingInlineStart } = getComputedStyle(select);
    return { fontSize, fontWeight, minHeight, paddingInlineStart, face: face.height, borderRadius: face.borderRadius };
  });
  const accountPage = await page.context().newPage();
  await accountPage.goto(`${server.origin}/settings`);
  const signOut = accountPage.getByRole('button', { name: 'Sign out', exact: true });
  await expect(signOut).toBeVisible();
  expect(dropdown).toEqual(await signOut.evaluate(button => {
    const face = getComputedStyle(button.firstElementChild!);
    const { fontSize, fontWeight, minHeight } = getComputedStyle(button);
    return { fontSize, fontWeight, minHeight, paddingInlineStart: face.paddingInlineStart, face: face.height, borderRadius: face.borderRadius };
  }));
  await accountPage.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.getByRole('heading', { name: 'Recent reading' })).toHaveCount(0);
  await rankings.getByRole('button', { name: 'Words', exact: true }).click();
  await rankings.getByLabel('Ranking period').selectOption('all');
  await expect(rankings.getByText('1,000 words', { exact: true })).toBeVisible();
  await rankings.getByRole('link', { name: 'View full rankings' }).click();
  await expect(page).toHaveURL(/\/insights\/rankings\?metric=words&period=all$/);
  await expect(rankings.getByRole('button', { name: 'Words', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rankings.getByLabel('Ranking period')).toHaveValue('all');
  await expect(rankings.getByText('1,000 words', { exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: /: 2 min$/ }).click();
  const activity = page.getByRole('region', { name: 'Reading activity' });
  await expect(activity.getByRole('link', { name: 'Clear filters' })).toBeVisible();
  await expect(activity.locator('time').first()).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
  await expect(activity.getByRole('heading')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.getByRole('link', { name: 'Public book 01' }).click();
  const bookHero = page.getByRole('region', { name: 'Public book 01', exact: true });
  await expect(bookHero.getByRole('heading', { name: 'Public book 01' })).toBeVisible();
  await expect(bookHero.getByText('20%', { exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Your reading' }).getByRole('link', { name: 'View activity', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Public book 01' })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Insights sections' });
  await sections.getByRole('link', { name: 'Progress' }).click();
  const progress = page.getByRole('region', { name: 'Saved progress' });
  await expect(progress.getByText('20%', { exact: true })).toBeVisible();
  await expect(progress.getByRole('heading')).toHaveCount(0);
  for (const [width, colorScheme] of [[320, 'dark'], [390, 'light'], [1440, 'light']] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height: 844 });
    for (const [tab, name] of [['Activity', 'Reading activity'], ['Progress', 'Saved progress']] as const) {
      await sections.getByRole('link', { name: tab, exact: true }).click();
      await expect(page.getByRole('region', { name }).getByRole('link', { name: 'Public book 01' })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: testInfo.outputPath(`${tab.toLowerCase()}-${width}.png`), animations: 'disabled' });
    }
  }
  await expect(sections.getByRole('link', { name: 'Rankings', exact: true })).toHaveCount(0);
});

test('Insights history pager keeps filters and keyboard focus', async ({ page, server }) => {
  await register(page, server.origin, 'history-pager');
  const endpoint = `${server.origin}/api/v1`;
  const { csrf_token } = await (await page.request.get(`${endpoint}/session`)).json();
  const headers = { Origin: server.origin, 'X-CSRF-Token': csrf_token };
  expect((await page.request.post(`${endpoint}/me/devices`, { headers, data: { id: 'history-device', name: 'Reader' } })).status()).toBe(200);
  for (let i = 0; i < 21; i++) {
    const data = { event_id: randomUUID(), document_id: 'book-001', device_id: 'history-device', start_time: new Date(Date.now() - (i + 1) * 60_000).toISOString(), duration: 30, start_fraction: 0, end_fraction: .1 };
    expect((await page.request.post(`${endpoint}/me/activity`, { headers, data })).status()).toBe(200);
  }
  const url = `${server.origin}/insights/activity?document=book-001`;
  await page.goto(url);
  const activity = page.getByRole('region', { name: 'Reading activity' });
  const pager = activity.getByRole('navigation', { name: 'History pages' });
  const next = pager.getByRole('button', { name: 'Next' });
  await expect(activity.getByRole('listitem')).toHaveCount(20);
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${url}&page=2`);
  await expect(activity.getByRole('listitem')).toHaveCount(1);
  await expect(pager.getByRole('status')).toHaveText('Page 2');
  await expect(next).toBeDisabled();
  await expect(next).toBeFocused();
  await pager.getByRole('button', { name: 'Previous' }).click();
  await expect(page).toHaveURL(url);
  await expect(activity.getByRole('listitem')).toHaveCount(20);
});
