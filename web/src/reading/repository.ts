import Dexie, { type Table } from 'dexie';
import type { Account, BookRef, Checkpoint, ReaderCacheSummary, ReadingAccess, S, StoredBook } from './types';
import { accountKey, refKey } from './types';
import { blobSource, hashSource, sourceLimits, type Source } from './source';
import { validateEPUB } from './content-policy';
import type { BookManifest } from './book-manifest';
import { receiptFor, validSubmission, validProgressPosition, type Submission } from './wire';
import { validState } from './protocol';
import type { CapturedActivity } from './activity';
import { StagingWriter } from './staging-writer';

export type BookRow = StoredBook & { key: string; scope: string; bytes: Blob | null; sourceId?: string; checksum: string | null; protocolHash: string | null; size: number; etag?: string };
export type SourceRow = { id: string; key: string; size: number; received: number; blob: Blob | null; complete: boolean; until: number; manifest?: BookManifest; manifestHash?: string; cacheUsedAt?: number; cacheReaders?: Record<string, number>; evictOnRelease?: boolean };
const bookCacheBytes = 768 * 1024 * 1024;
const bookCacheCount = 6;
const cacheLeaseMs = 15 * 60_000;
const resumeKey = 'resume:account';
const cacheLive = (row: SourceRow, now: number) => Object.values(row.cacheReaders ?? {}).some(until => until > now);
export type SourceChunk = { key: string; sourceId: string; data: ArrayBuffer };
export type EventRow = { id: string; key: string; scope: string; created: number; interval?: { id: string; startMs: number; endMs: number } } & Submission;
type AccessRow = { key: string; account: Account; epoch: number; eligible: boolean; authenticated: boolean };
export type ReplayAccess = { scope: string; epoch: number };
type Head = { key: string; state: S['ReadingState'] };
type ProgressDraft = { key: string; observedAt: string; position: string; fraction: number };
type Meta = { key: string; value: unknown };
export class ReadingDB extends Dexie {
  sources!: Table<SourceRow, string>; sourceChunks!: Table<SourceChunk, string>;
  books!: Table<BookRow, string>; events!: Table<EventRow, string>; access!: Table<AccessRow, string>;
  progressDrafts!: Table<ProgressDraft, string>;
  heads!: Table<Head, string>; meta!: Table<Meta, string>;
  constructor(name = 'antholume-reading-v1') {
    super(name);
    this.version(1).stores({ books: '&key,scope', events: '&id,scope,key,created', access: '&key', leases: '&scope', decisions: '&id', conflicts: '&eventId,scope,key', heads: '&key', meta: '&key', history: '&id,eventId' });
    this.version(2).stores({ sources: '&id,key,complete,until', sourceChunks: '&key,sourceId' });
    this.version(3).stores({ progressDrafts: '&key' });
    this.version(4).stores({ leases: null }).upgrade(async tx => {
      const completed = await tx.table('decisions').toCollection().primaryKeys();
      await tx.table('events').bulkDelete(completed);
    });
    this.version(5).stores({ decisions: null, conflicts: null, history: null });
  }
}
export async function checksum(input: ArrayBuffer | Blob | Source): Promise<string> { return (await hashSource(input instanceof Blob ? blobSource(input) : input instanceof ArrayBuffer ? blobSource(new Blob([input])) : input)).sha256; }
export const scopeOf = (ref: BookRef) => ref.kind === 'local' ? 'local' : accountKey(ref.account);
export class Repository {
  readonly stagingStats = { maxIncoming: 0, bytes: 0, chunks: 0, buffer: sourceLimits.chunkBytes };
  constructor(readonly db = new ReadingDB()) {}
  private tables() { return [this.db.books, this.db.events, this.db.access, this.db.heads, this.db.progressDrafts]; }
  async setAccess(access: ReadingAccess) {
    if (access.kind !== 'authenticated' && access.kind !== 'logout') return;
    const key = accountKey(access.account), authenticated = access.kind === 'authenticated';
    await this.db.transaction('rw', this.db.access, this.db.meta, async () => {
      for (const row of await this.db.access.toArray()) {
        if (row.key !== key && (row.eligible || row.authenticated)) {
          await this.db.access.put({ ...row, epoch: row.epoch + 1, eligible: false, authenticated: false });
        }
      }
      const old = await this.db.access.get(key);
      if (!old || old.eligible !== authenticated || old.authenticated !== authenticated) {
        await this.db.access.put({ key, account: access.account, epoch: (old?.epoch ?? 0) + 1, eligible: authenticated, authenticated });
      }
      await this.db.meta.put({ key: resumeKey, value: authenticated ? access.account : null });
    });
  }
  async resume(): Promise<Account | null> {
    const account = (await this.db.meta.get(resumeKey))?.value as Account | null;
    return account && (await this.db.access.get(accountKey(account)))?.eligible ? account : null;
  }
  async permitted(ref: BookRef) { return ref.kind === 'local' || !!(await this.db.access.get(scopeOf(ref)))?.eligible; }
  async projection(access: ReadingAccess) {
    const scope = 'account' in access && access.kind !== 'logout' ? accountKey(access.account) : null;
    const eligible = scope && (await this.db.access.get(scope))?.eligible;
    return (await this.db.books.toArray()).filter(b => b.scope === 'local' || b.scope === scope && eligible);
  }
  async device(account: Account): Promise<S['Device']> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const key = `device:${accountKey(account)}`, row = await this.db.meta.get(key);
      if (row) return row.value as S['Device'];
      const device = { id: crypto.randomUUID(), name: 'AnthoLume browser' };
      await this.db.meta.add({ key, value: device }); return device;
    });
  }
  async cleanupStages() {
    for (const id of await this.db.sources.where('until').between(1, Date.now(), true, false).primaryKeys()) await this.discardSource(id, true);
    await this.db.transaction('rw', this.db.sources, this.db.sourceChunks, async () => {
      const now = Date.now();
      for (const row of await this.db.sources.filter(row => !!row.evictOnRelease && !cacheLive(row, now)).toArray()) await this.removeSource(row.id);
    });
  }
  async discardSource(id: string, expiredOnly = false) {
    await this.db.transaction('rw', this.db.sources, this.db.sourceChunks, async () => { const row = await this.db.sources.get(id); if (row?.complete || expiredOnly && row && row.until >= Date.now()) return; await this.db.sourceChunks.where('sourceId').equals(id).delete(); await this.db.sources.delete(id); });
  }
  private descriptor(row: SourceRow): Source { return row.blob ? blobSource(row.blob) : { kind: 'idb', database: this.db.name, id: row.id, size: row.size }; }
  async stageBlob(ref: BookRef, blob: Blob, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!blob.size || blob.size > sourceLimits.diskBytes) throw new Error('Original source exceeds 512 MiB disk capacity');
    await this.cleanupStages();
    const row: SourceRow = { id: crypto.randomUUID(), key: refKey(ref), size: blob.size, received: blob.size, blob, complete: false, until: Date.now() + 120000 };
    try {
      await this.db.transaction('rw', this.db.sources, async () => {
        const tx = Dexie.currentTransaction!, abort = () => tx.abort(); signal?.addEventListener('abort', abort, { once: true });
        try { signal?.throwIfAborted(); await this.db.sources.add(row); row.until = Date.now() + 120000; await this.db.sources.update(row.id, { until: row.until }); signal?.throwIfAborted(); }
        finally { signal?.removeEventListener('abort', abort); }
      });
      return row;
    } catch (error) { signal?.throwIfAborted(); throw error; }
  }
  async stageStream(ref: BookRef, stream: ReadableStream<Uint8Array>, signal?: AbortSignal, progress?: (received: number) => void): Promise<SourceRow> {
    signal?.throwIfAborted(); await this.cleanupStages(); const row: SourceRow = { id: crypto.randomUUID(), key: refKey(ref), size: 0, received: 0, blob: null, complete: false, until: Date.now() + 120000 };
    let byob: ReadableStreamBYOBReader | undefined;
    if (globalThis.isSecureContext) {
      try { byob = stream.getReader({ mode: 'byob' }); } catch { /* Use the bounded default reader. */ }
    }
    const fallback = byob ? undefined : stream.getReader(), reader = byob ?? fallback!;
    let writer: StagingWriter | undefined, n = 0, incoming = 0;
    const createWriter = () => new StagingWriter(this.db.name, row.id, row.received, n, key => this.db.sourceChunks.add({ key, sourceId: row.id, data: new ArrayBuffer(0) }), signal);
    const read = () => byob ? byob.read(new Uint8Array(Math.min(65536, writer!.remaining))) : fallback!.read();
    const abort = () => { void reader.cancel(signal?.reason); }; signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted(); await this.db.sources.add(row); signal?.throwIfAborted();
      writer = createWriter(); await writer.ready;
      for (;;) {
        signal?.throwIfAborted(); let timer: ReturnType<typeof setTimeout> | undefined;
        const part = await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => { abort(); reject(new Error('Original download idle deadline exceeded')); }, 30000); })]).finally(() => clearTimeout(timer));
        if (part.done) break;
        const bytes = part.value as Uint8Array<ArrayBuffer>;
        if (!bytes.length) continue;
        this.stagingStats.maxIncoming = Math.max(this.stagingStats.maxIncoming, bytes.length); this.stagingStats.bytes += bytes.length; this.stagingStats.chunks++; incoming += bytes.length;
        if (incoming > sourceLimits.diskBytes) throw new Error('Original download exceeds 512 MiB disk capacity');
        for (let offset = 0; offset < bytes.length;) {
          signal?.throwIfAborted();
          const amount = Math.min(bytes.length - offset, writer.remaining, sourceLimits.chunkBytes);
          // Default Reader Chunking - WebKit can coalesce fetch chunks; only transfer bounded slices to staging.
          const transfer = offset === 0 && amount === bytes.length && bytes.buffer.byteLength <= sourceLimits.chunkBytes ? bytes : bytes.slice(offset, offset + amount);
          const last = transfer === bytes || offset + amount === bytes.length;
          const result = await writer.write(transfer); row.received = result.received!; row.size = row.received; n = result.chunkNumber!; progress?.(row.received);
          if (writer.remaining === 0) { writer.dispose(); writer = createWriter(); await writer.ready; }
          if (last) break;
          offset += amount;
        }
      }
      signal?.throwIfAborted(); const final = await writer.write(new Uint8Array(0), true); row.received = final.received!; row.size = row.received; if (!row.size) throw new Error('Empty original download'); return row;
    } catch (error) { writer?.dispose(); await this.discardSource(row.id); signal?.throwIfAborted(); throw error; }
    finally { writer?.dispose(); signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async validateStage(stage: SourceRow, signal?: AbortSignal, lazy = false, onStage?: (message: string) => void) {
    const heartbeat = setInterval(() => { void this.db.sources.update(stage.id, { until: Date.now() + 120000 }).catch(() => undefined); }, 30000);
    try { return await validateEPUB(this.descriptor(stage), signal, lazy, onStage); } finally { clearInterval(heartbeat); }
  }
  private async removeSource(id: string) {
    await this.db.sourceChunks.where('sourceId').equals(id).delete();
    await this.db.sources.delete(id);
  }
  private async trimServerCache(reserve: number, keepKey?: string, clear = false) {
    const books = await this.db.books.filter(book => book.ref.kind === 'server' && book.availability === 'available').toArray();
    const bySource = new Map(books.map(book => [book.sourceId, book]));
    const sources = await this.db.sources.filter(source => source.complete && !source.evictOnRelease && source.key.startsWith('["server",')).toArray();
    const candidates = [...sources.map(source => ({ source, book: bySource.get(source.id), bytes: source.size, used: source.cacheUsedAt ?? 0 })),
      ...books.filter(book => !book.sourceId || !sources.some(source => source.id === book.sourceId)).map(book => ({ source: undefined, book, bytes: book.size, used: 0 }))].sort((a, b) => a.used - b.used);
    let bytes = candidates.reduce((sum, entry) => sum + entry.bytes, reserve), count = candidates.length + (reserve > 0 ? 1 : 0);
    const now = Date.now();
    for (const { source, book, bytes: size } of candidates) {
      if (!clear && bytes <= bookCacheBytes && count <= bookCacheCount) break;
      if (book?.key === keepKey || source && cacheLive(source, now)) continue;
      if (source) await this.removeSource(source.id);
      if (book) await this.db.books.update(book.key, { sourceId: undefined, bytes: null, cover: null, availability: 'unavailable', etag: undefined });
      bytes -= size; count--;
    }
    if (!clear && (bytes > bookCacheBytes || count > bookCacheCount)) throw new Error('Close another open book before caching this EPUB');
  }
  async freeServerCache() {
    await this.db.transaction('rw', this.db.books, this.db.sources, this.db.sourceChunks, () => this.trimServerCache(0, undefined, true));
  }
  async readerCacheSummary(): Promise<ReaderCacheSummary> {
    return this.db.transaction('r', this.db.books, this.db.sources, async () => {
      const books = await this.db.books.filter(book => book.ref.kind === 'server' && book.availability === 'available').toArray();
      const sources = await this.db.sources.filter(row => row.key.startsWith('["server",')).toArray();
      const byId = new Map(sources.map(source => [source.id, source]));
      const current = new Set<string>();
      const summary = { books: 0, epubBytes: 0, metadataBytes: 0 };
      for (const book of books) {
        const source = book.sourceId && byId.get(book.sourceId);
        if (source && source.complete && !source.evictOnRelease) {
          summary.books++;
          if (!current.has(source.id)) {
            current.add(source.id);
            summary.epubBytes += source.size;
            if (source.manifest) summary.metadataBytes += new Blob([JSON.stringify(source.manifest)]).size;
          }
        } else if (book.bytes) {
          summary.books++;
          summary.epubBytes += book.bytes.size;
        } else continue;
        summary.metadataBytes += book.cover?.size ?? 0;
      }
      return summary;
    });
  }
  async clearServerCache() {
    await this.db.transaction('rw', this.db.books, this.db.sources, this.db.sourceChunks, async () => {
      const now = Date.now();
      const books = await this.db.books.filter(book => book.ref.kind === 'server' && book.availability === 'available').toArray();
      for (const book of books) await this.db.books.update(book.key, { sourceId: undefined, bytes: null, cover: null, availability: 'unavailable', etag: undefined });
      const sources = await this.db.sources.filter(source => source.key.startsWith('["server",') && (source.complete || source.until <= now)).toArray();
      for (const source of sources) {
        if (cacheLive(source, now)) await this.db.sources.update(source.id, { evictOnRelease: true });
        else await this.removeSource(source.id);
      }
    });
  }
  private async refreshCheckpoint(ref: BookRef, previous: Checkpoint, state?: S['ReadingState']) {
    if (!state) return { checkpoint: previous };
    if (!validState(state, ref.kind === 'server' ? ref.documentId : '')) throw new Error('Invalid server state');
    const key = refKey(ref), head = await this.db.heads.get(key);
    if (await this.hasPendingProgress(key)) return { checkpoint: previous };
    if (head && BigInt(head.state.revision) > BigInt(state.revision)) return { checkpoint: previous };
    await this.db.heads.put({ key, state });
    return { checkpoint: { position: state.position, fraction: state.fraction }, ...(state.updated_at ? { lastReadAt: state.updated_at } : {}) };
  }
  async useCached(ref: Extract<BookRef, { kind: 'server' }>, sourceId: string, etag: string, state: S['ReadingState'], signal: AbortSignal) {
    const opened = await this.open(ref);
    if (opened.row.sourceId !== sourceId || opened.row.etag !== etag) throw new Error('Cached original changed');
    return this.db.transaction('rw', [this.db.books, this.db.sources, this.db.heads, this.db.events, this.db.access], async () => {
      signal.throwIfAborted();
      const key = refKey(ref), row = await this.db.books.get(key);
      if (!row || row.sourceId !== sourceId || row.etag !== etag || !(await this.db.access.get(row.scope))?.authenticated) throw new Error('Cached original or account changed');
      await this.db.sources.update(sourceId, { cacheUsedAt: Date.now() });
      const next = { ...row, ...await this.refreshCheckpoint(ref, row.checkpoint, state) };
      await this.db.books.put(next);
      signal.throwIfAborted();
      return { ...opened, row: next };
    });
  }
  async keepSource(id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const reader = crypto.randomUUID();
    const update = (release = false) => this.db.transaction('rw', this.db.sources, this.db.sourceChunks, async () => {
      const row = await this.db.sources.get(id);
      if (!row?.complete) { if (release) return; throw new Error('Cached original was evicted; reopen to download again'); }
      if (row.evictOnRelease && !release && !row.cacheReaders?.[reader]) throw new Error('Cached original was cleared; reopen to download again');
      const now = Date.now(), readers = Object.fromEntries(Object.entries(row.cacheReaders ?? {}).filter(([key, until]) => key !== reader && until > now));
      if (!release) {
        if (Object.keys(readers).length >= 32) throw new Error('Too many readers for this EPUB');
        readers[reader] = now + cacheLeaseMs;
      }
      if (row.evictOnRelease && release && !Object.keys(readers).length) await this.removeSource(id);
      else await this.db.sources.update(id, { cacheReaders: readers });
    });
    await update();
    const renew = () => { if (!signal.aborted) void update().catch(() => undefined); };
    const timer = setInterval(renew, 60_000);
    const release = () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', renew);
      signal.removeEventListener('abort', release);
      void update(true).catch(() => undefined);
    };
    signal.addEventListener('abort', release, { once: true });
    document.addEventListener('visibilitychange', renew);
    if (signal.aborted) release();
    signal.throwIfAborted();
  }
  async publish(ref: BookRef, stage: SourceRow, manifest: BookManifest, title: string | null, author: string | null, cover: Blob | null, state?: S['ReadingState'], signal?: AbortSignal, cache?: { etag?: string }) {
    signal?.throwIfAborted(); const key = refKey(ref), scope = scopeOf(ref);
    if (!await this.permitted(ref)) throw new Error('Account no longer accessible');
    const metadata = new Blob([JSON.stringify(manifest)]); if (metadata.size > 16 * 1024 * 1024) throw new Error('Validated index metadata exceeds 16 MiB');
    const integrity = manifest.integrity;
    if (!integrity && (!manifest.lazy || !cache || ref.kind !== 'server')) throw new Error('Original fingerprint required');
    const manifestHash = await checksum(metadata), previous = await this.db.books.get(key);
    let reuse = false;
    if (!cache && integrity && previous?.availability === 'available' && previous.sourceId && previous.checksum === integrity.sha256) {
      const source = await this.db.sources.get(previous.sourceId);
      if (source?.complete) {
        try { reuse = (await hashSource({ ...this.descriptor(source), digests: integrity.digests }, signal)).sha256 === integrity.sha256; } catch { signal?.throwIfAborted(); }
      }
    }
    signal?.throwIfAborted();
    await this.db.transaction('rw', [this.db.books, this.db.heads, this.db.access, this.db.sources, this.db.sourceChunks, this.db.events], async () => {
      if (!await this.permitted(ref) || cache && !(await this.db.access.get(scope))?.authenticated) throw new Error('Account no longer accessible');
      const row = await this.db.sources.get(stage.id); if (!row || row.complete || row.size !== stage.size || row.received !== stage.size) throw new Error('Incomplete staged original');
      const old = await this.db.books.get(key);
      if (!cache && old?.availability === 'available' && old.checksum !== integrity?.sha256) throw new Error('Original server bytes changed; remove old download before replacing');
      const checkpoint = old?.checkpoint || { position: state?.position ?? null, fraction: state?.fraction ?? null };
      if (old?.sourceId !== previous?.sourceId) throw new Error('Stored source changed during publication; retry');
      const existingSource = reuse ? old?.sourceId : undefined;
      if (existingSource) await this.db.sources.update(existingSource, { manifest, manifestHash });
      else {
        if (old?.sourceId) {
          const existing = await this.db.sources.get(old.sourceId);
          if (!existing || !cacheLive(existing, Date.now())) await this.removeSource(old.sourceId);
        }
        await this.db.sources.put({ ...row, complete: true, manifest, manifestHash, until: 0, ...(cache ? { cacheUsedAt: Date.now() } : {}) });
      }
      const reading = cache ? await this.refreshCheckpoint(ref, checkpoint, state) : { checkpoint };
      await this.db.books.put({ key, scope, ref, title, author, cover, addedAt: old?.addedAt ?? new Date().toISOString(), lastReadAt: old?.lastReadAt ?? state?.updated_at ?? undefined, ...reading, availability: 'available', bytes: null, sourceId: existingSource || stage.id, size: stage.size, checksum: integrity?.sha256 ?? null, protocolHash: integrity?.protocolHash ?? null, etag: cache?.etag });
      if (cache) await this.trimServerCache(0, key);
      else if (state) { if (!validState(state, ref.kind === 'server' ? ref.documentId : '')) throw new Error('Invalid server state'); const head = await this.db.heads.get(key); if (!head || BigInt(head.state.revision) < BigInt(state.revision)) await this.db.heads.put({ key, state }); }
      signal?.throwIfAborted();
    });
  }
  async install(ref: BookRef, input: Blob | ArrayBuffer, title: string | null, author: string | null, cover: Blob | null, state?: S['ReadingState'], signal?: AbortSignal) {
    const stage = await this.stageBlob(ref, input instanceof Blob ? input : new Blob([input]), signal);
    try { const policy = await this.validateStage(stage, signal); await this.publish(ref, stage, policy.manifest, title, author, cover, state, signal); policy.dispose(); }
    finally { await this.discardSource(stage.id); }
  }
  async open(ref: BookRef): Promise<{ row: BookRow; source: Source; manifest: BookManifest }> {
    if (!await this.permitted(ref)) throw new Error('Account hidden');
    const row = await this.db.books.get(refKey(ref));
    if (!row || row.availability !== 'available') throw new Error('Book unavailable; download or re-import required');
    if (!row.sourceId && row.bytes) { await this.install(ref, row.bytes, row.title, row.author, row.cover); return this.open(ref); }
    const stored = row.sourceId && await this.db.sources.get(row.sourceId);
    if (!stored || !stored.complete || !stored.manifest || stored.size !== row.size) throw new Error('Original source/index unavailable');
    const { integrity } = stored.manifest;
    const identityMatches = integrity ? integrity.sha256 === row.checksum && integrity.protocolHash === row.protocolHash
      : integrity === null && stored.manifest.lazy && ref.kind === 'server' && row.checksum === null && row.protocolHash === null;
    if (!identityMatches) throw new Error('Original source/index unavailable');
    const metadata = new Blob([JSON.stringify(stored.manifest)]);
    if (metadata.size > 16 * 1024 * 1024 || !stored.manifestHash) throw new Error('Validated index integrity unavailable; re-import or download required');
    const manifestHash = await checksum(metadata);
    if (stored.manifestHash !== manifestHash) throw new Error('Validated index integrity mismatch');
    return { row, source: { ...this.descriptor(stored), digests: integrity?.digests }, manifest: stored.manifest };
  }
  async exportLocal(ref: Extract<BookRef, { kind: 'local' }>): Promise<Blob> {
    const book = await this.db.books.get(refKey(ref));
    if (!book || book.ref.kind !== 'local') throw new Error('Local book not found');
    if (book.bytes?.size) return book.bytes;
    const source = book.sourceId && await this.db.sources.get(book.sourceId);
    if (!source || !source.complete || source.key !== book.key || !source.blob || source.blob.size !== book.size) throw new Error('Original local EPUB is unavailable');
    return source.blob;
  }
  private async addEvent(key: string, scope: string, event: Submission) {
    if (!validSubmission(event)) throw new Error('Invalid immutable reading event');
    await this.db.events.add({ ...event, id: event.payload.event_id, key, scope, created: Date.now() });
  }
  private async hasPendingProgress(key: string) {
    return !!await this.db.events.where('key').equals(key).filter(event => event.kind === 'progress').first();
  }
  private async enqueueProgress(draft: ProgressDraft, scope: string, document: string, device: string, revision: string) {
    await this.addEvent(draft.key, scope, { kind: 'progress', payload: { event_id: crypto.randomUUID(), document_id: document, device_id: device, observed_at: draft.observedAt, base_revision: revision, position: draft.position, fraction: draft.fraction } });
  }
  async save(ref: BookRef, checkpoint: Checkpoint, activity?: S['ActivityEvent']) {
    const device = ref.kind === 'server' ? await this.device(ref.account) : null;
    await this.db.transaction('rw', [this.db.books, this.db.events, this.db.heads, this.db.access, this.db.progressDrafts], async () => {
      if (!await this.permitted(ref)) throw new Error('Account hidden');
      const key = refKey(ref), book = await this.db.books.get(key);
      if (!book || ref.kind === 'local' && book.availability !== 'available') throw new Error('Book unavailable');
      await this.db.books.put({ ...book, checkpoint, lastReadAt: new Date().toISOString() });
      if (ref.kind === 'local') { if (activity) throw new Error('Local activity must never upload'); return; }
      const state = (await this.db.heads.get(key))?.state;
      if (!state || checkpoint.position === null || checkpoint.fraction === null || !validProgressPosition(checkpoint.position, checkpoint.fraction)) throw new Error('A known server revision and recoverable position are required');
      const scope = scopeOf(ref), draft = { key, observedAt: new Date().toISOString(), position: checkpoint.position, fraction: checkpoint.fraction };
      if (await this.hasPendingProgress(key)) {
        await this.db.progressDrafts.put(draft);
      } else {
        await this.enqueueProgress(draft, scope, ref.documentId, device!.id, state.revision);
      }
      if (activity) await this.addEvent(key, scope, { kind: 'activity', payload: activity });
    });
  }
  async credit(ref: BookRef, payload: S['ActivityEvent'], measured?: CapturedActivity) {
    if (ref.kind !== 'server' || payload.document_id !== ref.documentId || !validSubmission({ kind: 'activity', payload })) throw new Error('Invalid server activity');
    await this.db.transaction('rw', this.db.events, this.db.access, async () => {
      if (!await this.permitted(ref)) throw new Error('Account hidden');
      const interval = measured ? { id: measured.intervalId, startMs: measured.startMs, endMs: measured.endMs } : undefined;
      if (interval && (payload.event_id !== interval.id || !Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs) || interval.endMs <= interval.startMs)) throw new Error('Invalid activity interval');
      const previous = await this.db.events.get(payload.event_id);
      if (previous) {
        if (previous.kind !== 'activity' || previous.scope !== scopeOf(ref) || previous.key !== refKey(ref) || JSON.stringify(previous.payload) !== JSON.stringify(payload) || JSON.stringify(previous.interval) !== JSON.stringify(interval)) throw new Error('Activity interval identity collision');
        return;
      }
      await this.db.events.add({ id: payload.event_id, key: refKey(ref), scope: scopeOf(ref), created: Date.now(), kind: 'activity', payload, ...(interval ? { interval } : {}) });
    });
  }
  pending(scope?: string) { return scope ? this.db.events.where('scope').equals(scope).sortBy('created') : this.db.events.orderBy('created').toArray(); }
  async replayCurrent(access: ReplayAccess) {
    const row = await this.db.access.get(access.scope);
    return !!(row?.authenticated && row.eligible && row.epoch === access.epoch);
  }
  async replayBatch(account: Account): Promise<{ access: ReplayAccess; ids: string[] } | null> {
    const scope = accountKey(account);
    return this.db.transaction('r', this.db.access, this.db.events, async () => {
      const row = await this.db.access.get(scope);
      if (!row?.authenticated || !row.eligible) return null;
      const pending = await this.pending(scope);
      const ids = [...pending.filter(e => e.kind === 'activity'), ...pending.filter(e => e.kind === 'progress')].slice(0, 32).map(e => e.id);
      return ids.length ? { access: { scope, epoch: row.epoch }, ids } : null;
    });
  }
  async expire(access: ReplayAccess, eventId?: string) {
    return this.db.transaction('rw', this.db.access, this.db.events, async () => {
      if (!await this.replayCurrent(access)) return false;
      if (eventId && !await this.db.events.get(eventId)) return false;
      const row = (await this.db.access.get(access.scope))!;
      await this.db.access.put({ ...row, epoch: row.epoch + 1, authenticated: false });
      return true;
    });
  }
  async acknowledge(access: ReplayAccess, event: EventRow, receipt: unknown) {
    await this.db.transaction('rw', this.tables(), async () => {
      if (!await this.replayCurrent(access) || event.scope !== access.scope || !receiptFor(receipt, event)) throw new Error('Stale or invalid acknowledgement');
      const stored = await this.db.events.get(event.id);
      if (!stored) return;
      if (JSON.stringify(stored) !== JSON.stringify(event)) throw new Error('Event changed');
      await this.db.events.delete(event.id);
      if (event.kind === 'progress') {
        const old = (await this.db.heads.get(event.key))?.state;
        if (!old || BigInt(receipt.revision!) > BigInt(old.revision)) await this.db.heads.put({ key: event.key, state: { document_id: event.payload.document_id, revision: receipt.revision!, position: event.payload.position, fraction: event.payload.fraction, device_id: event.payload.device_id, updated_at: event.payload.observed_at } });
        const draft = await this.db.progressDrafts.get(event.key);
        if (draft && !await this.hasPendingProgress(event.key)) {
          await this.enqueueProgress(draft, event.scope, event.payload.document_id, event.payload.device_id, receipt.revision!);
          await this.db.progressDrafts.delete(event.key);
        }
      }
    });
  }
  async acceptServer(access: ReplayAccess, event: EventRow, state: S['ReadingState']) {
    return this.db.transaction('rw', this.tables(), async () => {
      if (!await this.replayCurrent(access) || event.scope !== access.scope) throw new Error('Account access changed');
      if (!await this.db.events.get(event.id)) return false;
      const head = (await this.db.heads.get(event.key))?.state;
      if (head && BigInt(head.revision) > BigInt(state.revision)) state = head;
      await this.db.events.where('key').equals(event.key).filter(row => row.kind === 'progress').delete();
      await this.db.progressDrafts.delete(event.key);
      await this.db.heads.put({ key: event.key, state });
      await this.db.books.update(event.key, { checkpoint: { position: state.position, fraction: state.fraction } });
      return true;
    });
  }
}
