import { expect, test } from 'vitest';
import { validZipFlags } from '../../zip-rules';
for (const descriptor of [0, 8]) for (const utf8 of [0, 0x800]) {
  for (const options of [0, 2, 4, 6]) test(`DEFLATE option ${options} UTF8 ${utf8} descriptor ${descriptor} is legal`, () => expect(validZipFlags(8, descriptor | utf8 | options)).toBe(true));
  test(`STORE UTF8 ${utf8} descriptor ${descriptor} ignores compression-option bits`, () => { expect(validZipFlags(0, descriptor | utf8)).toBe(true); for (const options of [2, 4, 6, 16, 22]) expect(validZipFlags(0, descriptor | utf8 | options)).toBe(true); });
}
for (const method of [0, 8]) test(`method ${method} rejects every encrypted/reserved flag`, () => { for (const bit of [0, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15]) expect(validZipFlags(method, 1 << bit)).toBe(false); expect(validZipFlags(99, 0)).toBe(false); });
