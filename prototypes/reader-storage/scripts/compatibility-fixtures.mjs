import JSZip from 'jszip';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
JSZip.defaults.date = new Date('2026-01-01T00:00:00Z');
const dir = new URL('../public/fixtures/', import.meta.url);
// Public Synthetic Source - Preserve the review's original benign package, not an edited isolation prototype.
await copyFile(new URL('../../reader-isolation/public/fixtures/benign.epub', import.meta.url), new URL('representative.epub', dir));
const original = await readFile(new URL('representative.epub', dir));
const update = async (zip, path, change) => zip.file(path, change(await zip.file(path).async('string')));
async function save(name, zip) { await writeFile(new URL(`${name}.epub`, dir), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); }
const zip = await JSZip.loadAsync(original);
zip.file('OPS/styles/extra.css', '@font-face{font-family:ParentLato;src:url("../font.woff2") format("woff2")}@media(min-width:100px){.styled{outline:2px solid rgb(40,50,60)}}.styled{background-image:url("../drawing.svg")}');
await update(zip, 'OPS/package.opf', t => t.replace('</manifest>', '<item id="extra" href="styles/extra.css" media-type="text/css"/></manifest>'));
await update(zip, 'OPS/one.xhtml', t => t.replace('</head>', '<link rel="stylesheet" href="styles/extra.css"/></head>').replace('<body>', '<body><a id="same-fragment" href="#target">Same chapter target</a>').replace('</body>', '<div id="empty-tree-node"/><p id="asset-text">drawing.svg font.woff2 style.css remain literal body text.</p><svg xmlns="http://www.w3.org/2000/svg" width="60" height="30" viewBox="0 0 60 30"><defs><linearGradient id="gradient"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><rect id="shape" width="20" height="20"/></defs><rect width="60" height="30" fill="url(#gradient)"/><use href="#shape"/></svg></body>'));
await save('compatibility', zip);
const cases = {
  'css-escaped-external-url': z => update(z, 'OPS/style.css', t => t + 'p{background:u\\72l("https://unlisted-compat.invalid/steal")}'),
  'css-escaped-url-value': z => update(z, 'OPS/style.css', t => t + 'p{background:url("\\68 ttps://unlisted-compat.invalid/steal")}'),
  'css-external-font': z => update(z, 'OPS/style.css', t => t + '@font-face{font-family:Steal;src:url("https://unlisted-compat.invalid/font.woff2")}'),
  'css-system-font': z => update(z, 'OPS/style.css', t => t + '@font-face{font-family:Local;src:local("Lato")}'),
  'css-import-string': z => update(z, 'OPS/style.css', t => '@import "https://unlisted-compat.invalid/steal.css";' + t),
  'css-archive-escape': z => update(z, 'OPS/style.css', t => t + 'p{background:url("../../../../outside.svg")}'),
  'css-encoded-slash': z => update(z, 'OPS/style.css', t => t + 'p{background:url("%2fapi%2fcredential")}'),
  'css-data-svg': z => update(z, 'OPS/style.css', t => t + 'p{background:url("data:image/svg+xml,%3Csvg%20onload=alert(1)%3E")}'),
  'svg-script': z => update(z, 'OPS/drawing.svg', t => t.replace('</svg>', '<script>parent.localStorage.setItem("book-ran","yes")</script></svg>')),
  'svg-event': z => update(z, 'OPS/drawing.svg', t => t.replace('<svg ', '<svg onload="parent.document.body.dataset.bookRan=1" ')),
  'svg-foreignobject': z => update(z, 'OPS/drawing.svg', t => t.replace('</svg>', '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Spoof</div></foreignObject></svg>')),
  'svg-external-image': z => update(z, 'OPS/drawing.svg', t => t.replace('</svg>', '<image href="https://unlisted-compat.invalid/image.png"/></svg>')),
  'svg-external-paint': z => update(z, 'OPS/drawing.svg', t => t.replace('fill="rgb(120,20,70)"', 'fill="url(https://unlisted-compat.invalid/paint.svg)"')),
  'svg-external-use': z => update(z, 'OPS/one.xhtml', t => t.replace('</body>', '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://unlisted-compat.invalid/use.svg#shape"/></svg></body>')),
  'inline-foreignobject': z => update(z, 'OPS/one.xhtml', t => t.replace('</body>', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Spoof</div></foreignObject></svg></body>')),
  'metadata-script': z => update(z, 'OPS/package.opf', t => t.replace('</metadata>', '<script>parent.document.body.dataset.bookRan=1</script></metadata>')),
  'metadata-active-attribute': z => update(z, 'OPS/package.opf', t => t.replace('<dc:title>', '<dc:title onclick="alert(1)">')),
  'body-active-attribute': z => update(z, 'OPS/one.xhtml', t => t.replace('<body>', '<body onload="parent.localStorage.setItem(\'book-ran\',\'yes\')">')),
  'svg-in-png-name': async z => { z.file('OPS/payload.png', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'); await update(z, 'OPS/package.opf', t => t.replace('</manifest>', '<item id="bad" href="payload.png" media-type="image/png"/></manifest>')); },
  'font-in-svg-role': z => update(z, 'OPS/package.opf', t => t.replace('href="font.woff2" media-type="font/woff2"', 'href="font.woff2" media-type="image/svg+xml"')),
  'internal-link-api': z => update(z, 'OPS/one.xhtml', t => t.replace('href="two.xhtml#second"', 'href="/api/credential"')),
  'internal-link-missing-fragment': z => update(z, 'OPS/one.xhtml', t => t.replace('href="two.xhtml#second"', 'href="two.xhtml#absent"')),
  'internal-link-asset': z => update(z, 'OPS/one.xhtml', t => t.replace('href="two.xhtml#second"', 'href="font.woff2"')),
  'html-tree-repair': z => update(z, 'OPS/one.xhtml', t => t.replace('</body>', '<p><div id="not-html-roundtrippable">Invalid HTML nesting</div></p></body>')),
  'svg-asset-self-cycle': z => update(z, 'OPS/drawing.svg', t => t.replace('</svg>', '<image href="drawing.svg"/></svg>')),
  'svg-asset-pair-cycle': async z => { await update(z, 'OPS/drawing.svg', t => t.replace('</svg>', '<image href="other.svg"/></svg>')); z.file('OPS/other.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="drawing.svg"/></svg>'); await update(z, 'OPS/package.opf', t => t.replace('</manifest>', '<item id="other" href="other.svg" media-type="image/svg+xml"/></manifest>')); }
};
for (const [name, mutate] of Object.entries(cases)) { const z = await JSZip.loadAsync(original); await mutate(z); await save(`compat-hostile-${name}`, z); }
await writeFile(new URL('compat-hostile.json', dir), JSON.stringify(Object.keys(cases), null, 2) + '\n');
console.log(`Copied original benign representative; generated compatibility book and ${Object.keys(cases).length} CSS/SVG/metadata/navigation hostile fixtures`);
