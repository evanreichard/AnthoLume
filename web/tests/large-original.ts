import JSZip from 'jszip';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { deflateSync, crc32 } from 'node:zlib';
import { scratch } from './fixtures';

export async function largeOriginal(): Promise<string> {
  const path = `${scratch}cancel-public-256m.epub`;
  try { if ((await stat(path)).size > 256 * 1024 * 1024) return path; } catch { /* Only a completed, atomically renamed fixture is reused. */ }
  await mkdir(scratch, { recursive: true });
  const image = `${scratch}cancel-public-image.png`;
  const output = createWriteStream(image);
  async function write(value: Uint8Array) {
    if (!output.write(value)) await once(output, 'drain');
  }
  async function chunk(name: string, data: Buffer) {
    const type = Buffer.from(name), header = Buffer.alloc(8), trailer = Buffer.alloc(4);
    header.writeUInt32BE(data.length); type.copy(header, 4);
    trailer.writeUInt32BE(crc32(data, crc32(type)));
    await write(header); await write(data); await write(trailer);
  }
  await write(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const dimensions = Buffer.alloc(13); dimensions.writeUInt32BE(1, 0); dimensions.writeUInt32BE(1, 4); dimensions[8] = 8; dimensions[9] = 6;
  await chunk('IHDR', dimensions);
  const padding = Buffer.alloc(65536, 7);
  for (let n = 0; n < 128; n++) await chunk('npAD', padding);
  await chunk('IDAT', deflateSync(Buffer.from([0, 80, 120, 60, 255])));
  await chunk('IEND', Buffer.alloc(0));
  await new Promise<void>((resolve, reject) => { output.once('finish', resolve); output.once('error', reject); output.end(); });
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">public-cancel-original</dc:identifier><dc:title>Public cancellation original</dc:title><dc:creator>Public fixture</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>${Array.from({ length: 32 }, (_, i) => `<item id="image-${i}" href="image-${i}.png" media-type="image/png"/>`).join('')}</manifest><spine><itemref idref="chapter"/></spine></package>`);
  zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Public chapter</a></li></ol></nav></body></html>');
  zip.file('OEBPS/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Public chapter</title></head><body><h1>Public chapter</h1><p>A deterministic public original for cancellation.</p><img src="image-0.png" alt="Public pixel"/></body></html>');
  for (let n = 0; n < 32; n++) zip.file(`OEBPS/image-${n}.png`, createReadStream(image));
  await pipeline(zip.generateNodeStream({ type: 'nodebuffer', compression: 'STORE', streamFiles: true }), createWriteStream(`${path}.tmp`));
  await rename(`${path}.tmp`, path);
  return path;
}
