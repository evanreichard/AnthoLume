import Dexie from 'dexie';
import { accountKey, refKey } from '../types';
import { checksum } from '../repository';
import { validateEPUB } from '../content-policy';

export function legacyLibrary(name: string, version: 5 | 6) {
  const db = new Dexie(name);
  db.version(version).stores({ books: '&key,scope', events: '&id,scope,key,created', access: '&key', heads: '&key', meta: '&key',
    sources: '&id,key,complete,until', sourceChunks: '&key,sourceId', progressDrafts: '&key',
    ...(version === 6 && { offline: '&id,scope,[scope+document+kind]' }) });
  return db;
}

export async function seedLegacyLibrary(name: string, version: 5 | 6) {
  const db = legacyLibrary(name, version);
  const fixture = await (await fetch('/fixtures/synthetic.epub')).blob();
  const policy = await validateEPUB(fixture);
  try {
    const manifest = policy.manifest, manifestHash = await checksum(new Blob([JSON.stringify(manifest)]));
    const bytes = await fixture.arrayBuffer();
    const fingerprint = { checksum: manifest.integrity!.sha256, protocolHash: manifest.integrity!.protocolHash };
    for (const [i, userId] of ['alice', 'bob'].entries()) {
      const account = { origin: location.origin, userId, readingGeneration: 'g1' };
      const ref = { kind: 'server' as const, account, documentId: 'doc' }, scope = accountKey(account), key = refKey(ref);
      const checkpoint = { position: `/body/DocFragment[1]/body/p[${i + 1}]`, fraction: .1 + .1 * i };
      const sourceId = `source-${userId}`;
      await db.table('books').add({ key, scope, ref, checkpoint, availability: 'available', sourceId, size: fixture.size, bytes: null, ...fingerprint,
        title: `Book ${userId}`, author: null, cover: null, ...(version === 6 && { pinned: i === 0 }), etag: `"${userId}"` });
      await db.table('sources').add({ id: sourceId, key, size: fixture.size, received: fixture.size, blob: null, complete: true, until: 0, manifest, manifestHash,
        cacheUsedAt: i, ...(i === 0 && { cacheReaders: { oldTab: Date.now() + 900_000 } }) });
      await db.table('sourceChunks').add({ key: sourceId + ':0', sourceId, data: bytes });
      await db.table('access').add({ key: scope, account, epoch: 1, authenticated: true, eligible: true });
      const activity = { event_id: `event-${userId}`, document_id: 'doc', device_id: userId, start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: 0, end_fraction: .1 };
      await db.table('events').add({ id: activity.event_id, kind: 'activity', scope, key, created: 1, payload: activity });
      if (version === 6 && i === 0) await db.table('offline').add({ id: 'alice-draft', kind: 'progress', scope, document: 'doc', title: 'Book', created: activity.start_time,
        checkpoint: { position: '/body/DocFragment[1]/body/p[3]', fraction: .3 } });
    }
    const ref = { kind: 'local' as const, localId: 'only-here' };
    await db.table('books').add({ ref, key: refKey(ref), scope: 'local', title: 'Personal book', author: null, cover: null, bytes: fixture, size: fixture.size,
      availability: 'available', checkpoint: { position: null, fraction: null }, ...fingerprint });
  } finally { policy.dispose(); db.close(); }
}
