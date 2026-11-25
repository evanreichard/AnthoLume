import JSZip from 'jszip';
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const directory = new URL('./fixtures/', import.meta.url);
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (bytes) => {
  let n = -1;
  for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ -1) >>> 0;
};
const chunk = (name, data) => {
  const type = Buffer.from(name),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  type.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, out.length - 4)), out.length - 4);
  return out;
};
const width = 2048,
  height = 1365,
  raw = Buffer.alloc((width * 3 + 1) * height);
let seed = 0xabc123;
for (let y = 0; y < height; y++)
  for (let x = 1; x <= width * 3; x++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    raw[y * (width * 3 + 1) + x] = seed & 255;
  }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 1 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const zip = await JSZip.loadAsync(await readFile(new URL('synthetic.epub', directory)));
const opfPath = Object.keys(zip.files).find((name) => name.endsWith('.opf')),
  base = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
let opf = await zip.file(opfPath).async('string');
opf = opf.replace('</manifest>', '<item id="large-photo" href="large-photo.png" media-type="image/png"/></manifest>');
zip.file(opfPath, opf);
const chapterPath = Object.keys(zip.files).find((name) => name === base + 'one.xhtml');
let chapter = await zip.file(chapterPath).async('string');
chapter = chapter.replace(
  '<body>',
  '<body><img id="large-photo" src="large-photo.png" alt="Deterministic public synthetic noise" style="width:100%;height:auto"/>',
);
zip.file(chapterPath, chapter);
zip.file(base + 'large-photo.png', png);
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
await writeFile(new URL('large-media.epub', directory), bytes);
console.log(JSON.stringify({ archiveBytes: bytes.length, pngBytes: png.length, width, height }));
