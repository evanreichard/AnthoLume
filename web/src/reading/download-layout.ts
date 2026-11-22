import type { Transaction } from 'dexie';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { accountKey, refKey, type Account, type BookRef, type Checkpoint, type StoredBook } from './types';
import type { BookManifest } from './book-manifest';
import { sourceLimits } from './source';

export type ResumeCandidate = Checkpoint & { eventId: string; savedAt: string };
export type BookRow = StoredBook & { resumeCandidate?: ResumeCandidate; key: string; scope: string; bytes: Blob | null; sourceId?: string; checksum: string | null; protocolHash: string | null; size: number; etag?: string };
export type SourceRow = { etag?: string; checksum?: string | null; protocolHash?: string | null; needsIndex?: boolean; id: string; key: string; size: number; received: number; blob: Blob | null; complete: boolean; until: number; manifest?: BookManifest; manifestHash?: string; cacheUsedAt?: number; cacheReaders?: Record<string, number>; evictOnRelease?: boolean };

export type ServerRef = Extract<BookRef, { kind: 'server' }>;
export type Download = Pick<BookRow, 'title' | 'author' | 'cover' | 'addedAt'> & {
  key: string; library: string; document: string; sourceId: string; pinned: boolean;
};
export type Position = Pick<BookRow, 'key' | 'scope' | 'checkpoint' | 'lastReadAt' | 'resumeCandidate'> & { ref: ServerRef };
export const libraryKey = (account: Account) => JSON.stringify([account.origin, account.readingGeneration ?? null]);
export const downloadKey = (ref: ServerRef) => JSON.stringify(['download', libraryKey(ref.account), ref.documentId]);
export const sourceKey = (ref: BookRef) => ref.kind === 'server' ? downloadKey(ref) : refKey(ref);
export function positionFor(ref: ServerRef, checkpoint: Position['checkpoint']): Position {
  return { ref, key: refKey(ref), scope: accountKey(ref.account), checkpoint };
}
export function bookView(ref: ServerRef, download?: Download, position?: Position, source?: SourceRow): BookRow {
  return {
    ...positionFor(ref, { position: null, fraction: null }), ...position,
    title: download?.title ?? null, author: download?.author ?? null, cover: download?.cover ?? null,
    pinned: !!download?.pinned, addedAt: download?.addedAt, availability: download ? 'available' : 'unavailable',
    sourceId: download?.sourceId, bytes: null, size: source?.size ?? 0,
    etag: source?.etag, checksum: source?.checksum ?? null, protocolHash: source?.protocolHash ?? null,
  };
}

function usable(source: SourceRow, book: BookRow) {
  if (!source.complete || source.evictOnRelease || source.key !== book.key || source.size !== book.size || !source.manifest || !source.manifestHash) return false;
  const { integrity } = source.manifest;
  if (integrity ? integrity.sha256 !== book.checksum || integrity.protocolHash !== book.protocolHash : !source.manifest.lazy || book.checksum !== null || book.protocolHash !== null) return false;
  const bytes = new TextEncoder().encode(JSON.stringify(source.manifest));
  return bytes.length <= 16 * 1024 * 1024 && bytesToHex(sha256(bytes)) === source.manifestHash;
}

export async function migrateDownloads(tx: Transaction) {
  const books = tx.table<BookRow>('books'), sources = tx.table<SourceRow>('sources');
  const downloads = tx.table<Download>('downloads'), positions = tx.table<Position>('positions');
  const quarantined = new Set<string>();
  const pins = new Set<string>(), winners = new Map<string, { used: number; id: string }>();
  for (const key of await books.toCollection().primaryKeys()) {
    const book = (await books.get(key))!, ref = book.ref;
    // Legacy Scopes - Pre-identity username rows must not become shared library downloads.
    if (ref.kind !== 'server') continue;
    if (book.scope !== accountKey(ref.account) || book.key !== refKey(ref)) { quarantined.add(book.key); continue; }
    await positions.add({ ...positionFor(ref, book.checkpoint), lastReadAt: book.lastReadAt, resumeCandidate: book.resumeCandidate });
    const deviceKey = downloadKey(ref);
    if (book.pinned) pins.add(deviceKey);
    if (book.availability === 'available') {
      let source = book.sourceId ? await sources.get(book.sourceId) : undefined;
      if (source && (!usable(source, book) || (source.blob ? source.blob.size !== book.size :
        await tx.table('sourceChunks').where('sourceId').equals(source.id).count() !== Math.ceil(book.size / sourceLimits.chunkBytes)))) source = undefined;
      if (!source && book.bytes?.size && book.bytes.size === book.size) {
        source = { id: crypto.randomUUID(), key: book.key, complete: true, blob: book.bytes, received: book.size, size: book.size, until: 0, needsIndex: true };
        await sources.add(source);
      }
      if (source) {
        const used = source.needsIndex ? -1 : source.cacheUsedAt ?? 0, winner = winners.get(deviceKey);
        if (!winner || used > winner.used || (used === winner.used && source.id < winner.id)) {
          winners.set(deviceKey, { used, id: source.id });
          await sources.update(source.id, { key: deviceKey, etag: book.etag, checksum: book.checksum, protocolHash: book.protocolHash });
          await downloads.put({ key: deviceKey, library: libraryKey(ref.account), document: ref.documentId, sourceId: source.id,
            title: book.title, author: book.author, cover: book.cover, addedAt: book.addedAt, pinned: false });
          if (winner) await sources.update(winner.id, { evictOnRelease: true });
        } else await sources.update(source.id, { evictOnRelease: true });
      }
    }
    await books.delete(key);
  }
  for (const key of pins) await downloads.update(key, { pinned: true });
  // Retired Sources - Cleanup after commit leaves existing leases intact and avoids rewriting EPUB chunks in the upgrade.
  await sources.filter(s => s.complete && s.key.startsWith('["server",') && !quarantined.has(s.key)).modify({ evictOnRelease: true });
}
