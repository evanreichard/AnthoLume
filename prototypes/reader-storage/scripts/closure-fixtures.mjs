import JSZip from 'jszip';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
JSZip.defaults.date = new Date('2026-01-01T00:00:00Z');
const dir = new URL('../public/fixtures/', import.meta.url);
const original = await readFile(new URL('representative.epub', dir));
const update = async (zip, path, change) => zip.file(path, change(await zip.file(path).async('string')));
async function save(name, zip) { await writeFile(new URL(`${name}.epub`, dir), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); }
// Included Review Reproductions - Copied unchanged from review-reader-final, not a scratch dependency for regeneration.
const rawtext = ['closure-review-head-css-rawtext', 'closure-review-head-css-rawtext-script'];
const variants = {
  'mixed-case': '/* </StYlE ><img id="closure-mixed" src="https://rawtext-closure.invalid/mixed"/> */',
  'tab-delimiter': '/* </style\t><img src="https://rawtext-closure.invalid/tab"/> */',
  'newline-delimiter': '/* </style\n><img src="https://rawtext-closure.invalid/newline"/> */',
  'slash-delimiter': '/* </style/><img src="https://rawtext-closure.invalid/slash"/> */',
  'end-tag-attribute': '/* </style ignored="yes"><img src="https://rawtext-closure.invalid/attribute"/> */',
  'css-string': 'p::before{content:"</style><img id=closure-string src=https://rawtext-closure.invalid/string>"}',
  'generated-css-string': 'p::before{content:"\\3c /style><img id=closure-generated src=https://rawtext-closure.invalid/generated>"}p{background:url("drawing.svg")}'
};
for (const [name, css] of Object.entries(variants)) {
  const zip = await JSZip.loadAsync(original);
  await update(zip, 'OPS/one.xhtml', text => text.replace('</head>', `<style><![CDATA[${css}]]></style></head>`));
  const file = `closure-rawtext-${name}`; await save(file, zip); rawtext.push(file);
}
await writeFile(new URL('closure-rawtext.json', dir), JSON.stringify(rawtext, null, 2) + '\n');
const ncx = await JSZip.loadAsync(original);
ncx.remove('OPS/nav.xhtml');
await update(ncx, 'OPS/package.opf', text => text.replace('<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>', '<item id="ncx" href="navigation/toc.ncx" media-type="application/x-dtbncx+xml"/>').replace('<spine>', '<spine toc="ncx">'));
ncx.file('OPS/navigation/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Relocated NCX</text></docTitle><navMap><navPoint id="one"><navLabel><text>One</text></navLabel><content src="../one.xhtml"/></navPoint><navPoint id="two"><navLabel><text>Two</text></navLabel><content src="../two.xhtml#second"/></navPoint></navMap></ncx>');
await save('closure-subdir-ncx', ncx);
const invalid = [];
for (const [kind, source, path] of [['nav', 'closure-review-subdir-toc', 'OPS/navigation/toc.xhtml'], ['ncx', 'closure-subdir-ncx', 'OPS/navigation/toc.ncx']]) {
  for (const [name, href] of [['external', 'https://nav-closure.invalid/chapter'], ['missing-fragment', '../two.xhtml#absent']]) {
    const zip = await JSZip.loadAsync(await readFile(new URL(`${source}.epub`, dir)));
    await update(zip, path, text => text.replace(/\.\.\/two\.xhtml(?:#second)?/, href));
    const file = `closure-invalid-${kind}-${name}`; await save(file, zip); invalid.push(file);
  }
}
await writeFile(new URL('closure-invalid-navigation.json', dir), JSON.stringify(invalid, null, 2) + '\n');
const hashes = {};
for (const file of [...rawtext, ...invalid, 'closure-review-subdir-toc', 'closure-subdir-ncx', 'closure-review-body-svg-css-rawtext']) {
  const bytes = await readFile(new URL(`${file}.epub`, dir));
  hashes[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(new URL('closure-fixtures.json', dir), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Closure fixtures: ${rawtext.length} raw-text rejects, ${invalid.length} invalid navigation rejects, relocated NAV/NCX, original SVG-style control`);
