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
import { bookView, downloadKey, libraryKey, migrateDownloads, positionFor, sourceKey, type BookRow, type Download, type Position, type ResumeCandidate, type ServerRef, type SourceRow } from './download-layout';

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
  downloads!: Table<Download, string>; positions!: Table<Position, string>;
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
    this.version(7).stores({ downloads: '&key,library', positions: '&key,scope' }).upgrade(migrateDownloads);
  }
}
export async function checksum(input: ArrayBuffer | Blob | Source): Promise<string> { return (await hashSource(input instanceof Blob ? blobSource(input) : input instanceof ArrayBuffer ? blobSource(new Blob([input])) : input)).sha256; }
export const scopeOf = (ref: BookRef) => ref.kind === 'local' ? 'local' : accountKey(ref.account);
type Capture = { access: ReplayAccess; ref: ServerRef; ids: string[]; revision?: string; predecessor?: string };
export class Repository {
  private readonly verifying = new Set<string>();
  awaitingReview(row: OfflineRecord) { return !this.verifying.has(row.id); }
  readonly stagingStats = { maxIncoming: 0, bytes: 0, chunks: 0, buffer: sourceLimits.chunkBytes };
  constructor(readonly db = new ReadingDB()) {}
  private tables() { return [this.db.positions, this.db.downloads, this.db.events, this.db.access, this.db.heads, this.db.progressDrafts, this.db.offline]; }
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
    const localBooks = () => this.db.books.where('scope').equals('local').toArray();
    if (!('account' in access) || access.kind === 'logout') return { books: await localBooks() };
    const { account } = access, scope = accountKey(account);
    const downloads = await this.db.downloads.where('library').equals(libraryKey(account)).toArray();
    const deviceCopies = new Map(downloads.map(d => [d.document, d.pinned ? 'saved' as const : 'cached' as const]));
    if (access.kind === 'offline') {
      const refs = downloads.map(({ document }) => ({ kind: 'server' as const, account, documentId: document }));
      const keys = refs.map(refKey);
      const [positions, heads, drafts] = await Promise.all([this.db.positions.bulkGet(keys), this.db.heads.bulkGet(keys),
        this.db.offline.where('[scope+document+kind]').anyOf(refs.map(ref => [scope, ref.documentId, 'progress'])).toArray()]);
      const byDoc = new Map(drafts.map(d => [d.document, d]));
      return { deviceCopies, books: refs.map((ref, i) => this.offlineView(ref, downloads[i], positions[i], heads[i], byDoc.get(ref.documentId))) };
    }
    const copies = new Map(downloads.map(d => [d.document, d]));
    const positions = (await this.db.access.get(scope))?.eligible ? await this.db.positions.where('scope').equals(scope).toArray() : [];
    return { deviceCopies, books: [...await localBooks(), ...positions.map(p => bookView(p.ref, copies.get(p.ref.documentId), p))] };
  }
  async readingView(access: ReadingAccess) {
    const db = this.db;
    const scope = 'account' in access && access.kind !== 'logout' ? accountKey(access.account) : undefined;
    return db.transaction('r', [db.books, db.downloads, db.positions, db.heads, db.offline, db.meta, db.access, db.events], async () => {
      const [shelf, resumeAccount, pending, captures] = await Promise.all([
        this.projection(access), this.resume(), scope ? db.events.where('scope').equals(scope).toArray() : [],
        access.kind === 'authenticated' ? db.offline.where('scope').equals(accountKey(access.account)).toArray() : [],
      ]);
      return {
        books: shelf.books.map(({ ref, title, author, cover, availability, checkpoint, addedAt, lastReadAt, pinned }) =>
          ({ ref, title, author, cover, availability, checkpoint, addedAt, lastReadAt, pinned })),
        deviceCopies: shelf.deviceCopies, resumeAccount, captures, pendingCount: pending.length,
        blocked: pending.length > 0 && pending.every(event => event.rejected),
      };
    });
  }
  private offlineView(ref: ServerRef, download: Download, position?: Position, head?: Head, draft?: OfflineRecord, source?: SourceRow) {
    const row = bookView(ref, download, position, source);
    const checkpoint = draft?.kind === 'progress' ? draft.checkpoint : position?.checkpoint ?? { position: head?.state.position ?? null, fraction: head?.state.fraction ?? null };
    return { ...row, checkpoint, lastReadAt: draft?.created ?? position?.lastReadAt, resumeCandidate: undefined };
  }
  async cachedOriginal(ref: ServerRef) {
    const download = await this.db.downloads.get(downloadKey(ref));
    if (!download) return;
    const source = await this.db.sources.get(download.sourceId);
    return { ...download, etag: source?.complete && !source.evictOnRelease && source.key === download.key ? source.etag : undefined };
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
    const row: SourceRow = { id: crypto.randomUUID(), key: sourceKey(ref), size: blob.size, received: blob.size, blob, complete: false, until: Date.now() + 120000 };
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
    signal?.throwIfAborted(); await this.cleanupStages(); const row: SourceRow = { id: crypto.randomUUID(), key: sourceKey(ref), size: 0, received: 0, blob: null, complete: false, until: Date.now() + 120000 };
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
  private async retireSource(id: string) {
    const source = await this.db.sources.get(id);
    if (source && cacheLive(source, Date.now())) await this.db.sources.update(id, { evictOnRelease: true });
    else await this.removeSource(id);
  }
  private async trimServerCache(keepKey?: string, clear = false) {
    const copies = await this.db.downloads.filter(d => !d.pinned).toArray();
    const sources = await this.db.sources.bulkGet(copies.map(d => d.sourceId));
    const candidates = copies.map((copy, i) => ({ copy, source: sources[i] })).sort((a, b) => (a.source?.cacheUsedAt ?? 0) - (b.source?.cacheUsedAt ?? 0));
    let bytes = sources.reduce((sum, s) => sum + (s?.size ?? 0), 0), count = copies.length;
    for (const { copy, source } of candidates) {
      if (!clear && bytes <= bookCacheBytes && count <= bookCacheCount) return;
      if (copy.key === keepKey || source && cacheLive(source, Date.now())) continue;
      await this.removeSource(copy.sourceId);
      await this.db.downloads.delete(copy.key);
      bytes -= source?.size ?? 0; count--;
    }
    if (!clear && (bytes > bookCacheBytes || count > bookCacheCount)) throw new Error('Close another open book before caching this EPUB');
  }
  async cacheCover(ref: ServerRef, cover: Blob | null, signal: AbortSignal, { replace = false, expectedSource }: { replace?: boolean; expectedSource?: string } = {}) {
    if (cover ? !validCover(cover) : !replace) return;
    await this.db.transaction('rw', this.db.downloads, this.db.sources, this.db.access, async () => {
      signal.throwIfAborted();
      const copy = await this.db.downloads.get(downloadKey(ref));
      if (!copy || !replace && (copy.cover || copy.coverRemoved) || expectedSource && copy.sourceId !== expectedSource) return;
      if (!(await this.db.access.get(scopeOf(ref)))?.authenticated || !(await this.db.sources.get(copy.sourceId))?.complete) return;
      await this.db.downloads.update(copy.key, { cover, coverRemoved: cover === null });
      signal.throwIfAborted();
    });
  }
  async retainCachedCopy(ref: ServerRef, signal: AbortSignal) {
    await this.db.transaction('rw', this.db.downloads, this.db.sources, async () => {
      signal.throwIfAborted();
      const copy = await this.db.downloads.get(downloadKey(ref));
      if (!copy || !(await this.db.sources.get(copy.sourceId))?.complete) throw new Error('Book is not downloaded');
      await this.db.downloads.update(copy.key, { pinned: true });
      signal.throwIfAborted();
    });
  }
  async removeFromDevice(ref: ServerRef, signal: AbortSignal, access: 'authenticated' | 'offline') {
    await this.db.transaction('rw', [this.db.downloads, this.db.access, this.db.sources, this.db.sourceChunks], async () => {
      signal.throwIfAborted();
      if (access === 'authenticated' && !await this.permitted(ref)) throw new Error('Account changed');
      const copy = await this.db.downloads.get(downloadKey(ref));
      if (copy) { await this.db.downloads.delete(copy.key); await this.retireSource(copy.sourceId); }
      signal.throwIfAborted();
    });
  }
  async freeServerCache(ref: ServerRef) {
    await this.db.transaction('rw', this.db.downloads, this.db.sources, this.db.sourceChunks, () => this.trimServerCache(downloadKey(ref), true));
  }
  private legacyServerBooks() {
    return this.db.books.where('scope').notEqual('local').filter(book => book.ref.kind === 'server');
  }
  async readerCacheSummary(): Promise<ReaderCacheSummary> {
    return this.db.transaction('r', this.db.books, this.db.downloads, this.db.sources, async () => {
      const copies = await this.db.downloads.toArray();
      const sources = await this.db.sources.bulkGet(copies.map(d => d.sourceId));
      const summary = { books: 0, epubBytes: 0, metadataBytes: 0 };
      sources.forEach((s, i) => {
        if (!s?.complete || s.evictOnRelease) return;
        summary.books++; summary.epubBytes += s.size;
        summary.metadataBytes += (copies[i].cover?.size ?? 0) + (s.manifest ? new Blob([JSON.stringify(s.manifest)]).size : 0);
      });
      for (const book of await this.legacyServerBooks().toArray()) {
        const legacySources = await this.db.sources.where('key').equals(book.key).filter(s => !s.evictOnRelease).toArray();
        if (book.bytes || book.cover || legacySources.length) summary.books++;
        summary.epubBytes += book.bytes?.size ?? 0;
        summary.metadataBytes += book.cover?.size ?? 0;
        for (const source of legacySources) {
          summary.epubBytes += source.received;
          if (source.manifest) summary.metadataBytes += new Blob([JSON.stringify(source.manifest)]).size;
        }
      }
      return summary;
    });
  }
  async clearServerCache() {
    await this.db.transaction('rw', [this.db.books, this.db.downloads, this.db.sources, this.db.sourceChunks], async () => {
      for (const book of await this.legacyServerBooks().toArray()) {
        for (const id of await this.db.sources.where('key').equals(book.key).primaryKeys()) await this.retireSource(id);
        await this.db.books.update(book.key, { bytes: null, cover: null, sourceId: undefined, size: 0, availability: 'unavailable' });
      }
      for (const copy of await this.db.downloads.toArray()) await this.retireSource(copy.sourceId);
      await this.db.downloads.clear();
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
    return this.db.transaction('rw', [this.db.positions, this.db.downloads, this.db.sources, this.db.heads, this.db.events, this.db.access], async () => {
      signal.throwIfAborted();
      const copy = await this.cachedOriginal(ref);
      if (!copy || opened.row.sourceId !== sourceId || copy.sourceId !== sourceId || copy.etag !== etag || !(await this.db.access.get(scopeOf(ref)))?.authenticated) throw new Error('Cached original or account changed');
      await this.db.sources.update(sourceId, { cacheUsedAt: Date.now() });
      if (pin) await this.db.downloads.update(copy.key, { title: pin.title, author: pin.author, pinned: true });
      const previous = await this.db.positions.get(refKey(ref)) ?? positionFor(ref, { position: null, fraction: null });
      const position = { ...previous, ...await this.refreshCheckpoint(ref, previous.checkpoint, state) };
      await this.db.positions.put(position);
      signal.throwIfAborted();
      return { ...opened, row: { ...opened.row, ...position, ...(pin && { title: pin.title, author: pin.author, pinned: true }) } };
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
  async publish(ref: BookRef, stage: SourceRow, manifest: BookManifest, title: string | null, author: string | null, cover: Blob | null, state?: S['ReadingState'], signal?: AbortSignal, cache?: { etag?: string; previousSource?: string; pin?: Pick<StoredBook, 'title' | 'author'> }) {
    signal?.throwIfAborted(); const key = refKey(ref), scope = scopeOf(ref);
    if (!await this.permitted(ref)) throw new Error('Account no longer accessible');
    const metadata = new Blob([JSON.stringify(manifest)]); if (metadata.size > 16 * 1024 * 1024) throw new Error('Validated index metadata exceeds 16 MiB');
    const integrity = manifest.integrity;
    if (!integrity && (!manifest.lazy || !cache || ref.kind !== 'server')) throw new Error('Original fingerprint required');
    const manifestHash = await checksum(metadata);
    const ownerKey = sourceKey(ref);
    const currentCopy = () => ref.kind === 'local' ? this.db.books.get(key) : this.db.downloads.get(ownerKey);
    const previous = await currentCopy();
    const previousId = previous?.sourceId;
    const oldSource = previousId ? await this.db.sources.get(previousId) : undefined;
    const previousChecksum = previous && 'checksum' in previous ? previous.checksum : oldSource?.checksum;
    let reuse = false;
    if (!cache && oldSource?.complete && integrity && previousChecksum === integrity.sha256) {
      try { reuse = (await hashSource({ ...this.descriptor(oldSource), digests: integrity.digests }, signal)).sha256 === integrity.sha256; } catch { signal?.throwIfAborted(); }
    }
    signal?.throwIfAborted();
    await this.db.transaction('rw', [this.db.books, this.db.positions, this.db.downloads, this.db.heads, this.db.access, this.db.sources, this.db.sourceChunks, this.db.events], async () => {
      if (!await this.permitted(ref) || cache && !(await this.db.access.get(scope))?.authenticated) throw new Error('Account no longer accessible');
      const row = await this.db.sources.get(stage.id);
      if (!row || row.key !== ownerKey || row.complete || row.size !== stage.size || row.received !== stage.size) throw new Error('Incomplete staged original');
      const old = await currentCopy();
      if (old?.sourceId !== previousId || cache && 'previousSource' in cache && cache.previousSource !== previousId) throw new Error('Stored source changed during publication; retry');
      const fingerprint = { checksum: integrity?.sha256 ?? null, protocolHash: integrity?.protocolHash ?? null };
      const sourceId = reuse ? previousId! : stage.id;
      if (!cache && previous && previousChecksum !== fingerprint.checksum) throw new Error('Original bytes changed; remove the old download before replacing');
      if (reuse) await this.db.sources.update(sourceId, { manifest, manifestHash });
      else {
        if (previousId) await this.retireSource(previousId);
        await this.db.sources.put({ ...row, ...fingerprint, complete: true, manifest, manifestHash, until: 0, etag: cache?.etag, cacheUsedAt: Date.now() });
      }
      const addedAt = old?.addedAt ?? new Date().toISOString();
      if (ref.kind === 'local') {
        const local = old as BookRow | undefined;
        await this.db.books.put({ key, scope, ref, title, author, cover, addedAt, checkpoint: local?.checkpoint ?? { position: null, fraction: null },
          lastReadAt: local?.lastReadAt, availability: 'available', bytes: null, sourceId, size: stage.size, ...fingerprint });
      } else {
        const previousPosition = await this.db.positions.get(key);
        const position = previousPosition ?? positionFor(ref, { position: state?.position ?? null, fraction: state?.fraction ?? null });
        const reading = cache ? await this.refreshCheckpoint(ref, position.checkpoint, state) : {};
        await this.db.positions.put({ ...position, lastReadAt: position.lastReadAt ?? state?.updated_at ?? undefined, ...reading });
        await this.db.downloads.put({ key: ownerKey, library: libraryKey(ref.account), document: ref.documentId, sourceId, addedAt,
          title, author, cover: old?.cover ?? cover, coverRemoved: old && 'coverRemoved' in old && old.coverRemoved, pinned: !!old?.pinned, ...(cache?.pin && { title: cache.pin.title, author: cache.pin.author, pinned: true }) });
        if (cache) await this.trimServerCache(ownerKey);
        else if (state) {
          if (!validState(state, ref.documentId)) throw new Error('Invalid server state');
          const head = await this.db.heads.get(key);
          if (!head || BigInt(head.state.revision) < BigInt(state.revision)) await this.db.heads.put({ key, state });
        }
      }
      signal?.throwIfAborted();
    });
  }
  async install(ref: BookRef, input: Blob | ArrayBuffer, title: string | null, author: string | null, cover: Blob | null, state?: S['ReadingState'], signal?: AbortSignal) {
    const stage = await this.stageBlob(ref, input instanceof Blob ? input : new Blob([input]), signal);
    try { const policy = await this.validateStage(stage, signal); try { await this.publish(ref, stage, policy.manifest, title, author, cover, state, signal); } finally { policy.dispose(); } }
    finally { await this.discardSource(stage.id); }
  }
  async open(ref: BookRef): Promise<{ row: BookRow; source: Source; manifest: BookManifest }> {
    if (!await this.permitted(ref)) throw new Error('Account hidden');
    if (ref.kind === 'server') return this.openDownload(ref, false);
    const row = await this.db.books.get(refKey(ref));
    if (!row || row.availability !== 'available') throw new Error('Book unavailable; download or re-import required');
    if (!row.sourceId && row.bytes) { await this.install(ref, row.bytes, row.title, row.author, row.cover); return this.open(ref); }
    return this.openSource(row, row.sourceId ? await this.db.sources.get(row.sourceId) : undefined);
  }
  private async openSource(row: BookRow, stored?: SourceRow) {
    const ref = row.ref;
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
  openOffline(ref: ServerRef) { return this.openDownload(ref, true); }
  private async openDownload(ref: ServerRef, offline: boolean) {
    const key = refKey(ref);
    const { row, source } = await this.db.transaction('r', [this.db.downloads, this.db.positions, this.db.sources, this.db.offline, this.db.heads], async () => {
      const copy = await this.db.downloads.get(downloadKey(ref));
      if (!copy) throw new Error('Book not on this device');
      const position = await this.db.positions.get(key);
      const source = await this.db.sources.get(copy.sourceId);
      if (!source?.complete || source.evictOnRelease || source.key !== copy.key) throw new Error('Original source/index unavailable');
      const row = offline
        ? this.offlineView(ref, copy, position, await this.db.heads.get(key), await this.offlineProgress(ref).first(), source)
        : bookView(ref, copy, position, source);
      return { row, source };
    });
    if (source.needsIndex && source.blob) {
      // Inline V1 Originals - Validate the retained blob on first use without copying its bytes during upgrade.
      const policy = await validateEPUB(this.descriptor(source));
      try {
        const integrity = policy.manifest.integrity;
        if (!integrity || source.checksum && source.checksum !== integrity.sha256 || source.protocolHash && source.protocolHash !== integrity.protocolHash) throw new Error('Legacy source integrity mismatch');
        const manifestHash = await checksum(new Blob([JSON.stringify(policy.manifest)]));
        Object.assign(source, { needsIndex: undefined, manifest: policy.manifest, manifestHash, checksum: integrity.sha256, protocolHash: integrity.protocolHash });
        await this.db.sources.update(source.id, { needsIndex: undefined, manifest: source.manifest, manifestHash, checksum: integrity.sha256, protocolHash: integrity.protocolHash });
        row.checksum = integrity.sha256; row.protocolHash = integrity.protocolHash;
      } finally { policy.dispose(); }
    }
    return this.openSource(row, source);
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
  async rememberMissingHead(ref: ServerRef, state: S['ReadingState'], signal: AbortSignal) {
    if (!validState(state, ref.documentId)) throw new Error('Invalid server reading state');
    const key = refKey(ref);
    await this.db.transaction('rw', this.db.heads, this.db.access, async () => {
      if ((await this.db.access.get(scopeOf(ref)))?.authenticated && !await this.db.heads.get(key)) await this.db.heads.put({ key, state });
      signal.throwIfAborted();
    });
  }
  async recordCapture(ref: ServerRef, checkpoint: Checkpoint | undefined, activity: S['ActivityEvent'] | undefined, options: {
    title?: string | null; online?: boolean; awaitingRevision?: boolean; current(): boolean;
  }): Promise<Capture | undefined> {
    const scope = scopeOf(ref), document = ref.documentId, key = refKey(ref), created = new Date().toISOString();
    return this.db.transaction('rw', this.tables(), async () => {
      const previous = await this.offlineProgress(ref).first();
      const access = await this.db.access.get(scope);
      const head = await this.db.heads.get(key), pending = await this.pendingProgress(key);
      const automatic = options.online && access?.authenticated && access.eligible && (!previous || (!previous.held && this.verifying.has(previous.id)));
      const book = await this.db.downloads.get(downloadKey(ref));
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
      if (automatic && ids.length && (!checkpoint || head || pending || options.awaitingRevision)) {
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
      const promoted: string[] = [];
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
        promoted.push(row.id);
      }
      if (!current()) throw new DOMException('Reading access changed', 'AbortError');
      return promoted;
    });
  }
  releaseCapture(capture: Capture) { capture.ids.forEach(id => this.verifying.delete(id)); }
  private async saveCommittedPosition(ref: ServerRef, row: Extract<OfflineRecord, {kind: 'progress'}>) {
    await this.db.positions.put({ ...positionFor(ref, row.checkpoint), lastReadAt: row.created });
  }
  async decideOffline(account: Account, choices: OfflineChoice[], decision: ReviewDecision) {
    const scope = accountKey(account), device = await this.device(account);
    await this.db.transaction('rw', [this.db.offline,this.db.access,this.db.events,this.db.positions], async () => {
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
      await this.db.positions.update(event.key, { resumeCandidate, checkpoint: { position: state.position, fraction: state.fraction }, lastReadAt: state.updated_at ?? undefined });
      return true;
    });
  }
  async clearResumeCandidate(ref: BookRef, candidate: ResumeCandidate) {
    if (ref.kind !== 'server') return;
    await this.db.transaction('rw', this.db.positions, this.db.access, async () => {
      if (!await this.permitted(ref)) return;
      const key = refKey(ref), row = await this.db.positions.get(key);
      if (row?.resumeCandidate?.eventId === candidate.eventId) await this.db.positions.update(key, { resumeCandidate: undefined });
    });
  }
}
