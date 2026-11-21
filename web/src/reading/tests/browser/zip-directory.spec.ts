import { expect, test } from '@playwright/test';
import type { ZipIndex } from '../../source';

test('online startup leaves an unused ZIP header unchecked but verifies it before reading the chapter', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest;
    const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    const index = await p.sourceTask<ZipIndex>(p.blobSource(new Blob([bytes])), 'index');
    const later = index.entries.find(entry => entry.name === 'two.xhtml')!;
    new DataView(bytes).setUint32(later.offset, 0, true);
    const blob = new Blob([bytes]);
    const full = await p.validateEPUB(blob).then(() => '', error => String(error));
    const online = await p.validateEPUB(blob, undefined, true);
    try {
      const firstChapter = await online.reader.bytes('one.xhtml');
      const laterFailure = await online.reader.bytes(later.name).then(() => '', error => String(error));
      return { full, firstChapter: firstChapter.length > 0, laterFailure };
    } finally { online.dispose(); }
  });
  expect(result).toEqual({ full: expect.stringContaining('local header'), firstChapter: true, laterFailure: expect.stringContaining('local header') });
});
