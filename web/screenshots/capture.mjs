import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { seedLibrary } from './seed.mjs';

const [origin, temp] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !temp) throw new Error('Run make screenshots from the repository root.');
const now = new Date('2025-03-14T20:00:00Z');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' });
  await page.clock.setFixedTime(now);
  const { docs, addReadingHistory } = await seedLibrary(page.request, origin, { username: 'robin', password: randomUUID() });
  const names = [];
  async function capture(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(temp, name + '.png'), animations: 'disabled' });
    names.push(name);
  }
  async function library() {
    await page.goto(origin + '/library?sort=title');
    await expect(page.locator('article img')).toHaveCount(docs.length);
    await page.locator('article img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  }
  await library();
  await capture('library');

  await addReadingHistory(now);
  await library();
  const recent = page.getByRole('region', { name: 'Continue reading', exact: true });
  await expect(recent).toContainText(docs[0].title);
  await recent.locator('img').evaluate(image => image.decode());
  await capture('home');

  await page.goto(origin + '/insights/activity');
  await expect(page.getByRole('region', { name: 'Reading activity' })).toContainText('18 min read');
  await capture('statistics');

  await page.goto(origin + '/library');
  await recent.getByRole('link', { name: 'Resume' }).click();
  const reader = page.getByRole('region', { name: 'Book reader' });
  await expect(reader).toHaveAttribute('data-reader-state', 'ready', { timeout: 15_000 });
  const chapter = reader.frameLocator('iframe').getByRole('heading', { name: /Advice from a Caterpillar/i });
  await expect(chapter).toBeInViewport();
  await chapter.evaluate(el => el.ownerDocument.fonts.ready);
  await page.keyboard.press('c');
  await expect(reader.getByRole('button', { name: 'Contents', exact: true })).toBeVisible();
  await capture('reader');

  await mkdir('screenshots/mobile', { recursive: true });
  for (const name of names) await copyFile(join(temp, name + '.png'), `screenshots/mobile/${name}.png`);
} finally { await browser.close(); }
