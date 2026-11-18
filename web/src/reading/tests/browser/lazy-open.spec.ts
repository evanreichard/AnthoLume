import { expect, test } from '@playwright/test';
import type { ReaderStatus } from '../../controller';

test('online open skips unrelated chapters and rejects an invalid chapter before showing or saving it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest;
    const zip = await p.JSZip.loadAsync(await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    zip.file('two.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>Unclosed chapter');
    const blob = await zip.generateAsync({ type: 'blob' });
    const policy = await p.validateEPUB(blob, undefined, true);
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.append(host);
    let status: ReaderStatus = { state: 'opening', message: '' }, saves = 0;
    const reader = new p.ReaderController(host, next => { status = next; }, async () => { saves++; });
    const digest = (name: string) => !!policy.manifest.index.entries.find(entry => entry.name === name)?.digest;
    try {
      const before = [digest('one.xhtml'), digest('two.xhtml')];
      await reader.open(policy.reader.source, undefined, undefined, policy.manifest);
      const opened = { state: status.state, firstRead: digest('one.xhtml'), secondRead: digest('two.xhtml') };
      const position = status.location?.ko;
      await reader.toc('two.xhtml');
      return { before, opened, error: status.message, kept: !!position && status.location?.ko === position, saves };
    } finally { await reader.dispose(); policy.dispose(); host.remove(); }
  });
  expect(result).toEqual({ before: [false, false], opened: { state: 'ready', firstRead: true, secondRead: false }, error: expect.stringContaining('Invalid XML'), kept: true, saves: 0 });
});
