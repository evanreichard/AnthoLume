import Dexie, { type Table } from 'dexie';
import type { Account, BookRef, Checkpoint, Conflict, ReadingAccess, S, StoredBook } from './types';
import { accountKey, refKey } from './types';
import { blobSource, hashSource, sourceLimits, type Source } from './source';
import { validateEPUB } from './content-policy';
import type { BookManifest } from './book-manifest';
import { receiptFor, validSubmission, revisionPattern, type Submission } from './wire';
import { validState } from './protocol';
import type { CapturedActivity } from './activity';
import { StagingWriter } from './staging-writer';

export type BookRow = StoredBook & { key: string; scope: string; bytes: Blob | null; sourceId?: string; checksum: string; protocolHash: string; size: number; etag?: string };
export type SourceRow = { id: string; key: string; size: number; received: number; blob: Blob | null; complete: boolean; until: number; manifest?: BookManifest; manifestHash?: string; cacheUsedAt?: number; cacheReaders?: Record<string, number> };
const bookCacheBytes = 768 * 1024 * 1024;
const bookCacheCount = 6;
const cacheLeaseMs = 15 * 60_000;
const cacheLive = (row: SourceRow, now: number) => Object.values(row.cacheReaders ?? {}).some(until => until > now);
export type SourceChunk = { key: string; sourceId: string; data: ArrayBuffer };
export type EventRow = { id: string; key: string; scope: string; created: number; interval?: { id: string; startMs: number; endMs: number } } & Submission;
type AccessRow = { key: string; account: Account; epoch: number; eligible: boolean; authenticated: boolean };
export type Lease = { scope: string; owner: string; fence: number; epoch: number; until: number; ids: string[] };
type Decision = { id: string; outcome: 'receipt' | 'server' | 'local'; receipt?: S['Receipt']; replacement?: string; at: string };
type ConflictRow = Omit<Conflict, 'server'> & { server: S['ReadingState'] | null; scope: string; key: string; refreshed: boolean; currentRevision?: string; refreshError?: string | null };
type Head = { key: string; state: S['ReadingState'] };
type Meta = { key: string; value: unknown };
export class ReadingDB extends Dexie {
  sources!: Table<SourceRow, string>; sourceChunks!: Table<SourceChunk, string>;
  books!: Table<BookRow, string>; events!: Table<EventRow, string>; access!: Table<AccessRow, string>;
  leases!: Table<Lease, string>; decisions!: Table<Decision, string>; conflicts!: Table<ConflictRow, string>;
  heads!: Table<Head, string>; meta!: Table<Meta, string>; history!: Table<{ id: string; eventId: string; choice: string; observed: S['ReadingState']; replacement: string | null; at: string }, string>;
  constructor(name = 'antholume-reading-v1') {
    super(name);
    this.version(1).stores({ books: '&key,scope', events: '&id,scope,key,created', access: '&key', leases: '&scope', decisions: '&id', conflicts: '&eventId,scope,key', heads: '&key', meta: '&key', history: '&id,eventId' });
    this.version(2).stores({ sources: '&id,key,complete,until', sourceChunks: '&key,sourceId' });
  }
}
export async function checksum(input: ArrayBuffer | Blob | Source): Promise<string> { return (await hashSource(input instanceof Blob ? blobSource(input) : input instanceof ArrayBuffer ? blobSource(new Blob([input])) : input)).sha256; }
export const scopeOf = (ref: BookRef) => ref.kind === 'local' ? 'local' : accountKey(ref.account);
export class Repository {
  readonly stagingStats = { maxIncoming: 0, bytes: 0, chunks: 0, buffer: sourceLimits.chunkBytes };
  constructor(readonly db = new ReadingDB()) {}
  private tables() { return [this.db.books, this.db.events, this.db.access, this.db.leases, this.db.decisions, this.db.conflicts, this.db.heads, this.db.meta, this.db.history]; }
  async setAccess(access: ReadingAccess) {
    await this.db.transaction('rw', this.db.access, this.db.leases, this.db.meta, async () => {
      for (const row of await this.db.access.toArray()) {
        const same = 'account' in access && row.key === accountKey(access.account);
        const eligible = same ? access.kind !== 'logout' : !('account' in access) ? row.eligible : false;
        await this.db.access.put({ ...row, epoch: row.epoch + 1, eligible, authenticated: same && access.kind === 'authenticated' });
        const lease = await this.db.leases.get(row.key);
        if (lease) await this.db.leases.put({ ...lease, fence: lease.fence + 1, until: 0, ids: [] });
      }
      if ('account' in access) {
        const key = accountKey(access.account), old = await this.db.access.get(key);
        await this.db.access.put({ key, account: access.account, epoch: old?.epoch || 1, eligible: access.kind !== 'logout', authenticated: access.kind === 'authenticated' });
        await this.db.meta.put({ key: 'resume', value: access.kind === 'logout' ? null : access.account });
      }
    });
  }
  async resume(): Promise<Account | null> {
    const account = (await this.db.meta.get('resume'))?.value as Account | null;
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
  async validateStage(stage: SourceRow, signal?: AbortSignal, lazy = false) {
    const heartbeat = setInterval(() => { void this.db.sources.update(stage.id, { until: Date.now() + 120000 }).catch(() => undefined); }, 30000);
    try { return await validateEPUB(this.descriptor(stage), signal, lazy); } finally { clearInterval(heartbeat); }
  }
  private async removeSource(id: string) {
    await this.db.sourceChunks.where('sourceId').equals(id).delete();
    await this.db.sources.delete(id);
  }
  private async trimServerCache(reserve: number, keepKey?: string, clear = false) {
    const books = await this.db.books.filter(book => book.ref.kind === 'server' && book.availability === 'available').toArray();
    const bySource = new Map(books.map(book => [book.sourceId, book]));
    const sources = await this.db.sources.filter(source => source.complete && source.key.startsWith('["server",')).toArray();
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
  private async refreshCheckpoint(ref: BookRef, previous: Checkpoint, state?: S['ReadingState']) {
    if (!state) return { checkpoint: previous };
    if (!validState(state, ref.kind === 'server' ? ref.documentId : '')) throw new Error('Invalid server state');
    const key = refKey(ref), head = await this.db.heads.get(key);
    const events = await this.db.events.where('key').equals(key).filter(event => event.kind === 'progress').toArray();
    if ((await this.db.decisions.bulkGet(events.map(event => event.id))).some(decision => !decision)) return { checkpoint: previous };
    if (head && BigInt(head.state.revision) > BigInt(state.revision)) return { checkpoint: previous };
    await this.db.heads.put({ key, state });
    return { checkpoint: { position: state.position, fraction: state.fraction }, ...(state.updated_at ? { lastReadAt: state.updated_at } : {}) };
  }
  async useCached(ref: Extract<BookRef, { kind: 'server' }>, sourceId: string, etag: string, state: S['ReadingState'], signal: AbortSignal) {
    const opened = await this.open(ref);
    if (opened.row.sourceId !== sourceId || opened.row.etag !== etag) throw new Error('Cached original changed');
    return this.db.transaction('rw', [this.db.books, this.db.sources, this.db.heads, this.db.events, this.db.decisions, this.db.access], async () => {
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
    const update = (release = false) => this.db.transaction('rw', this.db.sources, async () => {
      const row = await this.db.sources.get(id);
      if (!row?.complete) { if (release) return; throw new Error('Cached original was evicted; reopen to download again'); }
      const now = Date.now(), readers = Object.fromEntries(Object.entries(row.cacheReaders ?? {}).filter(([key, until]) => key !== reader && until > now));
      if (!release) {
        if (Object.keys(readers).length >= 32) throw new Error('Too many readers for this EPUB');
        readers[reader] = now + cacheLeaseMs;
      }
      await this.db.sources.update(id, { cacheReaders: readers });
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
    const manifestHash = await checksum(metadata), previous = await this.db.books.get(key);
    let reuse = false;
    if (!cache && previous?.availability === 'available' && previous.sourceId && previous.checksum === manifest.integrity.sha256) {
      const source = await this.db.sources.get(previous.sourceId);
      if (source?.complete) {
        try { reuse = (await hashSource({ ...this.descriptor(source), digests: manifest.integrity.digests }, signal)).sha256 === manifest.integrity.sha256; } catch { signal?.throwIfAborted(); }
      }
    }
    signal?.throwIfAborted();
    await this.db.transaction('rw', [this.db.books, this.db.heads, this.db.access, this.db.sources, this.db.sourceChunks, this.db.events, this.db.decisions], async () => {
      if (!await this.permitted(ref) || cache && !(await this.db.access.get(scope))?.authenticated) throw new Error('Account no longer accessible');
      const row = await this.db.sources.get(stage.id); if (!row || row.complete || row.size !== stage.size || row.received !== stage.size) throw new Error('Incomplete staged original');
      const old = await this.db.books.get(key);
      if (!cache && old?.availability === 'available' && old.checksum !== manifest.integrity.sha256) throw new Error('Original server bytes changed; remove old download before replacing');
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
      await this.db.books.put({ key, scope, ref, title, author, cover, addedAt: old?.addedAt ?? new Date().toISOString(), lastReadAt: old?.lastReadAt ?? state?.updated_at ?? undefined, ...reading, availability: 'available', bytes: null, sourceId: existingSource || stage.id, size: stage.size, checksum: manifest.integrity.sha256, protocolHash: manifest.integrity.protocolHash, etag: cache?.etag });
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
    if (!stored || !stored.complete || !stored.manifest || stored.size !== row.size || stored.manifest.integrity.sha256 !== row.checksum) throw new Error('Original source/index unavailable');
    const metadata = new Blob([JSON.stringify(stored.manifest)]);
    if (metadata.size > 16 * 1024 * 1024 || !stored.manifestHash) throw new Error('Validated index integrity unavailable; re-import or download required');
    const manifestHash = await checksum(metadata);
    if (stored.manifestHash !== manifestHash) throw new Error('Validated index integrity mismatch');
    return { row, source: { ...this.descriptor(stored), digests: stored.manifest.integrity.digests }, manifest: stored.manifest };
  }
  async exportLocal(ref: Extract<BookRef, { kind: 'local' }>): Promise<Blob> {
    const book = await this.db.books.get(refKey(ref));
    if (!book || book.ref.kind !== 'local') throw new Error('Local book not found');
    if (book.bytes?.size) return book.bytes;
    const source = book.sourceId && await this.db.sources.get(book.sourceId);
    if (!source || !source.complete || source.key !== book.key || !source.blob || source.blob.size !== book.size) throw new Error('Original local EPUB is unavailable');
    return source.blob;
  }
  async remove(ref: BookRef) {
    await this.db.transaction('rw', this.db.books, this.db.access, this.db.sources, this.db.sourceChunks, async () => {
      if (!await this.permitted(ref)) throw new Error('Account hidden'); const key = refKey(ref), old = await this.db.books.get(key);
      if (old?.sourceId) { await this.db.sourceChunks.where('sourceId').equals(old.sourceId).delete(); await this.db.sources.delete(old.sourceId); }
      if (ref.kind === 'local') await this.db.books.delete(key); else if (old) await this.db.books.put({ ...old, sourceId: undefined, bytes: null, cover: null, availability: 'unavailable' });
    });
  }
  async save(ref: BookRef, checkpoint: Checkpoint, activity?: S['ActivityEvent']) {
    const device = ref.kind === 'server' ? await this.device(ref.account) : null;
    await this.db.transaction('rw', this.db.books, this.db.events, this.db.heads, this.db.access, async () => {
      if (!await this.permitted(ref)) throw new Error('Account hidden');
      const key = refKey(ref), book = await this.db.books.get(key);
      if (!book || ref.kind === 'local' && book.availability !== 'available') throw new Error('Book unavailable');
      await this.db.books.put({ ...book, checkpoint, lastReadAt: new Date().toISOString() });
      if (ref.kind === 'local') { if (activity) throw new Error('Local activity must never upload'); return; }
      const state = (await this.db.heads.get(key))?.state;
      if (!state || !checkpoint.position || checkpoint.fraction === null) throw new Error('A known server revision and recoverable position are required');
      const submission: Submission = { kind: 'progress', payload: { event_id: crypto.randomUUID(), document_id: ref.documentId, device_id: device!.id, observed_at: new Date().toISOString(), base_revision: state.revision, position: checkpoint.position, fraction: checkpoint.fraction } };
      const add = async (event: Submission) => {
        if (!validSubmission(event)) throw new Error('Invalid immutable reading event');
        await this.db.events.add({ ...event, id: event.payload.event_id, key, scope: scopeOf(ref), created: Date.now() });
      };
      await add(submission);
      if (activity) await add({ kind: 'activity', payload: activity });
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
  async pending(scope?: string) { const events = scope ? await this.db.events.where('scope').equals(scope).sortBy('created') : await this.db.events.orderBy('created').toArray(); const decided = new Set((await this.db.decisions.toArray()).map(d => d.id)); return events.filter(e => !decided.has(e.id)); }
  private async current(lease: Lease) {
    const access = await this.db.access.get(lease.scope), row = await this.db.leases.get(lease.scope);
    return !!(access?.authenticated && access.eligible && access.epoch === lease.epoch && row?.owner === lease.owner && row.fence === lease.fence && row.until > Date.now());
  }
  async claim(account: Account, owner: string): Promise<Lease | null> {
    const scope = accountKey(account);
    return this.db.transaction('rw', this.tables(), async () => {
      const access = await this.db.access.get(scope), previous = await this.db.leases.get(scope);
      if (!access?.authenticated || !access.eligible || previous && previous.until > Date.now()) return null;
      const conflicts = await this.db.conflicts.where('scope').equals(scope).toArray();
      const blocked = new Set(conflicts.filter(c => c.server !== null).map(c => c.eventId));
      const needsRefresh = new Set(conflicts.filter(c => c.server === null).map(c => c.eventId));
      const pending = (await this.pending(scope)).filter(e => !blocked.has(e.id));
      // Delivery Before Details - A backlog of unavailable conflict reads cannot occupy every lease slot ahead of activity.
      const ids = [...pending.filter(e => !needsRefresh.has(e.id)), ...pending.filter(e => needsRefresh.has(e.id))].slice(0, 32).map(e => e.id);
      if (!ids.length) return null;
      const lease: Lease = { scope, owner, epoch: access.epoch, fence: (previous?.fence || 0) + 1, until: Date.now() + 30000, ids };
      await this.db.leases.put(lease); return lease;
    });
  }
  async leaseCurrent(lease: Lease) { return this.db.transaction('r', this.db.access, this.db.leases, () => this.current(lease)); }
  async release(lease: Lease) { await this.db.transaction('rw', this.db.leases, async () => { const row = await this.db.leases.get(lease.scope); if (row?.owner === lease.owner && row.fence === lease.fence) await this.db.leases.put({ ...row, until: 0, ids: [] }); }); }
  async expire(lease: Lease) {
    return this.db.transaction('rw', this.db.access, this.db.leases, async () => {
      if (!await this.current(lease)) return false;
      const row = (await this.db.access.get(lease.scope))!;
      await this.db.access.put({ ...row, epoch: row.epoch + 1, authenticated: false });
      await this.db.leases.put({ ...lease, fence: lease.fence + 1, until: 0, ids: [] }); return true;
    });
  }
  async acknowledge(lease: Lease, event: EventRow, receipt: unknown) {
    await this.db.transaction('rw', this.tables(), async () => {
      const stored = await this.db.events.get(event.id);
      if (!await this.current(lease) || !lease.ids.includes(event.id) || !stored || stored.scope !== lease.scope || JSON.stringify(stored) !== JSON.stringify(event) || !receiptFor(receipt, stored)) throw new Error('Stale or invalid acknowledgement');
      await this.db.decisions.add({ id: event.id, outcome: 'receipt', receipt, at: new Date().toISOString() });
      if (event.kind === 'progress') {
        const old = (await this.db.heads.get(event.key))?.state;
        if (!old || BigInt(receipt.revision!) > BigInt(old.revision)) await this.db.heads.put({ key: event.key, state: { document_id: event.payload.document_id, revision: receipt.revision!, position: event.payload.position, fraction: event.payload.fraction, device_id: event.payload.device_id, updated_at: event.payload.observed_at } });
      }
    });
  }
  async recordConflict(lease: Lease, event: EventRow, state: S['ReadingState'] | null, revision = state?.revision, refreshError: string | null = null) {
    if (event.kind !== 'progress' || !revision || !revisionPattern.test(revision) || state !== null && !validState(state, event.payload.document_id)) throw new Error('Invalid conflict state');
    await this.db.transaction('rw', this.db.access, this.db.leases, this.db.conflicts, this.db.events, this.db.decisions, async () => {
      if (!await this.current(lease) || !lease.ids.includes(event.id) || event.scope !== lease.scope) throw new Error('Stale conflict response');
      // Resolution Race - Late detail results cannot resurrect a superseded event or replace a newer observed snapshot.
      if (await this.db.decisions.get(event.id)) return;
      const stored = await this.db.events.get(event.id);
      if (!stored || JSON.stringify(stored) !== JSON.stringify(event)) throw new Error('Conflict event changed');
      const existing = await this.db.conflicts.get(event.id);
      if (existing?.server && (!state || BigInt(existing.server.revision) > BigInt(state.revision))) return;
      const access = (await this.db.access.get(lease.scope))!;
      await this.db.conflicts.put({ eventId: event.id, scope: lease.scope, key: event.key, ref: { kind: 'server', account: access.account, documentId: event.payload.document_id }, local: { position: event.payload.position, fraction: event.payload.fraction }, server: state, refreshed: false, currentRevision: revision, refreshError });
    });
  }
  async refreshConflict(id: string, state: S['ReadingState'], epoch: number) {
    return this.db.transaction('rw', this.db.conflicts, this.db.access, async () => {
      const row = await this.db.conflicts.get(id), access = row && await this.db.access.get(row.scope);
      if (!row || !access?.authenticated || access.epoch !== epoch || row.ref.kind !== 'server' || !validState(state, row.ref.documentId)) throw new Error('Conflict access changed');
      const next = { ...row, server: state, refreshed: true, currentRevision: state.revision, refreshError: null }; await this.db.conflicts.put(next); return next;
    });
  }
  async resolve(id: string, choice: 'local' | 'server', revision: string) {
    await this.db.transaction('rw', this.tables(), async () => {
      const conflict = await this.db.conflicts.get(id), event = await this.db.events.get(id);
      const access = conflict && await this.db.access.get(conflict.scope);
      if (!conflict?.refreshed || !conflict.server || !access?.authenticated || !access.eligible || !event || event.kind !== 'progress' || conflict.server.revision !== revision || await this.db.decisions.get(id)) throw new Error('Refresh the conflict before choosing');
      let replacement: string | null = null;
      if (choice === 'local') {
        replacement = crypto.randomUUID();
        const payload = { ...event.payload, event_id: replacement, base_revision: revision, observed_at: new Date().toISOString() };
        await this.db.events.add({ ...event, id: replacement, payload, created: Date.now() });
      }
      await this.db.decisions.add({ id, outcome: choice, replacement: replacement || undefined, at: new Date().toISOString() });
      await this.db.history.add({ id: crypto.randomUUID(), eventId: id, choice, observed: conflict.server, replacement, at: new Date().toISOString() });
      await this.db.heads.put({ key: conflict.key, state: conflict.server });
      const book = await this.db.books.get(conflict.key);
      // Newer Local Reading - An explicit choice resolves this event, never silently supersedes later checkpoints/events.
      if (choice === 'server' && book && book.checkpoint.position === conflict.local.position && book.checkpoint.fraction === conflict.local.fraction) await this.db.books.put({ ...book, checkpoint: { position: conflict.server.position, fraction: conflict.server.fraction } });
      await this.db.conflicts.delete(id);
    });
  }
}
