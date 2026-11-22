import Dexie, { type Table } from 'dexie';
import type { Account, BookRef, Checkpoint, ReaderCacheSummary, ReviewDecision, OfflineChoice, OfflineRecord, ReadingAccess, S, StoredBook } from './types';
import { accountKey, refKey } from './types';
import { blobSource, hashSource, sourceLimits, type Source } from './source';
import { validateEPUB } from './content-policy';
import type { BookManifest } from './book-manifest';
import { receiptFor, validSubmission, validProgressPosition, type Submission } from './wire';
import { validState } from './protocol';
import { StagingWriter } from './staging-writer';
import { validCover } from './cover';

export type ResumeCandidate = Checkpoint & { eventId: string; savedAt: string };
export type BookRow = StoredBook & { resumeCandidate?: ResumeCandidate; key: string; scope: string; bytes: Blob | null; sourceId?: string; checksum: string | null; protocolHash: string | null; size: number; etag?: string };
export type SourceRow = { id: string; key: string; size: number; received: number; blob: Blob | null; complete: boolean; until: number; manifest?: BookManifest; manifestHash?: string; cacheUsedAt?: number; cacheReaders?: Record<string, number>; evictOnRelease?: boolean };
const bookCacheBytes = 768 * 1024 * 1024;
const bookCacheCount = 6;
const cacheLeaseMs = 15 * 60_000;
const resumeKey = 'resume:account';
const cacheLive = (row: SourceRow, now: number) => Object.values(row.cacheReaders ?? {}).some(until => until > now);
export type SourceChunk = { key: string; sourceId: string; data: ArrayBuffer };
export type EventRow = { offlineTitle?: string; id: string; key: string; scope: string; created: number; rejected?: { status: number; code: string } } & Submission;
type AccessRow = { key: string; account: Account; epoch: number; eligible: boolean; authenticated: boolean };
export type ReplayAccess = { scope: string; epoch: number };
type Head = { key: string; state: S['ReadingState']; eventId?: string };
type ProgressDraft = { key: string; id?: string; observedAt: string; position: string; fraction: number };
type Meta = { key: string; value: unknown };
export class ReadingDB extends Dexie {
  sources!: Table<SourceRow, string>; sourceChunks!: Table<SourceChunk, string>;
  books!: Table<BookRow, string>; events!: Table<EventRow, string>; access!: Table<AccessRow, string>;
  offline!: Table<OfflineRecord, string>;
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
    this.version(6).stores({ offline: '&id,scope,[scope+document+kind]' }).upgrade(async tx => {
      // Legacy Outbox - The previous cache did not distinguish online retries from offline writes. Hold uncertain events for review rather than silently uploading them.
      const events: EventRow[] = await tx.table('events').orderBy('created').toArray();
      for (const event of events) {
        if (event.rejected) continue;
        const book = await tx.table('books').get(event.key);
        const document = event.payload.document_id, scope = event.scope, title = book?.title ?? document;
        if (event.kind === 'activity') {
          await tx.table('offline').put({ id: event.id, kind: 'activity', document, scope, title, created: event.payload.start_time, event: event.payload });
        } else {
          const draft: ProgressDraft | undefined = await tx.table('progressDrafts').get(event.key);
          const { position, fraction } = draft ?? event.payload;
          await tx.table('offline').where('[scope+document+kind]').equals([scope,document,'progress']).delete();
          await tx.table('offline').put({ id: crypto.randomUUID(), kind: 'progress', document, scope, title, created: draft?.observedAt ?? event.payload.observed_at, checkpoint: { position, fraction } });
          await tx.table('progressDrafts').delete(event.key);
        }
        await tx.table('events').delete(event.id);
      }
    });
  }
}
export async function checksum(input: ArrayBuffer | Blob | Source): Promise<string> { return (await hashSource(input instanceof Blob ? blobSource(input) : input instanceof ArrayBuffer ? blobSource(new Blob([input])) : input)).sha256; }
export const scopeOf = (ref: BookRef) => ref.kind === 'local' ? 'local' : accountKey(ref.account);
type ServerRef = Extract<BookRef, { kind: 'server' }>;
type Capture = { access: ReplayAccess; ref: ServerRef; ids: string[]; revision?: string; predecessor?: string };
type DeviceCopy = BookRow & { ref: ServerRef; sourceId: string };
function isDeviceCopy(book: BookRow, account: Account): book is DeviceCopy {
  return book.ref.kind === 'server' && book.ref.account.origin === account.origin &&
    book.ref.account.readingGeneration === account.readingGeneration && book.availability === 'available' && !!book.sourceId;
}
export class Repository {
  private readonly verifying = new Set<string>();
  awaitingReview(row: OfflineRecord) { return !this.verifying.has(row.id); }
  readonly stagingStats = { maxIncoming: 0, bytes: 0, chunks: 0, buffer: sourceLimits.chunkBytes };
  constructor(readonly db = new ReadingDB()) {}
  private tables() { return [this.db.books, this.db.events, this.db.access, this.db.heads, this.db.progressDrafts, this.db.offline]; }
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
    const rows = await this.db.books.toArray();
    const account = access.kind === 'offline' || access.kind === 'authenticated' ? access.account : null;
    const copies = account ? rows.filter(row => isDeviceCopy(row, account)) : [];
    const deviceCopies = account ? new Map<string, 'saved' | 'cached'>() : undefined;
    for (const { ref, pinned } of copies) {
      if (pinned || !deviceCopies?.has(ref.documentId)) deviceCopies?.set(ref.documentId, pinned ? 'saved' : 'cached');
    }
    if (access.kind === 'offline') return { deviceCopies, books: await this.offlineShelf(access.account, rows, copies) };
    const scope = 'account' in access && access.kind !== 'logout' ? accountKey(access.account) : null;
    const eligible = scope && (await this.db.access.get(scope))?.eligible;
    return { deviceCopies, books: rows.filter(b => b.scope === 'local' || b.scope === scope && eligible) };
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
      ...books.filter(book => !book.sourceId || !sources.some(source => source.id === book.sourceId)).map(book => ({ source: undefined, book, bytes: book.size, used: 0 }))].filter(entry => !entry.book?.pinned).sort((a, b) => a.used - b.used);
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
  private copiesFor(ref: ServerRef) {
    return this.db.books.filter(row => isDeviceCopy(row, ref.account) && row.ref.documentId === ref.documentId).toArray();
  }
  async cacheCover(ref: ServerRef, cover: Blob, signal: AbortSignal, expectedSource?: string) {
    if (!validCover(cover)) return;
    await this.db.transaction('rw', [this.db.books, this.db.sources, this.db.access], async () => {
      const tx = Dexie.currentTransaction!, abort = () => tx.abort();
      signal.addEventListener('abort', abort, { once: true });
      try {
        signal.throwIfAborted();
        const row = await this.db.books.get(refKey(ref));
        if (!row || row.cover || row.availability !== 'available' || !row.sourceId || (expectedSource && row.sourceId !== expectedSource)) return;
        if (!(await this.db.access.get(scopeOf(ref)))?.authenticated || !(await this.db.sources.get(row.sourceId))?.complete) return;
        signal.throwIfAborted();
        await this.db.books.update(row.key, { cover });
        signal.throwIfAborted();
      } finally { signal.removeEventListener('abort', abort); }
    });
  }
  async retainCachedCopy(ref: ServerRef, signal: AbortSignal) {
    await this.db.transaction('rw', this.db.books, this.db.sources, async () => {
      signal.throwIfAborted();
      const copies = await this.copiesFor(ref);
      const book = copies.find(b => b.key === refKey(ref)) ?? copies[0];
      if (!book?.sourceId || !(await this.db.sources.get(book.sourceId))?.complete) throw new Error('Book is not downloaded');
      await this.db.books.update(book.key, { pinned: true });
      signal.throwIfAborted();
    });
  }
  async removeFromDevice(ref: ServerRef, signal: AbortSignal, access: 'authenticated' | 'offline') {
    await this.db.transaction('rw', [this.db.books, this.db.access, this.db.sources, this.db.sourceChunks], async () => {
      signal.throwIfAborted();
      if (access === 'authenticated' && !await this.permitted(ref)) throw new Error('Account changed');
      for (const book of await this.copiesFor(ref)) {
        await this.db.books.update(book.key, { pinned: false, sourceId: undefined, bytes: null, cover: null, availability: 'unavailable', etag: undefined });
        for (const source of await this.db.sources.where('key').equals(book.key).filter(s => s.complete).toArray()) {
          if (cacheLive(source, Date.now())) await this.db.sources.update(source.id, { evictOnRelease: true });
          else await this.removeSource(source.id);
        }
      }
      signal.throwIfAborted();
    });
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
      for (const book of books) await this.db.books.update(book.key, { pinned: false, sourceId: undefined, bytes: null, cover: null, availability: 'unavailable', etag: undefined });
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
    await this.db.heads.put({ key, state, ...(head?.state.revision === state.revision && head.eventId && { eventId: head.eventId }) });
    return { checkpoint: { position: state.position, fraction: state.fraction }, ...(state.updated_at ? { lastReadAt: state.updated_at } : {}) };
  }
  async useCached(ref: Extract<BookRef, { kind: 'server' }>, sourceId: string, etag: string, state: S['ReadingState'], signal: AbortSignal, pin?: Pick<StoredBook, 'title' | 'author'>) {
    const opened = await this.open(ref);
    if (opened.row.sourceId !== sourceId || opened.row.etag !== etag) throw new Error('Cached original changed');
    return this.db.transaction('rw', [this.db.books, this.db.sources, this.db.heads, this.db.events, this.db.access], async () => {
      signal.throwIfAborted();
      const key = refKey(ref), row = await this.db.books.get(key);
      if (!row || row.sourceId !== sourceId || row.etag !== etag || !(await this.db.access.get(row.scope))?.authenticated) throw new Error('Cached original or account changed');
      await this.db.sources.update(sourceId, { cacheUsedAt: Date.now() });
      const next = { ...row, ...(pin && { title: pin.title, author: pin.author, pinned: true }), ...await this.refreshCheckpoint(ref, row.checkpoint, state) };
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
  async publish(ref: BookRef, stage: SourceRow, manifest: BookManifest, title: string | null, author: string | null, cover: Blob | null, state?: S['ReadingState'], signal?: AbortSignal, cache?: { etag?: string; pin?: Pick<StoredBook, 'title' | 'author'> }) {
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
      await this.db.books.put({ key, scope, ref, title, author, cover: cache ? old?.cover ?? cover : cover, pinned: old?.pinned, ...(cache?.pin && { title: cache.pin.title, author: cache.pin.author, pinned: true }), addedAt: old?.addedAt ?? new Date().toISOString(), lastReadAt: old?.lastReadAt ?? state?.updated_at ?? undefined, ...reading, resumeCandidate: old?.resumeCandidate, availability: 'available', bytes: null, sourceId: existingSource || stage.id, size: stage.size, checksum: integrity?.sha256 ?? null, protocolHash: integrity?.protocolHash ?? null, etag: cache?.etag });
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
    return this.openSource(row);
  }
  private async openSource(row: BookRow) {
    const ref = row.ref;
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
  private async offlineShelf(account: Account, rows: BookRow[], copies: DeviceCopy[]) {
    const scope = accountKey(account), shelf = new Map<string, BookRow>();
    const own = new Map(rows.filter(b => b.scope === scope).map(b => [b.key,b]));
    const drafts = await this.db.offline.where('scope').equals(scope).toArray();
    const heads = new Map((await this.db.heads.bulkGet(copies.map(b => refKey({ ...b.ref, account })))).filter(h => !!h).map(h => [h.key, h.state]));
    for (const row of copies) {
      const ref = { ...row.ref, account }, key = refKey(ref), previous = own.get(key);
      if (shelf.has(key) && row.scope !== scope) continue;
      const draft = drafts.find(d => d.document === ref.documentId && d.kind === 'progress');
      const head = heads.get(key);
      const checkpoint = draft?.kind === 'progress' ? draft.checkpoint : previous?.checkpoint ?? { position: head?.position ?? null, fraction: head?.fraction ?? null };
      shelf.set(key, { ...row, key, ref, scope, checkpoint, lastReadAt: draft?.created ?? previous?.lastReadAt, resumeCandidate: undefined });
    }
    return [...shelf.values()];
  }
  async openOffline(ref: Extract<BookRef, {kind: 'server'}>) {
    const { books } = await this.projection({ kind: 'offline', account: ref.account });
    const book = books.find(b => b.key === refKey(ref));
    if (!book) throw new Error('Book not on this device');
    return this.openSource(book);
  }
  private offlineProgress(ref: ServerRef) {
    return this.db.offline.where('[scope+document+kind]').equals([scopeOf(ref), ref.documentId, 'progress']);
  }
  async withOfflineProgress(row: BookRow) {
    if (row.ref.kind !== 'server') return row;
    const draft = await this.offlineProgress(row.ref).first();
    return draft?.kind === 'progress'
      ? { ...row, checkpoint: draft.checkpoint, lastReadAt: draft.created, resumeCandidate: undefined }
      : row;
  }
  async saveLocal(ref: Extract<BookRef, { kind: 'local' }>, checkpoint: Checkpoint) {
    await this.db.transaction('rw', this.db.books, async () => {
      const book = await this.db.books.get(refKey(ref));
      if (!book || book.availability !== 'available') throw new Error('Book unavailable');
      await this.db.books.put({ ...book, checkpoint, lastReadAt: new Date().toISOString() });
    });
  }
  async recordCapture(ref: ServerRef, checkpoint: Checkpoint | undefined, activity: S['ActivityEvent'] | undefined, options: {
    title?: string | null; online?: boolean; current(): boolean;
  }): Promise<Capture | undefined> {
    const scope = scopeOf(ref), document = ref.documentId, key = refKey(ref), created = new Date().toISOString();
    return this.db.transaction('rw', this.tables(), async () => {
      const previous = await this.offlineProgress(ref).first();
      const access = await this.db.access.get(scope);
      const head = await this.db.heads.get(key), pending = await this.pendingProgress(key);
      const automatic = options.online && access?.authenticated && access.eligible && (!previous || (!previous.held && this.verifying.has(previous.id)));
      const book = await this.db.books.get(key);
      const fields = { scope, document, title: book?.title ?? previous?.title ?? options.title ?? document, created };
      const ids: string[] = [];
      if (checkpoint) {
        const { position, fraction } = checkpoint;
        if (position === null || fraction === null || !validProgressPosition(position, fraction)) throw new Error('Invalid position');
        const id = crypto.randomUUID();
        await this.offlineProgress(ref).delete();
        await this.db.offline.add({ ...fields, id, kind: 'progress', checkpoint: { position, fraction } });
        ids.push(id);
      }
      if (activity) {
        if (activity.document_id !== document || !validSubmission({ kind: 'activity', payload: activity })) throw new Error('Invalid activity');
        const existing = await this.db.offline.get(activity.event_id), sent = await this.db.events.get(activity.event_id);
        if (existing && (existing.kind !== 'activity' || existing.scope !== scope || JSON.stringify(existing.event) !== JSON.stringify(activity)) ||
          sent && (sent.kind !== 'activity' || sent.scope !== scope || JSON.stringify(sent.payload) !== JSON.stringify(activity))) {
          throw new Error('Activity interval identity collision');
        }
        if (!existing && !sent) {
          await this.db.offline.add({ ...fields, id: activity.event_id, kind: 'activity', event: activity });
          ids.push(activity.event_id);
        }
      }
      if (!options.current()) throw new DOMException('Reading access changed', 'AbortError');
      if (automatic && ids.length && (!checkpoint || head || pending)) {
        const capture = { access: { scope, epoch: access.epoch }, ref, ids, revision: head?.state.revision, predecessor: pending?.id };
        Dexie.currentTransaction!.on('complete', () => ids.forEach(id => this.verifying.add(id)));
        return capture;
      }
    });
  }
  async promoteCapture(capture: Capture, deviceId: string, current: () => boolean) {
    const { access, ref, ids, revision, predecessor } = capture;
    const key = refKey(ref), scope = access.scope;
    return this.db.transaction('rw', this.tables(), async () => {
      if (!await this.replayCurrent(access) || !current()) return;
      const pending = await this.pendingProgress(key), head = await this.db.heads.get(key);
      let promoted = false;
      for (const row of await this.db.offline.bulkGet(ids)) {
        if (!row || row.held || row.scope !== scope || row.document !== ref.documentId || !this.verifying.has(row.id)) continue;
        if (row.kind === 'progress') {
          const chained = predecessor && predecessor === pending?.id;
          const base = head?.state.revision;
          const unchanged = !pending && (predecessor ? predecessor === head?.eventId : revision === base);
          if (!chained && (!unchanged || !base)) continue;
          const draft = { key, id: row.id, observedAt: row.created, ...row.checkpoint };
          if (chained) await this.db.progressDrafts.put(draft);
          else await this.enqueueProgress(draft, scope, ref.documentId, deviceId, base!);
          await this.saveCommittedPosition(ref, row);
        } else await this.addEvent(key, scope, { kind: 'activity', payload: row.event });
        await this.db.offline.delete(row.id);
        promoted = true;
      }
      if (!current()) throw new DOMException('Reading access changed', 'AbortError');
      return promoted;
    });
  }
  releaseCapture(capture: Capture) { capture.ids.forEach(id => this.verifying.delete(id)); }
  private async saveCommittedPosition(ref: ServerRef, row: Extract<OfflineRecord, {kind: 'progress'}>) {
    const key = refKey(ref), book = await this.db.books.get(key);
    await this.db.books.put({
      ...(book ?? { key, scope: row.scope, ref, title: row.title, author: null, cover: null, availability: 'unavailable', bytes: null, size: 0, checksum: null, protocolHash: null }),
      checkpoint: row.checkpoint, lastReadAt: row.created, resumeCandidate: undefined,
    });
  }
  async decideOffline(account: Account, choices: OfflineChoice[], decision: ReviewDecision) {
    const scope = accountKey(account), device = await this.device(account);
    await this.db.transaction('rw', [this.db.offline,this.db.access,this.db.events,this.db.books], async () => {
      if (!(await this.db.access.get(scope))?.authenticated) throw new Error('Sign in again');
      for (const choice of choices) {
        const row = await this.db.offline.get(choice.id);
        if (decision === 'keep') {
          if (row?.scope === scope) await this.db.offline.update(row.id, { held: true });
          continue;
        }
        if (!row || row.scope !== scope || !this.awaitingReview(row)) throw new Error('Offline records changed. Review again.');
        const ref: ServerRef = { kind: 'server', account, documentId: row.document }, key = refKey(ref);
        if (decision === 'upload' && row.kind === 'progress') {
          if (!choice.revision || await this.hasPendingProgress(key)) throw new Error('Refresh after progress syncs.');
          await this.addEvent(key, scope, { kind: 'progress', payload: { event_id: row.id, document_id: row.document, device_id: device.id, observed_at: row.created, base_revision: choice.revision, ...row.checkpoint } }, row.title);
          await this.saveCommittedPosition(ref, row);
        } else if (decision === 'upload' && row.kind === 'activity') await this.addEvent(key, scope, { kind: 'activity', payload: row.event });
        await this.db.offline.delete(row.id);
      }
    });
  }
  private async addEvent(key: string, scope: string, event: Submission, offlineTitle?: string) {
    if (!validSubmission(event)) throw new Error('Invalid immutable reading event');
    await this.db.events.add({ ...event, id: event.payload.event_id, key, scope, created: Date.now(), ...(offlineTitle !== undefined && { offlineTitle }) });
  }
  private pendingProgress(key: string) {
    return this.db.events.where('key').equals(key).filter(event => event.kind === 'progress' && !event.rejected).first();
  }
  private async hasPendingProgress(key: string) { return !!await this.pendingProgress(key); }
  private async enqueueProgress(draft: ProgressDraft, scope: string, document: string, device: string, revision: string) {
    await this.addEvent(draft.key, scope, { kind: 'progress', payload: { event_id: draft.id ?? crypto.randomUUID(), document_id: document, device_id: device, observed_at: draft.observedAt, base_revision: revision, position: draft.position, fraction: draft.fraction } });
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
      const pending = (await this.pending(scope)).filter(event => !event.rejected);
      const ids = [...pending.filter(e => e.kind === 'activity'), ...pending.filter(e => e.kind === 'progress')].slice(0, 32).map(e => e.id);
      return ids.length ? { access: { scope, epoch: row.epoch }, ids } : null;
    });
  }
  async reject(access: ReplayAccess, event: EventRow, status: number, code: string) {
    await this.db.transaction('rw', this.db.access, this.db.events, this.db.progressDrafts, async () => {
      if (!await this.replayCurrent(access) || event.scope !== access.scope) return;
      const stored = await this.db.events.get(event.id);
      if (!stored || stored.rejected) return;
      await this.db.events.update(event.id, { rejected: { status, code } });
      if (event.kind === 'progress') {
        const draft = await this.db.progressDrafts.get(event.key);
        if (draft) {
          await this.enqueueProgress(draft, event.scope, event.payload.document_id, event.payload.device_id, event.payload.base_revision);
          await this.db.progressDrafts.delete(event.key);
        }
      }
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
        if (!old || BigInt(receipt.revision!) > BigInt(old.revision)) await this.db.heads.put({ key: event.key, eventId: event.id, state: { document_id: event.payload.document_id, revision: receipt.revision!, position: event.payload.position, fraction: event.payload.fraction, device_id: event.payload.device_id, updated_at: event.payload.observed_at } });
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
      if (event.kind !== 'progress') throw new Error('Expected a progress event');
      const device = await this.db.progressDrafts.get(event.key) ?? { ...event.payload, observedAt: event.payload.observed_at };
      let resumeCandidate: ResumeCandidate | undefined;
      if (event.offlineTitle !== undefined) {
        const document = event.payload.document_id;
        if (!await this.db.offline.where('[scope+document+kind]').equals([event.scope,document,'progress']).count()) {
          await this.db.offline.add({ id: crypto.randomUUID(), kind: 'progress', document, scope: event.scope, title: event.offlineTitle, created: device.observedAt, checkpoint: { position: device.position, fraction: device.fraction } });
        }
      } else resumeCandidate = { eventId: event.id, position: device.position, fraction: device.fraction, savedAt: device.observedAt };
      await this.db.events.where('key').equals(event.key).filter(row => row.kind === 'progress' && !row.rejected).delete();
      await this.db.progressDrafts.delete(event.key);
      await this.db.heads.put({ key: event.key, state });
      await this.db.books.update(event.key, { resumeCandidate, checkpoint: { position: state.position, fraction: state.fraction }, lastReadAt: state.updated_at ?? undefined });
      return true;
    });
  }
  async clearResumeCandidate(ref: BookRef, candidate: ResumeCandidate) {
    await this.db.transaction('rw', this.db.books, this.db.access, async () => {
      if (!await this.permitted(ref)) return;
      const key = refKey(ref), row = await this.db.books.get(key);
      if (row?.resumeCandidate?.eventId === candidate.eventId) await this.db.books.update(key, { resumeCandidate: undefined });
    });
  }
}
