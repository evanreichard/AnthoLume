import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { books } from './books.mjs';

const [origin, temp] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !temp) throw new Error('Run make screenshots from the repository root.');
const now = new Date('2025-03-14T20:00:00Z');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' });
  await page.clock.setFixedTime(now);
  const api = origin + '/api/v1';
  const headers = { Origin: origin };
  async function request(method, path, data, type = 'application/json') {
    const response = await page.request.fetch(api + path, { method, headers: { ...headers, 'Content-Type': type }, data });
    if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  }
  headers['X-CSRF-Token'] = (await request('GET', '/session')).csrf_token;
  const session = await request('POST', '/session/register', { username: 'robin', password: randomUUID() });
  headers['X-CSRF-Token'] = session.csrf_token;
  headers['X-AnthoLume-Account'] = session.user.account_id;
  headers['X-AnthoLume-Reading-Generation'] = session.user.reading_generation;

  const docs = [];
  for await (const { title, author, bytes, cover } of books()) {
    const doc = await request('POST', '/documents', bytes, 'application/epub+zip');
    await request('PATCH', '/documents/' + doc.id, { title, author, description: doc.description || '', isbn10: '', isbn13: '', cover_base64: cover });
    docs.push({ id: doc.id, title });
  }
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

  const device = 'paperwhite';
  await request('POST', '/me/devices', { id: device, name: 'Paperwhite' });
  for (let day = 8; day >= 0; day--) {
    const start = new Date(+now - day * 86_400_000 - 3_600_000).toISOString();
    const fraction = (9 - day) * .04;
    await request('POST', '/me/activity', { event_id: randomUUID(), device_id: device, document_id: docs[day % 3].id,
      start_time: start, duration: (18 + day * 3) * 60, start_fraction: fraction - .035, end_fraction: fraction });
  }
  // Reader Anchor - This is the chapter heading in the pinned Alice edition, not a fabricated locator.
  await request('POST', '/me/reading-progress', { event_id: randomUUID(), document_id: docs[0].id, device_id: device,
    observed_at: now.toISOString(), base_revision: '0', position: '/body/DocFragment[7]/body/div/h2', fraction: .36 });
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
