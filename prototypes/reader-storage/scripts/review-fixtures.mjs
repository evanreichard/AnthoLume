import JSZip from 'jszip';
import { readFile, writeFile } from 'node:fs/promises';
JSZip.defaults.date = new Date('2026-01-01T00:00:00Z');
const directory = new URL('../public/fixtures/', import.meta.url);
const original = await readFile(new URL('synthetic.epub', directory));
const css = '@import "https://unlisted-review.invalid/import.css";body{color:rgb(1,2,3)!important;background:url(https://another-review.invalid/track)}';
const update = async (zip, path, transform) => zip.file(path, transform(await zip.file(path).async('string')));
const appendManifest = (zip, item) => update(zip, 'book.opf', text => text.replace('</manifest>', `${item}</manifest>`));
const link = (zip, href) => update(zip, 'one.xhtml', text => text.replace('</head>', `<link rel="stylesheet" href="${href}"/></head>`));
const aliases = {
  'manifest-css-image-name': async zip => { zip.file('payload.png', css); await appendManifest(zip, '<item id="css" href="payload.png" media-type="text/css"/>'); await link(zip, 'payload.png'); },
  'manifest-css-image-name-passive': async zip => { zip.file('payload.png', 'body{color:red}'); await appendManifest(zip, '<item id="css" href="payload.png" media-type="text/css"/>'); },
  'image-css-name': async zip => { zip.file('payload.css', await zip.file('pixel.png').async('uint8array')); await appendManifest(zip, '<item id="bad" href="payload.css" media-type="image/png"/>'); },
  'css-binary-content': async zip => { zip.file('payload.css', await zip.file('pixel.png').async('uint8array')); await appendManifest(zip, '<item id="bad" href="payload.css" media-type="text/css"/>'); await link(zip, 'payload.css'); },
  'unmanifested-stylesheet': async zip => { zip.file('payload.css', 'body{color:red}'); await link(zip, 'payload.css'); },
  'unmanifested-image-stylesheet': async zip => { zip.file('payload.png', css); await link(zip, 'payload.png'); },
  'image-role-stylesheet': async zip => { zip.file('payload.png', 'body{color:red}'); await appendManifest(zip, '<item id="bad" href="payload.png" media-type="image/png"/>'); await link(zip, 'payload.png'); },
  'uppercase-stylesheet-alias': async zip => { zip.file('payload.png', 'body{color:red}'); await appendManifest(zip, '<item id="bad" href="payload.png" media-type="image/png"/>'); await update(zip, 'one.xhtml', text => text.replace('</head>', '<LINK REL="stylesheet" HREF="payload.png"/></head>')); }
};
const structures = {
  'missing-rootfile': zip => zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles/></container>'),
  'rootfile-wrong-media': zip => update(zip, 'META-INF/container.xml', text => text.replace('application/oebps-package+xml', 'image/png')),
  'rootfile-missing-resource': zip => zip.remove('book.opf'),
  'malformed-opf': zip => zip.file('book.opf', '<package'),
  'wrong-opf-root': zip => update(zip, 'book.opf', text => text.replace('<package ', '<notpackage ').replace('</package>', '</notpackage>')),
  'missing-metadata': zip => update(zip, 'book.opf', text => text.replace(/<metadata[\s\S]*?<\/metadata>/, '')),
  'missing-manifest': zip => update(zip, 'book.opf', text => text.replace(/<manifest>[\s\S]*?<\/manifest>/, '')),
  'empty-spine': zip => update(zip, 'book.opf', text => text.replace(/<spine>[\s\S]*?<\/spine>/, '<spine/>')),
  'missing-spine': zip => update(zip, 'book.opf', text => text.replace(/<spine>[\s\S]*?<\/spine>/, '')),
  'spine-unknown-id': zip => update(zip, 'book.opf', text => text.replace('idref="one"', 'idref="absent"')),
  'spine-missing-file': zip => zip.remove('one.xhtml'),
  'spine-image-role': zip => update(zip, 'book.opf', text => text.replace('idref="one"', 'idref="pixel"')),
  'spine-invalid-xhtml': zip => zip.file('one.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head/></html>'),
  'duplicate-manifest-id': zip => appendManifest(zip, '<item id="one" href="extra.xhtml" media-type="application/xhtml+xml"/>').then(() => zip.file('extra.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body/></html>'))
};
for (const [group, cases] of Object.entries({ aliases, structures })) {
  for (const [name, mutate] of Object.entries(cases)) {
    const zip = await JSZip.loadAsync(original); await mutate(zip);
    await writeFile(new URL(`review-${name}.epub`, directory), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  }
  await writeFile(new URL(`${group}.json`, directory), JSON.stringify(Object.keys(cases), null, 2) + '\n');
}
const passive = await JSZip.loadAsync(original);
passive.file('passive.css', 'body{color:#010203}');
await appendManifest(passive, '<item id="css" href="passive.css" media-type="text/css"/>'); await link(passive, 'passive.css');
await writeFile(new URL('passive-css.epub', directory), await passive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
const nested = await JSZip.loadAsync(original);
await update(nested, 'one.xhtml', text => text.replace(/<body>[\s\S]*<\/body>/, '<body><div><blockquote><p id="nested">Nested paragraph</p></blockquote><p id="first">First direct paragraph</p><p id="second">Second direct paragraph</p></div><div><figure><p id="figure-nested">Figure paragraph</p></figure><p id="figure-first">First figure sibling</p><p id="figure-second">Second figure sibling</p></div></body>'));
await writeFile(new URL('nested.epub', directory), await nested.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Generated ${Object.keys(aliases).length} role aliases, ${Object.keys(structures).length} invalid structures, and nested KO fixture`);
