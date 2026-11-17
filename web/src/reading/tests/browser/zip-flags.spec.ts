import { expect, test } from '@playwright/test';

test('all legal DEFLATE flag combinations validate and open a complete unchanged-payload EPUB in the real engine', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, original = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(), baseline = await p.validateEPUB(original);
    const results = [];
    for (const descriptor of [false, true]) {
      const zip = await p.JSZip.loadAsync(original), compressed = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', streamFiles: descriptor });
      for (const utf8 of [false, true]) for (const options of [0, 2, 4, 6]) {
        const bytes = p.zipFlags(compressed, options, utf8), before = await p.checksum(bytes), policy = await p.validateEPUB(bytes);
        let sameEntries = true;
        for (const entry of baseline.manifest.index.entries.filter(e => !e.name.endsWith('/'))) { const value = await baseline.reader.bytes(entry.name), actual = await policy.reader.bytes(entry.name); if (actual.length !== value.length || !value.every((byte, n) => actual[n] === byte)) sameEntries = false; }
        const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host); let state = '', publishes = 0;
        const reader = new p.ReaderController(host, next => { state = next.state; }, async () => { publishes++; }, { localOnly: true });
        await reader.open(bytes); const initial = state; await reader.next();
        results.push({ descriptor, utf8, options, sameEntries, initial, state, publishes, bytesUnchanged: before === await p.checksum(bytes) });
        await reader.dispose(); policy.dispose(); host.remove();
      }
    }
    baseline.dispose(); return results;
  });
  expect(result).toHaveLength(16);
  for (const row of result) expect(row).toMatchObject({ sameEntries: true, initial: 'ready', state: 'ready', publishes: 1, bytesUnchanged: true });
});
test('actual worker rejects STORE option flags, encrypted/reserved bits and legal flags with local/central disagreement', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, zip = new p.JSZip(); zip.file('one.xml', 'Small bounded public file');
    const errors: string[] = []; let stored = 0;
    for (const descriptor of [false, true]) for (const utf8 of [false, true]) {
      const source = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE', streamFiles: descriptor });
      const reader = await p.checkArchive(p.zipFlags(source, 0, utf8, 0));
      if (new TextDecoder().decode(await reader.bytes('one.xml')) === 'Small bounded public file') stored++;
    }
    for (const method of ['STORE', 'DEFLATE'] as const) {
      const source = await zip.generateAsync({ type: 'arraybuffer', compression: method }), target = method === 'STORE' ? 0 : 8;
      const variants = [p.zipFlags(source, 0, true, target, true), ...[0, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15].map(bit => p.zipFlags(source, 1 << bit, false, target))];
      if (method === 'STORE') variants.push(...[2, 4, 6].map(options => p.zipFlags(source, options, false, 0)));
      for (const bytes of variants) { try { await p.checkArchive(bytes); errors.push('UNEXPECTED ACCEPTANCE'); } catch (error) { errors.push(String(error)); } }
    }
    return { errors, stored };
  });
  expect(result.stored).toBe(4); expect(result.errors).toHaveLength(29); expect(result.errors.every(error => /flags|local header/.test(error))).toBe(true);
});
