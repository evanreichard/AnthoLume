import { randomUUID } from 'node:crypto';
import { test, expect, register } from './fixtures';

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test('Library rotates through the three newest books with dots, pause and native swipe', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'carousel-reader');
  const endpoint = `${server.origin}/api/v1`;
  const { csrf_token } = await (await page.request.get(`${endpoint}/session`)).json();
  const headers = { Origin: server.origin, 'X-CSRF-Token': csrf_token };
  expect((await page.request.post(`${endpoint}/me/devices`, { headers, data: { id: 'carousel-device', name: 'Reader' } })).status()).toBe(200);
  for (let book = 1; book <= 4; book++) {
    if (book > 1) await new Promise(resolve => setTimeout(resolve, 1050));
    const data = { event_id: randomUUID(), document_id: `book-00${book}`, device_id: 'carousel-device', base_revision: '0', observed_at: new Date(Date.now() - (5 - book) * 60_000).toISOString(), position: '/body/DocFragment[1]/body/p[2]', fraction: book / 10 };
    expect((await page.request.post(`${endpoint}/me/reading-progress`, { headers, data })).status()).toBe(200);
  }
  await page.clock.install();
  await page.reload();
  const carousel = page.getByRole('region', { name: 'Continue reading carousel' });
  const dotGroup = carousel.getByRole('group', { name: 'Choose recent book' });
  const dots = dotGroup.getByRole('button');
  const activeHero = carousel.getByRole('region', { name: 'Continue reading', exact: true });
  const story = () => activeHero.getByRole('heading');
  const settled = () => expect.poll(() => activeHero.evaluate(hero => {
    const track = hero.parentElement!.parentElement!;
    const distance = Math.abs(track.scrollLeft) / track.clientWidth;
    return Math.abs(distance - Math.round(distance));
  })).toBeLessThan(.005);
  await expect(dots).toHaveCount(3);
  await expect(dotGroup).toHaveCSS('opacity', '0');
  await expect(dots.first()).toHaveCSS('pointer-events', 'none');
  await expect(story()).toHaveText('Public book 04');
  await page.clock.fastForward(5000);
  await expect(story()).toHaveText('Public book 03');
  await carousel.getByRole('button', { name: 'Pause recent books' }).tap();
  await page.clock.fastForward(10_000);
  await expect(story()).toHaveText('Public book 03');

  const { x, y, width } = (await story().boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  async function swipe(from: number, to: number) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y: y + 8 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + (to - from) * i / 8, y: y + 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  try {
    await swipe(x + width + 65, x + 12);
    await expect(story()).toHaveText('Public book 02');
    await settled();
    await expect(dotGroup).toHaveCSS('opacity', '1');
    await swipe(x + 12, x + width + 65);
    await expect(story()).toHaveText('Public book 03');
    await settled();
  } finally { await cdp.detach(); }
  await dots.first().tap();
  await expect(story()).toHaveText('Public book 04');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(carousel.getByRole('button', { name: 'Play recent books' })).toHaveCount(0);
  await page.clock.fastForward(10_000);
  await expect(story()).toHaveText('Public book 04');
  await expect(dotGroup).toHaveCSS('opacity', '0');
  await page.keyboard.press('Tab');
  await expect(dots.nth(1)).toBeFocused();
  await expect(dotGroup).toHaveCSS('opacity', '1');
  await page.getByRole('searchbox').focus();
  await expect(dotGroup).toHaveCSS('opacity', '0');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('recent-books-mobile.png') });
  const typography = (heading: ReturnType<typeof story>) => heading.evaluate(el => {
    const { fontSize, fontStyle, lineHeight } = getComputedStyle(el);
    return { fontSize, fontStyle, lineHeight };
  });
  const libraryTitle = await typography(story());
  expect(libraryTitle.fontStyle).toBe('italic');
  const carouselBox = (await carousel.boundingBox())!;
  const heroBox = (await activeHero.boundingBox())!;
  expect(carouselBox.height - heroBox.height).toBe(2);
  const coverWidth = (hero: typeof activeHero) => hero.locator('img').evaluate(image => image.clientWidth);
  const expectWatermark = async (hero: typeof activeHero) => {
    const mark = hero.getByText('40%', { exact: true });
    await expect(mark).toHaveCSS('text-align', 'center');
    await expect(mark).toHaveCSS('bottom', '12px');
    const [frame, text] = await Promise.all([hero.boundingBox(), mark.boundingBox()]);
    expect(text!.x + text!.width / 2).toBeCloseTo(frame!.x + frame!.width / 2);
  };
  await expectWatermark(activeHero);
  const libraryCoverWidth = await coverWidth(activeHero);
  const spacing = (hero: typeof activeHero) => hero.evaluate(el => {
    const { padding, gap } = getComputedStyle(el);
    return { padding, gap };
  });
  const librarySpacing = await spacing(activeHero);
  const labelBox = (await activeHero.getByText('Continue reading', { exact: true }).boundingBox())!;
  const titleBox = (await story().boundingBox())!;
  const authorBox = (await activeHero.getByText('Synthetic Author', { exact: true }).boundingBox())!;
  const resumeBox = (await activeHero.getByRole('link', { name: 'Resume', exact: true }).boundingBox())!;
  const [top, , bottom] = librarySpacing.padding.split(' ').map(parseFloat);
  expect(labelBox.y - heroBox.y).toBeCloseTo(top!);
  expect(heroBox.y + heroBox.height - resumeBox.y - resumeBox.height).toBeCloseTo(bottom ?? top!);
  expect(labelBox.x).toBe(titleBox.x);
  expect(resumeBox.x).toBe(titleBox.x);
  expect(titleBox.y - labelBox.y - labelBox.height).toBeCloseTo(resumeBox.y - authorBox.y - authorBox.height);
  await story().click();
  const detailTitle = page.getByRole('heading', { level: 1, name: 'Public book 04' });
  await expect(detailTitle).toBeVisible();
  expect(await typography(detailTitle)).toEqual(libraryTitle);
  const detailHero = page.getByRole('region', { name: 'Public book 04', exact: true });
  await expectWatermark(detailHero);
  expect(await coverWidth(detailHero)).toBe(libraryCoverWidth);
  expect(await spacing(detailHero)).toEqual(librarySpacing);
  await expect(page.getByRole('link', { name: 'Resume', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('book-hero-mobile.png') });
});
