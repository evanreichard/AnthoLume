import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, open, readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { cacheDir, epubFile, referenceFile } from './large-fixture.ts';
await mkdir(cacheDir, { recursive: true });
if (process.argv.includes('--if-missing')) {
  try { const reference = JSON.parse(await readFile(referenceFile, 'utf8')), info = await stat(epubFile); if (reference.chapters !== 75 || reference.size !== info.size) throw new Error('Public fixture is incomplete; regenerate it explicitly'); process.exit(0); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const table = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc = bytes => { let n = -1; for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8); return (n ^ -1) >>> 0; };
const pngChunk = (name, value) => { const out = Buffer.alloc(value.length + 12); out.writeUInt32BE(value.length); out.write(name,4); value.copy(out,8); out.writeUInt32BE(crc(out.subarray(4,out.length-4)),out.length-4); return out; };
const raw = Buffer.alloc((1024 * 4 + 1) * 1024); let seed = 123456;
for (let y = 0; y < 1024; y++) for (let x = 1; x <= 4096; x++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; raw[y * 4097 + x] = seed & 255; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1024); ihdr.writeUInt32BE(1024,4); ihdr[8]=8; ihdr[9]=6;
const image = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(raw,{level:0})),pngChunk('IEND',Buffer.alloc(0))]);
const count = 75, stream = createWriteStream(epubFile), hash = createHash('sha256'), central = []; let offset = 0;
async function emit(bytes) { hash.update(bytes); offset += bytes.length; if (!stream.write(bytes)) await once(stream,'drain'); }
async function entry(name, bytes) {
  const nameBytes = Buffer.from(name), start = offset, checksum = crc(bytes), header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt32LE(checksum,14); header.writeUInt32LE(bytes.length,18); header.writeUInt32LE(bytes.length,22); header.writeUInt16LE(nameBytes.length,26);
  await emit(header); await emit(nameBytes); for (let p=0;p<bytes.length;p+=262144) await emit(bytes.subarray(p,p+262144));
  const c=Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt32LE(checksum,16); c.writeUInt32LE(bytes.length,20); c.writeUInt32LE(bytes.length,24); c.writeUInt16LE(nameBytes.length,28); c.writeUInt32LE(start,42); central.push(c,nameBytes);
}
await entry('mimetype',Buffer.from('application/epub+zip'));
await entry('META-INF/container.xml',Buffer.from('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'));
await entry('book.opf',Buffer.from(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">public-large</dc:identifier><dc:title>Public bounded large book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${Array.from({length:count},(_,n)=>`<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/><item id="i${n}" href="i${n}.png" media-type="image/png"/>`).join('')}</manifest><spine>${Array.from({length:count},(_,n)=>`<itemref idref="c${n}"/>`).join('')}</spine></package>`));
await entry('nav.xhtml',Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${Array.from({length:count},(_,n)=>`<li><a href="c${n}.xhtml">Section ${n}</a></li>`).join('')}</ol></nav></body></html>`));
for(let n=0;n<count;n++){ await entry(`c${n}.xhtml`,Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Section</title></head><body><h1>Section ${n}</h1><img id="photo" src="i${n}.png" style="width:100%;height:auto" alt="Public synthetic noise"/>${Array.from({length:12},(_,i)=>`<p id="p${i}">${'A public bounded-memory story with real pages and images. '.repeat(30)}</p>`).join('')}</body></html>`)); await entry(`i${n}.png`,image); }
const centralStart=offset; for(const c of central) await emit(c); const size=offset-centralStart, end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(size,12);end.writeUInt32LE(centralStart,16);await emit(end);stream.end();await once(stream,'close');
const partial=createHash('md5'), handle=await open(epubFile,'r'); for(let n=-1;n<=10;n++){const pos=n===-1?0:1024*2**(2*n);if(pos+1024>offset)break;const bytes=Buffer.alloc(1024);await handle.read(bytes,0,1024,pos);partial.update(bytes);}await handle.close();
await writeFile(referenceFile,JSON.stringify({size:offset,sha256:hash.digest('hex'),protocolHash:partial.digest('hex'),chapters:count,imageBytes:image.length})); console.log(JSON.stringify({size:offset,chapters:count,imageBytes:image.length}));
