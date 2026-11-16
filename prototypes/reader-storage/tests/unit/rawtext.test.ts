import { expect, test } from 'vitest';
import { requireSafeHTMLStyle } from '../../src/body-contract';
import { supportedCSS } from '../../src/css-policy';

test('HTML style termination is rejected even inside valid CSS comments/strings, for case and delimiter forms', () => {
  expect(() => requireSafeHTMLStyle('</style')).toThrow('raw-text terminator');
  for (const ending of ['</style>', '</StYlE >', '</style\t>', '</style\n>', '</style\f>', '</style\r>', '</style/>', '</style ignored=yes>']) {
    expect(() => requireSafeHTMLStyle(`/* ${ending}<img src=probe> */`), ending).toThrow('raw-text terminator');
    expect(() => requireSafeHTMLStyle(`p::before{content:"${ending}<img src=probe>"}`), ending).toThrow('raw-text terminator');
  }
});
test('ordinary rgb/media/font CSS and non-terminating style-name prefixes remain permitted by the boundary guard', () => {
  for (const value of ['p{color:rgb(12,34,56)}', '@media(min-width:100px){p{color:red}}', '@font-face{font-family:X;src:url(font.woff2)}', '/* </stylesheet><img> */']) expect(() => requireSafeHTMLStyle(value)).not.toThrow();
});
test('AST generation is not assumed safe for HTML raw text: decoded CSS strings are checked after URL rewriting', () => {
  const source = 'p::before{content:"\\3c /style><img id=generated>"}p{background:url(drawing.svg)}';
  expect(() => requireSafeHTMLStyle(source)).not.toThrow();
  const generated = supportedCSS(source, () => 'blob:validated-asset');
  expect(() => requireSafeHTMLStyle(generated)).toThrow('raw-text terminator');
});
