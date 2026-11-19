import { expect, test } from '@playwright/test';
test('actual archive worker rejects raw CRC/forged sizes/duplicate/method/bomb input before publication', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, zip = new p.JSZip(); zip.file('a.xml', 'hello world '.repeat(100)); zip.file('b.xml', 'another valid string');
    const source = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    const central = (b: ArrayBuffer) => { const v = new DataView(b); for (let n = 0; n < b.byteLength - 4; n++) if (v.getUint32(n, true) === 0x02014b50) return n; throw new Error('central absent'); };
    const inputs: [string, ArrayBuffer][] = [];
    for (const type of ['crc', 'small', 'huge', 'method']) {
      const bytes = source.slice(0), v = new DataView(bytes), c = central(bytes);
      if (type === 'crc') { v.setUint32(14, 0, true); v.setUint32(c + 16, 0, true); }
      if (type === 'small') { v.setUint32(22, 1, true); v.setUint32(c + 24, 1, true); }
      if (type === 'huge') v.setUint32(c + 24, 0x7fffffff, true);
      if (type === 'method') v.setUint16(c + 10, 99, true);
      inputs.push([type, bytes]);
    }
    const duplicate = source.slice(0), data = new Uint8Array(duplicate);
    for (let n = 0; n < data.length - 5; n++) if (new TextDecoder().decode(data.subarray(n, n + 5)) === 'b.xml') data[n] = 97;
    inputs.push(['duplicate', duplicate]);
    const bomb = new p.JSZip(); bomb.file('bomb.xml', 'x'.repeat(1024 * 1024)); inputs.push(['bomb', await bomb.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })]);
    const errors = [];
    for (const [name, bytes] of inputs) { try { await p.checkArchive(bytes); errors.push({ name, rejected: false, error: '' }); } catch (error) { errors.push({ name, rejected: true, error: String(error) }); } }
    return errors;
  });
  expect(result.map(r => r.rejected)).toEqual([true, true, true, true, true, true]);
  expect(result.find(r => r.name === 'crc')!.error).toContain('CRC'); expect(result.find(r => r.name === 'small')!.error).toContain('actual expanded'); expect(result.find(r => r.name === 'duplicate')!.error).toContain('duplicate'); expect(result.find(r => r.name === 'bomb')!.error).toContain('ratio');
});
