import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { crc32 } from '../../zip-rules';
import { measureActivity } from '../../activity';
import { parseKO } from '../../codec';
import { supportedCSS } from '../../css-policy';
import { requireSafeHTMLStyle } from '../../body-contract';
import { receiptFor, validSubmission, type Submission } from '../../wire';
import { validProblem } from '../../protocol';
import { rasterDimensions } from '../../media-budget';

const event: Submission = {
  kind: 'progress',
  payload: {
    event_id: 'one',
    document_id: 'original-server-id',
    device_id: 'installation',
    observed_at: '2026-01-01T00:00:00Z',
    position: '/body/DocFragment[1]/body/p[1]',
    fraction: 0.2,
    base_revision: '0',
  },
};
test('opaque KO grammar retains production suffixes, no selector injection', () => {
  expect(parseKO('/body/DocFragment[19]/body/h1/img.0').spine).toBe(18);
  expect(parseKO('/body/DocFragment[1]/body/p[2]/text()[1].23').steps).toEqual([{ tag: 'p', index: 2 }]);
  for (const value of ['', '/body/DocFragment[0]/body', '/body/DocFragment[1]/body/p,script'])
    expect(() => parseKO(value)).toThrow();
});
const measurement = {
  forward: true,
  localOnly: false,
  pageWords: 100,
  totalWords: 10000,
  currentWord: 500,
  pageStartMs: 100000,
  nowMs: 130000,
};
test('forward turns round elapsed seconds and cap or exclude extreme reading speeds', () => {
  expect(measureActivity(measurement)).toEqual({ duration: 30, start_time: 100, page: 5, pages: 100 });
  expect(measureActivity({ ...measurement, nowMs: 130499 })?.duration).toBe(30);
  expect(measureActivity({ ...measurement, nowMs: 130500 })?.duration).toBe(31);
  expect(measureActivity({ ...measurement, nowMs: 103000 })).toBeUndefined();
  expect(measureActivity({ ...measurement, nowMs: 300000 })?.duration).toBe(60);
  for (const change of [{ forward: false }, { localOnly: true }, { pageWords: 0 }, { totalWords: NaN }])
    expect(measureActivity({ ...measurement, ...change })).toBeUndefined();
});
test('receipt gate requires exact event/kind/revision/fields and exact large integer arithmetic', () => {
  expect(validSubmission(event)).toBe(true);
  expect(receiptFor({ event_id: 'one', kind: 'progress', revision: '1' }, event)).toBe(true);
  for (const body of [
    { event_id: 'other', kind: 'progress', revision: '1' },
    { event_id: 'one', kind: 'activity', revision: null },
    { event_id: 'one', kind: 'progress', revision: 1 },
    { event_id: 'one', kind: 'progress', revision: '2' },
    { event_id: 'one', kind: 'progress', revision: '1', extra: true },
  ])
    expect(receiptFor(body, event)).toBe(false);
  const large = { ...event, payload: { ...event.payload, base_revision: '9007199254740992' } };
  expect(receiptFor({ event_id: 'one', kind: 'progress', revision: '9007199254740993' }, large)).toBe(true);
});
test('only exact matching Problem status/code/revision shapes can affect replay', () => {
  const p = {
    type: 'about:blank',
    title: 'Conflict',
    detail: 'Changed',
    code: 'progress_conflict',
    status: 409,
    current_revision: '2',
  };
  expect(validProblem(p, 409)).toBe(true);
  expect(validProblem(p, 500)).toBe(false);
  expect(validProblem({ ...p, extra: true }, 409)).toBe(false);
  expect(validProblem({ ...p, current_revision: '02' }, 409)).toBe(false);
});
test('unsupported stylesheet and inline declarations are dropped without losing supported styling', () => {
  const source = 'p{text-align:-webkit-left}';
  expect(supportedCSS(source, (value) => value)).toBe(source);
  expect(supportedCSS('p{text-align:-webkit-unknown;unknown:1;color:red}', (value) => value)).toBe('p{color:red}');
  expect(
    supportedCSS('color:red;broken;color:future(blue);--extra:10px;margin:2px', (value) => value, 'declarationList'),
  ).toBe('color:red;margin:2px');
});

test('resource checks still apply in stylesheets with discarded declarations', () => {
  const resolve = (value: string) => {
    if (value !== 'image.png') throw new Error('Unapproved asset');
    return 'blob:validated-asset';
  };
  expect(supportedCSS('p{unknown:1;background-image:url(image.png)}', resolve)).toBe(
    'p{background-image:url(blob:validated-asset)}',
  );
  expect(() => supportedCSS('unknown:url(other.png);color:red', resolve, 'declarationList')).toThrow(
    'Unapproved asset',
  );
});

test('parsed benign CSS remains usable; external URL roles are actually visited', () => {
  let seen = '';
  expect(supportedCSS('p{color:rgb(12,34,56)}@media(min-width:100px){p{border:3px solid red}}', (v) => v)).toContain(
    'rgb',
  );
  supportedCSS('p{background-image:url("image.png")}', (v) => {
    seen = v;
    return v;
  });
  expect(seen).toBe('image.png');
  for (const css of [
    '@import "https://x.invalid/a.css";',
    'p{background:image-set("https://x.invalid/a" 1x)}',
    '@font-face{font-family:x;src:local("system")}',
  ])
    expect(() => supportedCSS(css, (v) => v)).toThrow();
});
test('HTML rawtext delimiters/case are guarded without blanket style-prefix rejection', () => {
  for (const s of ['</style>', '</StYle\n>', '</style/', '</style x>', '</style'])
    expect(() => requireSafeHTMLStyle(s)).toThrow();
  expect(() => requireSafeHTMLStyle('/* </stylesheet> */')).not.toThrow();
});
test('streamed CRC retains state across chunks and matches the standard check vector', () => {
  const a = new TextEncoder().encode('1234'),
    b = new TextEncoder().encode('56789');
  expect(crc32(b, crc32(a))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});
test('raster dimensions are bounded before native decode, including valid tiny PNG and forged oversized header', async () => {
  const zip = await JSZip.loadAsync(readFileSync(new URL('../fixtures/synthetic.epub', import.meta.url)));
  const png = await zip.file('pixel.png')!.async('uint8array');
  expect(rasterDimensions('image/png', png)).toEqual({ width: 1, height: 1 });
  const huge = png.slice();
  new DataView(huge.buffer).setUint32(16, 16384);
  expect(() => rasterDimensions('image/png', huge)).toThrow('pixel budget');
});
