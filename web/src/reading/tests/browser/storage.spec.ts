import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!window.readingTest); });
test('atomic complete-book and checkpoint/event transactions reject injected storage failures; integrity differs from KO identity', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`atomic-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'opaque-server-id' };
    await repo.setAccess({ kind: 'authenticated', account });
    const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    const state = { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null };
    const fail = () => { throw new DOMException('Injected quota', 'QuotaExceededError'); };
    repo.db.heads.hook('creating', fail); let importRejected = false;
    try { await repo.install(ref, bytes, 'Book', null, null, state); } catch (error) { importRejected = (error as Error).name === 'QuotaExceededError'; }
    repo.db.heads.hook('creating').unsubscribe(fail); const countAfterFailure = await repo.db.books.count();
    await repo.install(ref, bytes, 'Book', null, null, state);
    repo.db.events.hook('creating', fail); let saveRejected = false;
    try { await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 }); } catch (error) { saveRejected = (error as Error).name === 'QuotaExceededError'; }
    repo.db.events.hook('creating').unsubscribe(fail);
    const saved = await repo.open(ref), checkpoint = saved.row.checkpoint;
    repo.db.close(); await repo.db.open(); const reopened = await repo.open(ref);
    const exact = await p.checksum(reopened.source) === await p.checksum(bytes);
    const changed = new Uint8Array(bytes.slice(0)); changed[0] ^= 1;
    await repo.db.sources.update(saved.row.sourceId!, { blob: new Blob([changed]) }); let integrityRejected = false;
    try { const corrupt = await repo.open(ref); await new p.ArchiveReader(corrupt.source, corrupt.manifest.index).bytes('mimetype'); } catch (error) { integrityRejected = String(error).includes('integrity'); }
    const out = { importRejected, countAfterFailure, saveRejected, checkpoint, events: await repo.db.events.count(), exact, originalID: reopened.row.ref.kind === 'server' && reopened.row.ref.documentId, integrityRejected };
    await repo.db.delete(); return out;
  });
  expect(result).toEqual({ importRejected: true, countAfterFailure: 0, saveRejected: true, checkpoint: { position: null, fraction: null }, events: 0, exact: true, originalID: 'opaque-server-id', integrityRejected: true });
});
test('passive access states leave shared replay and resume intact; logout fences old acknowledgements', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`accounts-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: 'A' }, other = { origin: location.origin, userId: 'B' }, ref = { kind: 'server' as const, account, documentId: 'unchanged-id' }, local = { kind: 'local' as const, localId: 'independent-id' };
    const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(), state = { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null };
    await repo.setAccess({ kind: 'authenticated', account }); await repo.install(ref, bytes, 'Private A', null, null, state); await repo.install(local, bytes, 'Public local', null, null);
    await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 });
    const batch = (await repo.replayBatch(account))!, event = (await repo.pending())[0]!;
    const observer = new p.Repository(new p.ReadingDB(repo.db.name));
    const passive = [];
    for (const access of [{ kind: 'expired', account }, { kind: 'loading' }, { kind: 'anonymous' }] as const) {
      await observer.setAccess(access);
      passive.push({
        books: (await observer.projection(access)).books.map(book => book.title).sort(),
        batch: await repo.replayBatch(account), resume: await repo.resume(),
      });
    }
    await observer.setAccess({ kind: 'logout', account });
    const logout = { books: (await observer.projection({ kind: 'logout', account })).books.map(book => book.title), resume: await repo.resume(), batch: await repo.replayBatch(account) };
    observer.db.close();
    await repo.setAccess({ kind: 'authenticated', account });
    let staleAck = false; try { await repo.acknowledge(batch.access, event, { event_id: event.id, kind: 'progress', revision: '1' }); } catch { staleAck = true; }
    await repo.setAccess({ kind: 'authenticated', account: other }); let denied = false; try { await repo.open(ref); } catch { denied = true; }
    const bBooks = (await repo.projection({ kind: 'authenticated', account: other })).books.map(b => b.title), pending = (await repo.pending()).map(e => e.id);
    await repo.db.delete(); return { account, batch, eventId: event.id, passive, logout, staleAck, denied, bBooks, pending };
  });
  expect(result.batch.ids).toEqual([result.eventId]);
  expect(result.passive).toEqual([
    { books: ['Private A', 'Public local'], batch: result.batch, resume: result.account },
    { books: ['Public local'], batch: result.batch, resume: result.account },
    { books: ['Public local'], batch: result.batch, resume: result.account },
  ]);
  expect(result.logout).toEqual({ books: ['Public local'], resume: null, batch: null });
  expect(result).toMatchObject({ staleAck: true, denied: true, bBooks: ['Public local'], pending: [result.eventId] });
});
test('legacy username rows stay quarantined even when the username equals the active UUID', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`legacy-scope-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: crypto.randomUUID() };
    const ref = { kind: 'server' as const, account, documentId: 'same-document' };
    const local = { kind: 'local' as const, localId: 'unscoped-book' };
    const bytes = await (await fetch('/fixtures/synthetic.epub')).blob();
    await repo.install(local, bytes, 'Local original', null, null);
    const scope = JSON.stringify([account.origin, account.userId]), key = JSON.stringify(['server', scope, ref.documentId]);
    await repo.db.access.add({ key: scope, account, epoch: 1, eligible: true, authenticated: true });
    await repo.db.meta.put({ key: 'resume', value: account });
    await repo.db.books.add({ key, scope, ref, title: 'Unverified legacy cache', author: null, cover: null, availability: 'available', checkpoint: { position: null, fraction: null }, bytes, size: bytes.size, checksum: null, protocolHash: null });
    await repo.db.events.add({ key, scope, id: 'legacy-event', kind: 'progress', created: 1, payload: { event_id: 'legacy-event', document_id: ref.documentId, device_id: 'legacy-device', observed_at: '2026-01-01T00:00:00Z', base_revision: '0', position: '/body/p[1]', fraction: .2 } });
    const legacyResume = await repo.resume();
    await repo.setAccess({ kind: 'authenticated', account });
    const books = (await repo.projection({ kind: 'authenticated', account })).books.map(book => book.title);
    const batch = await repo.replayBatch(account);
    const { source } = await repo.open(local);
    const retained = (await repo.pending()).map(event => event.id);
    await repo.db.delete();
    return { legacyResume, books, batch, localPreserved: source.kind === 'blob' && source.blob.size === bytes.size, retained };
  });
  expect(result).toEqual({ legacyResume: null, books: ['Local original'], batch: null, localPreserved: true, retained: ['legacy-event'] });
});
test('two tabs can read the same batch and apply duplicate receipts without dequeuing or promoting twice', async ({ page, context }) => {
  const name = 'duplicate-replay';
  const seeded = await page.evaluate(async name => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(name));
    const account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'server-doc' };
    const latest = { position: '/body/DocFragment[1]/body/p[3]', fraction: .3 };
    await repo.setAccess({ kind: 'authenticated', account });
    const bytes = await (await fetch('/fixtures/synthetic.epub')).blob();
    const state = { document_id: ref.documentId, revision: '6', position: null, fraction: null, device_id: null, updated_at: null };
    await repo.install(ref, bytes, null, null, null, state);
    await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .1 });
    await repo.save(ref, { position: '/body/DocFragment[1]/body/p[2]', fraction: .2 });
    await repo.save(ref, latest);
    await repo.install(ref, bytes, null, null, null, { ...state, revision: '8' });
    const activityId = crypto.randomUUID(), device = await repo.device(account);
    await repo.credit(ref, { event_id: activityId, document_id: ref.documentId, device_id: device.id, start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: .1, end_fraction: .3 });
    const progressId = (await repo.pending()).find(e => e.kind === 'progress')!.id;
    const key = (await repo.db.books.toArray())[0]!.key;
    repo.db.close();
    return { account, activityId, progressId, key, latest };
  }, name);
  const second = await context.newPage(); await second.goto('/'); await second.waitForFunction(() => !!window.readingTest);
  const read = (tab: import('@playwright/test').Page) => tab.evaluate(async ({ name, account }) => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(name));
    try {
      const batch = (await repo.replayBatch(account))!;
      return { batch, events: await repo.db.events.bulkGet(batch.ids) };
    } finally { repo.db.close(); }
  }, { name, account: seeded.account });
  const [firstRead, secondRead] = await Promise.all([read(page), read(second)]);
  expect([...firstRead.batch.ids].sort()).toEqual([seeded.progressId, seeded.activityId].sort());
  expect(secondRead).toEqual(firstRead);
  const acknowledge = (tab: import('@playwright/test').Page, snapshot: typeof firstRead) => tab.evaluate(async ({ name, snapshot }) => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(name));
    try {
      for (const event of snapshot.events) {
        if (!event) throw new Error('Batch references a missing event');
        await repo.acknowledge(snapshot.batch.access, event, { event_id: event.id, kind: event.kind, revision: event.kind === 'progress' ? '7' : null });
      }
    } finally { repo.db.close(); }
  }, { name, snapshot });
  await Promise.all([acknowledge(page, firstRead), acknowledge(second, secondRead)]);
  const result = await second.evaluate(async ({ name, seeded }) => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(name));
    try {
      const pending = await repo.pending(), next = await repo.replayBatch(seeded.account);
      return {
        pending, next, activityQueued: !!await repo.db.events.get(seeded.activityId), drafts: await repo.db.progressDrafts.count(),
        originalQueued: !!await repo.db.events.get(seeded.progressId),
        checkpoint: (await repo.db.books.get(seeded.key))?.checkpoint,
        headRevision: (await repo.db.heads.get(seeded.key))?.state.revision,
      };
    } finally { await repo.db.delete(); }
  }, { name, seeded });
  const [promoted] = result.pending;
  expect(result.pending).toHaveLength(1);
  expect(promoted!.id).not.toBe(seeded.progressId);
  expect(promoted).toMatchObject({ kind: 'progress', payload: { event_id: promoted!.id, base_revision: '7', ...seeded.latest } });
  expect(result.next).toEqual({ access: firstRead.batch.access, ids: [promoted!.id] });
  expect(result).toMatchObject({ activityQueued: false, drafts: 0, checkpoint: seeded.latest, headRevision: '8' });
  expect(result.originalQueued).toBe(false);
  await second.close();
});

test('explicit expiry invalidates the captured epoch without deleting cached progress', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`expiry-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'server-doc' };
    const checkpoint = { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 };
    await repo.setAccess({ kind: 'authenticated', account });
    const bytes = await (await fetch('/fixtures/synthetic.epub')).blob();
    await repo.install(ref, bytes, 'Cached book', null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
    await repo.save(ref, checkpoint);
    const old = (await repo.replayBatch(account))!, event = (await repo.pending())[0]!;
    const expired = await repo.expire(old.access);
    const expiredEpoch = (await repo.db.access.get(old.access.scope))!.epoch;
    const paused = await repo.replayBatch(account), resume = await repo.resume();
    const retained = (await repo.open(ref)).row.checkpoint;
    await repo.setAccess({ kind: 'authenticated', account });
    const lateExpiry = await repo.expire(old.access);
    const receipt = { event_id: event.id, kind: 'progress', revision: '1' };
    let staleAck = false; try { await repo.acknowledge(old.access, event, receipt); } catch { staleAck = true; }
    const state = { document_id: ref.documentId, revision: '1', position: null, fraction: null, device_id: null, updated_at: null };
    let staleConflict = false; try { await repo.acceptServer(old.access, event, state); } catch { staleConflict = true; }
    const fresh = (await repo.replayBatch(account))!;
    await repo.acknowledge(fresh.access, event, receipt);
    const drained = await repo.replayBatch(account);
    await repo.db.delete();
    return { account, old, expired, expiredEpoch, paused, resume, retained, lateExpiry, staleAck, staleConflict, fresh, drained };
  });
  expect(result).toMatchObject({ expired: true, paused: null, resume: result.account, retained: { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 }, lateExpiry: false, staleAck: true, staleConflict: true, drained: null });
  expect(result.fresh.ids).toEqual(result.old.ids);
  expect(result.fresh.access.scope).toBe(result.old.access.scope);
  expect(result.expiredEpoch).toBeGreaterThan(result.old.access.epoch);
  expect(result.fresh.access.epoch).toBeGreaterThanOrEqual(result.expiredEpoch);
});
test('malformed HTTP 200, valid-looking HTTP 500 and late 401/ack cannot discard or expire fresh-account data', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`receipts-${crypto.randomUUID()}`)), account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'doc' };
    await repo.setAccess({ kind: 'authenticated', account }); const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(); await repo.install(ref, bytes, null, null, null, { document_id: 'doc', revision: '0', position: null, fraction: null, device_id: null, updated_at: null }); await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 });
    const event = (await repo.pending())[0]!; let mode = 'malformed', expired = 0;
    const bridge: ReadingBridge = { registerDevice: async (_, d) => d, getState: async () => { throw new Error('not used'); }, fetchFile: async () => { throw new Error('not used'); }, fetchCover: async () => { throw new Error('not used'); }, submitActivity: async () => { throw new Error('not used'); }, submitProgress: async () => {
      if (mode === 'late401' || mode === 'lateAck') { await repo.setAccess({ kind: 'logout', account }); await repo.setAccess({ kind: 'authenticated', account }); }
      return mode === 'late401' ? { status: 401, body: { type: 'about:blank', title: 'Expired', status: 401, code: 'unauthenticated', detail: 'Expired' } } : { status: mode === '500' ? 500 : 200, body: { event_id: mode === 'malformed' ? 'wrong-id' : event.id, kind: 'progress', revision: '1' } };
    } };
    const replay = new p.Replay(repo, bridge, () => {}, () => { expired++; }); const counts = [];
    for (mode of ['malformed', '500', 'late401', 'lateAck']) { await replay.run(account); counts.push((await repo.pending()).length); }
    await repo.clearServerCache(); const survivesClear = await repo.pending();
    repo.db.close(); await repo.db.open(); const output = { counts, expired, survivesClear, survivesReopen: await repo.pending(), event, authenticated: (await repo.db.access.toArray())[0]!.authenticated }; await repo.db.delete(); return output;
  });
  const { event, ...outcomes } = result;
  expect(outcomes).toEqual({ counts: [1, 1, 1, 1], expired: 0, survivesClear: [event], survivesReopen: [event], authenticated: true });
});
