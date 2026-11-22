import { expect, test } from '@playwright/test';
import type { ReadingBridge, S } from '../../types';
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!window.readingTest); });

test('manifest corruption cannot self-attest; explicit identical-original repair retains checkpoint/events and monotone revisions', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`source-repair-${crypto.randomUUID()}`)), account = { origin: location.origin, userId: 'same-account' }, ref = { kind: 'server' as const, account, documentId: 'same-original-server' }, file = await (await fetch('/fixtures/synthetic.epub')).blob();
    await repo.setAccess({ kind: 'authenticated', account }); const state = (revision: string) => ({ document_id: ref.documentId, revision, position: 'opaque-server-position', fraction: .7, device_id: 'server-device', updated_at: null });
    await repo.install(ref, file, null, null, null, state('0')); const first = await repo.open(ref), source = await repo.db.sources.get(first.row.sourceId!), saved = { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }; await repo.save(ref, saved); const event = (await repo.pending())[0]!;
    await repo.db.sources.update(source!.id, { manifest: { ...source!.manifest!, title: 'corrupt metadata' } }); let corruptRejected = false, missingRejected = false;
    try { await repo.open(ref); } catch (error) { corruptRejected = String(error).includes('integrity'); }
    await repo.db.sources.update(source!.id, { manifestHash: undefined }); try { await repo.open(ref); } catch (error) { missingRejected = String(error).includes('integrity'); }
    const didNotSelfAttest = !(await repo.db.sources.get(source!.id))!.manifestHash;
    const heads = []; for (const revision of ['9', '10', '2']) { await repo.install(ref, file, null, null, null, state(revision)); heads.push((await repo.db.heads.get(first.row.key))!.state.revision); }
    const metadataRepaired = await repo.open(ref), reused = metadataRepaired.row.sourceId === first.row.sourceId;
    const bytes = new Uint8Array(await file.arrayBuffer()); bytes[0] ^= 1; await repo.db.sources.update(source!.id, { blob: new Blob([bytes]) });
    await repo.install(ref, file, null, null, null, state('1')); const repaired = await repo.open(ref); await new p.ArchiveReader(repaired.source, repaired.manifest.index).bytes('mimetype');
    const output = { corruptRejected, missingRejected, didNotSelfAttest, heads, reused, replacedDamaged: repaired.row.sourceId !== first.row.sourceId, shaUnchanged: repaired.row.checksum === first.row.checksum, koHashUnchanged: repaired.row.protocolHash === first.row.protocolHash, checkpoint: repaired.row.checkpoint, eventUnchanged: JSON.stringify((await repo.pending())[0]) === JSON.stringify(event), sourceCount: await repo.db.sources.count(), eventCount: await repo.db.events.count() }; await repo.db.delete(); return output;
  });
  expect(result).toEqual({ corruptRejected: true, missingRejected: true, didNotSelfAttest: true, heads: ['9', '10', '10'], reused: true, replacedDamaged: true, shaUnchanged: true, koHashUnchanged: true, checkpoint: { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }, eventUnchanged: true, sourceCount: 1, eventCount: 1 });
});

test('native v1 upgrade preserves the book and checkpoint and holds unacknowledged activity for its owner to review', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, name = `native-v1-${crypto.randomUUID()}`, account = { origin: location.origin, userId: 'legacy-account' }, scope = JSON.stringify(['account', location.origin, 'legacy-account']), ref = { kind: 'server' as const, account, documentId: 'legacy-server-id' }, key = JSON.stringify(['server', scope, 'legacy-server-id']), file = await (await fetch('/fixtures/synthetic.epub')).blob(), integrity = await p.hashSource(p.blobSource(file));
    const checkpoint = { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }, event = { id: 'legacy-interval', key, scope, created: 1, interval: { id: 'legacy-interval', startMs: 1000, endMs: 31000 }, kind: 'activity', payload: { event_id: 'legacy-interval', document_id: ref.documentId, device_id: 'legacy-device', start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: .1, end_fraction: .2 } }, access = { key: scope, account, epoch: 7, eligible: true, authenticated: true }, lease = { scope, owner: 'legacy-tab', fence: 9, epoch: 7, until: Date.now() + 30000, ids: [event.id] };
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open(name, 10); r.onerror = () => reject(r.error); r.onupgradeneeded = () => { const schema: Record<string, [string, string[]]> = { books: ['key', ['scope']], events: ['id', ['scope', 'key', 'created']], access: ['key', []], leases: ['scope', []], decisions: ['id', []], conflicts: ['eventId', ['scope', 'key']], heads: ['key', []], meta: ['key', []], history: ['id', ['eventId']] }; for (const [name, [keyPath, indexes]] of Object.entries(schema)) { const store = r.result.createObjectStore(name, { keyPath }); for (const index of indexes) store.createIndex(index, index); } }; r.onsuccess = () => { const db = r.result, tx = db.transaction(['books', 'events', 'access', 'leases', 'decisions'], 'readwrite'); tx.objectStore('books').add({ key, scope, ref, title: null, author: null, cover: null, checkpoint, availability: 'available', bytes: file, checksum: integrity.sha256, protocolHash: integrity.protocolHash, size: file.size }); tx.objectStore('events').add(event); tx.objectStore('events').add({ ...event, id: 'completed-event', created: 0 }); tx.objectStore('decisions').add({ id: 'completed-event', outcome: 'receipt' }); tx.objectStore('access').add(access); tx.objectStore('leases').add(lease); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; });
    const repo = new p.Repository(new p.ReadingDB(name)), opened = await repo.open(ref), drafts = await repo.db.offline.toArray(), afterAccess = await repo.db.access.get(scope);
    const output = { migrated: !!opened.row.sourceId && opened.row.bytes === null, checkpoint: opened.row.checkpoint, sourceComplete: (await repo.db.sources.get(opened.row.sourceId!))!.complete, hashUnchanged: opened.row.checksum === integrity.sha256 && opened.row.protocolHash === integrity.protocolHash, originalID: opened.row.ref.kind === 'server' && opened.row.ref.documentId, drafts: drafts.map(draft => ({ scope: draft.scope, id: draft.id, event: draft.kind === 'activity' ? draft.event : null })), accessUnchanged: JSON.stringify(afterAccess) === JSON.stringify(access), legacyStoresRemoved: !['leases', 'decisions'].some(store => repo.db.backendDB().objectStoreNames.contains(store)), completedRemoved: !await repo.db.events.get('completed-event'), batch: await repo.replayBatch(account) };
    await repo.db.delete(); return output;
  });
  expect(result).toEqual({ migrated: true, checkpoint: { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }, sourceComplete: true, hashUnchanged: true, originalID: 'legacy-server-id', drafts: [{ scope: JSON.stringify(['account', new URL(page.url()).origin, 'legacy-account']), id: 'legacy-interval', event: { event_id: 'legacy-interval', document_id: 'legacy-server-id', device_id: 'legacy-device', start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: .1, end_fraction: .2 } }], accessUnchanged: true, legacyStoresRemoved: true, completedRemoved: true, batch: null });
});

test('real streamed runtime preserves server identity and caches the original without fetching a cover', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, file = await (await fetch('/fixtures/synthetic.epub')).blob(), zip = await p.JSZip.loadAsync(await file.arrayBuffer()), pixel = await zip.file('pixel.png')!.async('uint8array'); new DataView(pixel.buffer, pixel.byteOffset, pixel.byteLength).setUint32(16, 8192); new DataView(pixel.buffer, pixel.byteOffset, pixel.byteLength).setUint32(20, 8192);
    const account = { origin: location.origin, userId: 'runtime-original' }, document: S['Document'] = { id: 'original-server-id', title: null, author: null, series: null, description: null, lang: null, file_available: true, cover_available: true, media_type: 'application/epub+zip', file_size_bytes: file.size }, calls: string[] = [];
    const noWrite = async () => { throw new Error('A download never writes activity or progress'); }, bridge: ReadingBridge = { getState: async (_, id) => { calls.push(id); return { document_id: id, revision: '0', position: '/body/DocFragment[1]/body/h1', fraction: .12345, device_id: null, updated_at: null }; }, fetchFile: async (_, id) => { calls.push(id); return new Response(file, { headers: { 'Content-Type': 'application/epub+zip', 'Content-Length': String(file.size) } }); }, fetchCover: async () => new Response(new Uint8Array(pixel), { headers: { 'Content-Type': 'image/png' } }), registerDevice: async (_, device) => device, submitActivity: noWrite, submitProgress: noWrite };
    const runtime = new p.ReadingRuntime(bridge, () => {}, () => {}); await runtime.start({ kind: 'authenticated', account }); const ref = { kind: 'server' as const, account, documentId: document.id }, abort = new AbortController(), opened = await runtime.openServerBook(ref, abort.signal), output = { ref, calls, checkpoint: opened.row.checkpoint, available: opened.row.availability, cover: opened.row.cover, sourceKind: opened.source.kind, chunks: await runtime.repo.db.sourceChunks.count(), events: await runtime.repo.db.events.count(), writers: p.stagingWorkers.active }; abort.abort(); runtime.dispose(); await runtime.repo.db.delete(); return output;
  });
  expect(result).toMatchObject({ ref: { kind: 'server', documentId: 'original-server-id' }, calls: ['original-server-id', 'original-server-id'], checkpoint: { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }, available: 'available', cover: null, sourceKind: 'idb', events: 0, writers: 0 }); expect(result.chunks).toBeGreaterThan(0);
});

test('an oversized WebKit-style fetch chunk is staged without transferring an oversized buffer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`coalesced-${crypto.randomUUID()}`));
    const size = 9 * 1024 * 1024 + 123, bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    try {
      const row = await repo.stageStream({ kind: 'local', localId: 'coalesced' }, stream);
      const expected = await p.hashSource(p.blobSource(new Blob([bytes])));
      const actual = await p.hashSource({ kind: 'idb', database: repo.db.name, id: row.id, size: row.size });
      return { size: row.size, same: actual.sha256 === expected.sha256 };
    } finally { await repo.db.delete(); }
  });
  expect(result).toEqual({ size: 9 * 1024 * 1024 + 123, same: true });
});

test('expired-source deletion rechecks renewed lease; local staging abort and locked stream leave no partial records', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`source-lease-${crypto.randomUUID()}`)), ref = { kind: 'local' as const, localId: 'staged' }, stage = await repo.stageBlob(ref, new Blob(['bounded incomplete'])) ;
    await repo.discardSource(stage.id, true); const renewedRetained = !!await repo.db.sources.get(stage.id); await repo.db.sources.update(stage.id, { until: Date.now() - 1 }); await repo.cleanupStages(); const expiredRemoved = !await repo.db.sources.get(stage.id);
    const controller = new AbortController(), abort = () => controller.abort(); repo.db.sources.hook('creating', abort); let blobAborted = false;
    try { await repo.stageBlob(ref, new Blob(['cancel native staging']), controller.signal); } catch (error) { blobAborted = (error as Error).name === 'AbortError'; } repo.db.sources.hook('creating').unsubscribe(abort);
    const stream = new Blob(['locked']).stream(), reader = stream.getReader(); let lockedRejected = false; try { await repo.stageStream(ref, stream); } catch { lockedRejected = true; } await reader.cancel(); reader.releaseLock();
    const out = { renewedRetained, expiredRemoved, blobAborted, lockedRejected, sources: await repo.db.sources.count(), chunks: await repo.db.sourceChunks.count(), books: await repo.db.books.count() }; await repo.db.delete(); return out;
  });
  expect(result).toEqual({ renewedRetained: true, expiredRemoved: true, blobAborted: true, lockedRejected: true, sources: 0, chunks: 0, books: 0 });
});
