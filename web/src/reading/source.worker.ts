import { sha256 } from '@noble/hashes/sha2.js';
import SparkMD5 from 'spark-md5';
import { sourceLimits as L, type Source, type ZipEntry, type ZipIndex, type IOStats } from './source';
import { crc32, validZipFlags } from './zip-rules';
const host = globalThis as unknown as { onmessage: (event: MessageEvent<{ source: Source; operation: string; entry?: ZipEntry; released?: number }>) => void; postMessage: (message: unknown, transfer?: Transferable[]) => void };
let releaseId = 0;
const releases = new Map<number, () => void>();
function retire(bytes: Uint8Array<ArrayBuffer>) {
  const id = ++releaseId;
  return new Promise<void>(resolve => { releases.set(id, resolve); host.postMessage({ release: bytes.buffer, releaseId: id }, [bytes.buffer]); });
}
const hex = (value: Uint8Array) => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
function requireZIP(ok: unknown, detail: string): asserts ok { if (!ok) throw new Error(`Invalid archive: ${detail}`); }
class RangeReader {
  stats: IOStats = { reads: 0, readBytes: 0, maxRead: 0, expanded: 0, peakEntry: 0 };
  private database?: IDBDatabase;
  private cached?: { n: number; bytes: Uint8Array<ArrayBuffer> };
  private blobBuffer: ArrayBuffer = new ArrayBuffer(L.chunkBytes);
  private temporaries: Uint8Array<ArrayBuffer>[] = [];
  constructor(readonly source: Source) {}
  async read(start: number, length: number, target?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    requireZIP(Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= 0 && length >= 0 && length <= L.chunkBytes && start + length <= this.source.size, 'bounded source range');
    this.stats.maxRead = Math.max(this.stats.maxRead, length);
    const out = target ? target.subarray(0, length) : new Uint8Array(length); let offset = 0;
    if (!target) this.temporaries.push(out);
    while (offset < length) {
      const n = Math.floor((start + offset) / L.chunkBytes), from = (start + offset) % L.chunkBytes;
      const bytes = await this.chunk(n), amount = Math.min(length - offset, bytes.length - from);
      requireZIP(amount > 0, 'missing source chunk'); out.set(bytes.subarray(from, from + amount), offset); offset += amount;
    }
    return out;
  }
  async chunk(n: number): Promise<Uint8Array<ArrayBuffer>> {
    if (this.cached?.n === n) return this.cached.bytes;
    if (this.cached && this.source.kind === 'idb') await retire(this.cached.bytes);
    this.cached = undefined;
    let blob: Blob | undefined, storedBytes: ArrayBuffer | undefined;
    if (this.source.kind === 'blob') blob = this.source.blob.slice(n * L.chunkBytes, Math.min(this.source.size, (n + 1) * L.chunkBytes));
    else {
      const source = this.source;
      if (!this.database) this.database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(source.database); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
      const data = await new Promise<Blob | ArrayBuffer>((resolve, reject) => { const tx = this.database!.transaction('sourceChunks'), r = tx.objectStore('sourceChunks').get(`${source.id}:${n}`); r.onerror = () => reject(r.error); r.onsuccess = () => r.result?.data instanceof Blob || r.result?.data instanceof ArrayBuffer ? resolve(r.result.data) : reject(new Error('Original chunk unavailable')); });
      if (data instanceof Blob) blob = data; else storedBytes = data;
    }
    const size = blob ? blob.size : storedBytes!.byteLength;
    requireZIP(size === Math.min(L.chunkBytes, this.source.size - n * L.chunkBytes), 'source chunk size');
    this.stats.reads++; this.stats.readBytes += size; this.stats.maxRead = Math.max(this.stats.maxRead, size);
    let bytes: Uint8Array<ArrayBuffer>;
    if (blob) {
      const stream = blob.stream().getReader({ mode: 'byob' }); let offset = 0;
      try {
        while (offset < size) {
          const part = await stream.read(new Uint8Array(this.blobBuffer, offset, size - offset));
          requireZIP(part.value && part.value.length > 0, 'short Blob range');
          this.blobBuffer = part.value.buffer; offset += part.value.length;
        }
        bytes = new Uint8Array(this.blobBuffer, 0, size);
      } finally { await stream.cancel(); stream.releaseLock(); }
    } else bytes = new Uint8Array(storedBytes!);
    if (this.source.digests) requireZIP(hex(sha256(bytes)) === this.source.digests[n], 'source chunk integrity');
    this.cached = { n, bytes }; return bytes;
  }
  async releaseReads() { for (const bytes of this.temporaries) await retire(bytes); this.temporaries = []; }
  close() { this.cached = undefined; this.database?.close(); }
}
async function hash(reader: RangeReader) {
  const hash = sha256.create(), digests: string[] = [];
  for (let offset = 0; offset < reader.source.size; offset += L.chunkBytes) { const bytes = await reader.chunk(offset / L.chunkBytes); hash.update(bytes); digests.push(hex(sha256(bytes))); }
  const partial = new SparkMD5.ArrayBuffer();
  for (let n = -1; n <= 10; n++) { const offset = n === -1 ? 0 : 1024 * 2 ** (2 * n); if (offset >= reader.source.size) break; const bytes = await reader.read(offset, Math.min(1024, reader.source.size - offset)); partial.append(bytes.buffer); }
  return { sha256: hex(hash.digest()), protocolHash: partial.end(), digests };
}
const u16 = (bytes: Uint8Array, p: number) => { requireZIP(p >= 0 && p + 2 <= bytes.length, 'truncated header'); return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(p, true); };
const u32 = (bytes: Uint8Array, p: number) => { requireZIP(p >= 0 && p + 4 <= bytes.length, 'truncated header'); return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(p, true); };
function safeName(bytes: Uint8Array) {
  const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  requireZIP(name.length > 0 && name.length <= 512 && !/[\\\x00-\x1f\x7f:%?#]/.test(name) && !name.startsWith('/') && name === name.normalize('NFC') && name.replace(/\/$/, '').split('/').every(p => p && p !== '.' && p !== '..'), 'unsafe name'); return name;
}
function extras(bytes: Uint8Array) { for (let p = 0; p < bytes.length;) { const id = u16(bytes, p), length = u16(bytes, p + 2); requireZIP(id !== 1 && id !== 0x7075 && p + 4 + length <= bytes.length, 'ZIP64/alternate path/extra'); p += 4 + length; } }
function limit(name: string) { return /\.css$/i.test(name) ? L.cssBytes : /\.(?:xhtml|html|xml|opf|ncx|svg)$/i.test(name) ? L.textBytes : L.entryBytes; }
async function index(reader: RangeReader, directoryOnly: boolean): Promise<ZipIndex> {
  const size = reader.source.size, tailStart = Math.max(0, size - 65557), tail = await reader.read(tailStart, size - tailStart);
  let end = tail.length - 22; while (end >= 0 && u32(tail, end) !== 0x06054b50) end--;
  requireZIP(end >= 0 && end + 22 + u16(tail, end + 20) === tail.length, 'end record');
  const count = u16(tail, end + 10), central = u32(tail, end + 16), centralSize = u32(tail, end + 12);
  requireZIP(!u16(tail, end + 4) && !u16(tail, end + 6) && u16(tail, end + 8) === count && count > 0 && count <= L.entries && centralSize <= L.centralBytes && central + centralSize === tailStart + end, 'central bounds/count/ZIP64');
  await reader.releaseReads();
  const directory = new Uint8Array(centralSize);
  for (let p = 0; p < centralSize; p += L.chunkBytes) {
    const window = directory.subarray(p, p + L.chunkBytes);
    await reader.read(central + p, window.length, window);
  }
  const entries: ZipEntry[] = [], names = new Set<string>(); let position = 0, expanded = 0;
  for (let n = 0; n < count; n++) {
    const h = directory.subarray(position, position + 46); requireZIP(h.length === 46 && u32(h, 0) === 0x02014b50, 'central signature');
    const flags = u16(h, 8), method = u16(h, 10), compressed = u32(h, 20), full = u32(h, 24), nl = u16(h, 28), extra = u16(h, 30), comment = u16(h, 32), offset = u32(h, 42);
    requireZIP(validZipFlags(method, flags) && !u16(h, 34) && nl > 0 && nl <= 2048 && position + 46 + nl + extra + comment <= centralSize, 'flags/method/header bounds');
    const name = safeName(directory.subarray(position + 46, position + 46 + nl)), normalized = name.replace(/\/$/, ''); requireZIP(!names.has(normalized), 'duplicate name'); names.add(normalized);
    extras(directory.subarray(position + 46 + nl, position + 46 + nl + extra));
    requireZIP(full <= limit(name) && full <= Math.max(1, compressed) * L.ratio && (method !== 0 || compressed === full), 'declared entry/ratio budget'); expanded += full; requireZIP(expanded <= L.expandedBytes, 'expanded disk capacity');
    entries.push({ name, offset, local: { nameLength: nl, end: 0 }, size: compressed, expanded: full, crc: u32(h, 16), flags, method });
    position += 46 + nl + extra + comment;
  }
  requireZIP(position === centralSize, 'central count');
  await retire(directory);
  const ranges = [...entries].sort((a, b) => a.offset - b.offset);
  requireZIP(ranges[0]?.offset === 0, 'overlap/hidden entry');
  for (const [n, e] of ranges.entries()) {
    const end = ranges[n + 1]?.offset ?? central;
    requireZIP(e.offset + 30 + e.local!.nameLength + e.size + (e.flags & 8 ? 12 : 0) <= end, 'overlap/hidden entry');
    e.local!.end = end;
  }
  if (!directoryOnly) for (const e of ranges) {
    e.data = await localDataOffset(reader, e, e.local!);
    delete e.local;
    await reader.releaseReads();
  }
  return { entries, expanded };
}
async function localDataOffset(reader: RangeReader, e: ZipEntry, { nameLength, end }: NonNullable<ZipEntry['local']>) {
  requireZIP(e.offset + 30 + nameLength <= end && end <= reader.source.size, 'local header bounds');
  const h = await reader.read(e.offset, 30);
  requireZIP(u32(h, 0) === 0x04034b50 && u16(h, 6) === e.flags && u16(h, 8) === e.method && u16(h, 26) === nameLength, 'local header');
  const extra = u16(h, 28), data = e.offset + 30 + nameLength + extra, entryEnd = data + e.size;
  requireZIP(entryEnd <= end, 'local data bounds');
  requireZIP(safeName(await reader.read(e.offset + 30, nameLength)) === e.name, 'local name');
  extras(await reader.read(e.offset + 30 + nameLength, extra));
  for (const [p, expected] of [[14, e.crc], [18, e.size], [22, e.expanded]]) requireZIP(u32(h, p!) === expected || !!(e.flags & 8) && u32(h, p!) === 0, 'local/central disagreement');
  if (e.flags & 8) {
    const descriptor = await reader.read(entryEnd, Math.min(16, end - entryEnd)), p = u32(descriptor, 0) === 0x08074b50 ? 4 : 0;
    requireZIP(u32(descriptor, p) === e.crc && u32(descriptor, p + 4) === e.size && u32(descriptor, p + 8) === e.expanded, 'descriptor');
    requireZIP(entryEnd + p + 12 === end, 'overlap/hidden entry');
  } else requireZIP(entryEnd === end, 'overlap/hidden entry');
  return data;
}
async function entry(reader: RangeReader, e: ZipEntry) {
  const dataOffset = e.local ? await localDataOffset(reader, e, e.local) : e.data;
  requireZIP(dataOffset !== undefined && e.expanded <= limit(e.name) && dataOffset >= 0 && dataOffset + e.size <= reader.source.size && (e.method === 0 || e.method === 8), 'entry bounds');
  const bytes = new Uint8Array(e.expanded), input = new Uint8Array(32768), hash = sha256.create(); let total = 0, crc = 0;
  const output = (part: Uint8Array) => {
    const end = total + part.length;
    requireZIP(end <= e.expanded && end <= limit(e.name) && end <= Math.max(1, e.size) * L.ratio, 'actual expanded budget');
    crc = crc32(part, crc); hash.update(part); bytes.set(part, total); total = end;
  };
  if (e.method === 0) {
    for (let offset = 0; offset < e.size; offset += input.length) output(await reader.read(dataOffset + offset, Math.min(input.length, e.size - offset), input));
  } else {
    // Native Streaming - Avoid per-push JavaScript inflater history copies; compressed feeds bound each native expansion burst.
    if (typeof DecompressionStream === 'undefined') throw new Error('Bounded raw DEFLATE decoding unavailable on this browser');
    const stream = new DecompressionStream('deflate-raw'), writer = stream.writable.getWriter(), decoded = stream.readable.getReader();
    const consume = (async () => {
      for (;;) { const part = await decoded.read(); if (part.done) return; try { output(part.value); } finally { await retire(part.value); } }
    })();
    void consume.catch(error => { void writer.abort(error).catch(() => undefined); });
    try {
      for (let offset = 0; offset < e.size; offset += input.length) {
        const data = await reader.read(dataOffset + offset, Math.min(input.length, e.size - offset), input);
        for (let p = 0; p < data.length; p += 256) await writer.write(data.subarray(p, p + 256));
      }
      await writer.close(); await consume;
    } catch (error) { await decoded.cancel(error).catch(() => undefined); await consume.catch(() => undefined); throw error; }
    finally { writer.releaseLock(); decoded.releaseLock(); }
  }
  requireZIP(total === e.expanded && crc === e.crc, 'size/CRC mismatch');
  const digest = hex(hash.digest()); requireZIP(!e.digest || digest === e.digest, 'entry integrity');
  reader.stats.expanded = total; reader.stats.peakEntry = total + input.length;
  return { bytes, digest };
}
host.onmessage = async event => {
  if (event.data.released !== undefined) { releases.get(event.data.released)?.(); releases.delete(event.data.released); return; }
  const reader = new RangeReader(event.data.source);
  Object.assign(globalThis, { __ANTHOLUME_SOURCE_METRICS__: reader.stats });
  try {
    const result = event.data.operation === 'hash' ? await hash(reader) : event.data.operation === 'index' || event.data.operation === 'directory' ? await index(reader, event.data.operation === 'directory') : await entry(reader, event.data.entry!);
    await reader.releaseReads();
    host.postMessage({ result, stats: reader.stats }, 'bytes' in result ? [result.bytes.buffer] : []);
  } catch (error) { host.postMessage({ error: error instanceof Error ? error.message : 'Source worker failed', stats: reader.stats }); }
  finally { reader.close(); }
};
