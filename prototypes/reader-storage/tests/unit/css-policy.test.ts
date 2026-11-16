import { expect, test } from 'vitest';
import { supportedCSS } from '../../src/css-policy';
import { archiveReference } from '../../src/archive-path';

test('parsed CSS supports ordinary colors, media, font-face and archive URLs by effective role', () => {
  const references: string[] = [];
  const css = '@font-face{font-family:Proof;src:url("../font.woff2") format("woff2")}@media(min-width:100px){p{color:rgb(12,34,56);width:calc(100% - 1em);background:url("../image.svg")}}';
  const result = supportedCSS(css, (value, kind) => { references.push(`${kind}:${archiveReference(value, 'OPS/styles/a.css').path}`); return `blob:https://proof.invalid/${kind}`; });
  expect(references).toEqual(['font:OPS/font.woff2', 'image:OPS/image.svg']); expect(result).toContain('blob:https://proof.invalid/font');
});
test('CSS parser decodes escaped URL values before archive reference validation', () => {
  expect(() => supportedCSS('p{background:url("\\68 ttps://arbitrary.invalid/path")}', value => archiveReference(value, 'OPS/style.css').path)).toThrow('Non-archive');
  expect(() => supportedCSS('p{background:u\\72l("https://arbitrary.invalid/path")}', value => value)).toThrow('Unsupported CSS function: url');
});
test('unsupported active/implicit-resource CSS constructs and parser recovery fail explicitly', () => {
  for (const text of ['@import "https://arbitrary.invalid/a.css";', '@font-face{font-family:X;src:local("System")}', 'p{background:image-set("https://arbitrary.invalid/image" 1x)}', 'p{color:expression(alert(1))}', 'p{--resource:url(x.png)}', 'p{background:???}']) expect(() => supportedCSS(text, value => value), text).toThrow();
});
test('archive path resolver confines URI interpretation including encoded separators, schemes and traversal', () => {
  expect(archiveReference('../font.woff2', 'OPS/styles/style.css')).toEqual({ path: 'OPS/font.woff2', fragment: '' });
  expect(archiveReference('#target', 'OPS/one.xhtml')).toEqual({ path: 'OPS/one.xhtml', fragment: 'target' });
  for (const value of ['https://proof.invalid/asset', '//arbitrary.invalid/a', '/api/credential', 'data:image/svg+xml,a', 'blob:random', '%2fapi', '%252fapi', '../../escape', '%2e%2e/%2e%2e/escape', 'image.svg?credential=1', 'x\\y']) expect(() => archiveReference(value, 'OPS/a.css')).toThrow();
});
test('no-resource CSS remains byte-for-byte as authored rather than a blanket syntax rejection or sanitizer', () => {
  const original = '@media (min-width: 100px) { p { color: rgb(12, 34, 56); } }';
  expect(supportedCSS(original, () => { throw new Error('No URL expected'); })).toBe(original);
});
