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
test('account expiry permits offline real-engine opening; loading/logout/B hide A and fence old acknowledgements', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`accounts-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: 'A' }, other = { origin: location.origin, userId: 'B' }, ref = { kind: 'server' as const, account, documentId: 'unchanged-id' }, local = { kind: 'local' as const, localId: 'independent-id' };
    const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(), state = { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null };
    await repo.setAccess({ kind: 'authenticated', account }); await repo.install(ref, bytes, 'Private A', null, null, state); await repo.install(local, bytes, 'Public local', null, null);
    await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 });
    const lease = (await repo.claim(account, 'old-tab'))!, event = (await repo.pending())[0]!;
    await repo.setAccess({ kind: 'expired', account }); const expiredBooks = (await repo.projection({ kind: 'expired', account })).length, paused = await repo.claim(account, 'expiry');
    const opened = await repo.open(ref), host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host); let stateName = '';
    const reader = new p.ReaderController(host, value => { stateName = value.state; }, async () => {}); await reader.open(opened.source, undefined, undefined, opened.manifest); await reader.dispose(); host.remove();
    await repo.setAccess({ kind: 'loading' }); const loadingBooks = (await repo.projection({ kind: 'loading' })).length, resumeAfterLoading = await repo.resume();
    await repo.setAccess({ kind: 'logout', account }); const logoutBooks = (await repo.projection({ kind: 'logout', account })).length, resumeAfterLogout = await repo.resume();
    await repo.setAccess({ kind: 'authenticated', account }); let staleAck = false; try { await repo.acknowledge(lease, event, { event_id: event.id, kind: 'progress', revision: '1' }); } catch { staleAck = true; }
    await repo.setAccess({ kind: 'authenticated', account: other }); let denied = false; try { await repo.open(ref); } catch { denied = true; }
    const bBooks = (await repo.projection({ kind: 'authenticated', account: other })).map(b => b.title), pending = (await repo.pending()).length;
    await repo.db.delete(); return { expiredBooks, paused, stateName, loadingBooks, resumeAfterLoading, logoutBooks, resumeAfterLogout, staleAck, denied, bBooks, pending };
  });
  expect(result).toMatchObject({ expiredBooks: 2, paused: null, stateName: 'ready', loadingBooks: 1, resumeAfterLoading: { userId: 'A' }, logoutBooks: 1, resumeAfterLogout: null, staleAck: true, denied: true, bBooks: ['Public local'], pending: 1 });
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
    const books = (await repo.projection({ kind: 'authenticated', account })).map(book => book.title);
    const lease = await repo.claim(account, 'current-reader');
    const original = await repo.exportLocal(local);
    const retained = (await repo.pending()).map(event => event.id);
    await repo.db.delete();
    return { legacyResume, books, lease, localPreserved: original.size === bytes.size, retained };
  });
  expect(result).toEqual({ legacyResume: null, books: ['Local original'], lease: null, localPreserved: true, retained: ['legacy-event'] });
});
test('real two-tab lease competition and fenced takeover reject stale holder without losing pending events', async ({ page, context }) => {
  const name = `two-tabs-${Date.now()}`;
  await page.evaluate(async name => { const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(name)), account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'server-doc' }; await repo.setAccess({ kind: 'authenticated', account }); const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(); await repo.install(ref, bytes, null, null, null, { document_id: 'server-doc', revision: '0', position: null, fraction: null, device_id: null, updated_at: null }); await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .1 }); repo.db.close(); }, name);
  const second = await context.newPage(); await second.goto('/'); await second.waitForFunction(() => !!window.readingTest);
  const claim = async (tab: import('@playwright/test').Page, owner: string) => tab.evaluate(async ({ name, owner }) => { const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(name)); const lease = await repo.claim({ origin: location.origin, userId: 'A' }, owner); repo.db.close(); return lease; }, { name, owner });
  const claims = await Promise.all([claim(page, 'one'), claim(second, 'two')]); expect(claims.filter(Boolean)).toHaveLength(1);
  const old = claims.find(Boolean)!;
  await page.evaluate(async name => { const db = new window.readingTest.ReadingDB(name), leases = await db.leases.toArray(); await db.leases.put({ ...leases[0]!, until: Date.now() - 1 }); db.close(); }, name);
  const takeover = await claim(second, 'takeover'); expect(takeover!.fence).toBeGreaterThan(old.fence);
  const rejected = await page.evaluate(async ({ name, old }) => { const repo = new window.readingTest.Repository(new window.readingTest.ReadingDB(name)); const event = (await repo.pending())[0]!; let rejected = false; try { await repo.acknowledge(old, event, { event_id: event.id, kind: 'progress', revision: '1' }); } catch { rejected = true; } const pending = (await repo.pending()).length; await repo.db.delete(); return { rejected, pending }; }, { name, old });
  expect(rejected).toEqual({ rejected: true, pending: 1 }); await second.close();
});
test('progress conflicts do not block activity; exact receipt replay, durable explicit choices/history, late changes conflict again', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`conflicts-${crypto.randomUUID()}`)), account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'server-original' };
    await repo.setAccess({ kind: 'authenticated', account }); const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    await repo.install(ref, bytes, 'A book', null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
    const device = await repo.device(account);
    const realNow = Date.now; let eventClock = realNow(); Date.now = () => ++eventClock;
    try { await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 }, { event_id: crypto.randomUUID(), document_id: ref.documentId, device_id: device.id, start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: .1, end_fraction: .2 }); } finally { Date.now = realNow; }
    const calls: string[] = [];
    let revision = '1', registered = false, activityCredits = 0, progressWrites = 0, dropActivity = true;
    const ledger = new Map<string, unknown>();
    const state = () => ({ document_id: ref.documentId, revision, position: '/body/DocFragment[1]/body/p[2]', fraction: .8, device_id: 'KO-device', updated_at: '2026-01-01T00:00:00Z' });
    const bridge: ReadingBridge = {
      registerDevice: async (_, d) => { registered = true; return d; }, getState: async () => { calls.push('state'); return state(); }, fetchFile: async () => { throw new Error('not used'); }, fetchCover: async () => { throw new Error('not used'); },
      submitProgress: async (_, event) => { calls.push('progress'); if (!registered) throw new Error('device must register before writes'); progressWrites++; return { status: 409, body: { type: 'about:blank', title: 'Conflict', status: 409, code: 'progress_conflict', detail: 'KO changed', current_revision: revision } }; },
      submitActivity: async (_, event) => { calls.push('activity'); if (!registered) throw new Error('device must register before writes'); if (!ledger.has(event.event_id)) { activityCredits += event.duration; ledger.set(event.event_id, { event_id: event.event_id, kind: 'activity', revision: null }); } if (dropActivity) { dropActivity = false; throw new Error('lost after commit'); } return { status: 200, body: ledger.get(event.event_id) }; },
    };
    const replay = new p.Replay(repo, bridge, () => {}, () => {}); await replay.run(account); const firstCalls = [...calls]; await replay.run(account);
    const conflict = (await repo.db.conflicts.toArray())[0]!;
    const pendingAfterCredit = (await repo.pending()).length, decisionsAfterCredit = await repo.db.decisions.count();
    repo.db.close(); await repo.db.open();
    const access = (await repo.db.access.get(JSON.stringify(['account', location.origin, 'A'])))!;
    await repo.refreshConflict(conflict.eventId, state(), access.epoch); await repo.resolve(conflict.eventId, 'local', revision);
    const replacement = (await repo.pending())[0]!, freshID = replacement.id !== conflict.eventId;
    revision = '2'; await replay.run(account); const again = (await repo.db.conflicts.toArray())[0]!;
    let staleChoiceRejected = false; try { await repo.resolve(again.eventId, 'server', '1'); } catch { staleChoiceRejected = true; }
    await repo.refreshConflict(again.eventId, state(), access.epoch); await repo.resolve(again.eventId, 'server', '2');
    await repo.remove(ref);
    const output = { firstCalls, registered, activityCredits, progressWrites, pendingAfterCredit, decisionsAfterCredit, freshID, replacementBase: replacement.kind === 'progress' && replacement.payload.base_revision, again: again.server!.revision, staleChoiceRejected, history: await repo.db.history.count(), immutableEvents: await repo.db.events.count(), pending: (await repo.pending()).length, available: (await repo.db.books.toArray())[0]!.availability };
    await repo.db.delete(); return output;
  });
  expect(result).toEqual({ firstCalls: ['progress', 'state', 'activity'], registered: true, activityCredits: 30, progressWrites: 2, pendingAfterCredit: 1, decisionsAfterCredit: 1, freshID: true, replacementBase: '1', again: '2', staleChoiceRejected: true, history: 2, immutableEvents: 3, pending: 0, available: 'unavailable' });
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
    await repo.remove(ref); const survivesRemoval = (await repo.pending()).length;
    repo.db.close(); await repo.db.open(); const output = { counts, expired, survivesRemoval, survivesReopen: (await repo.pending()).length, authenticated: (await repo.db.access.toArray())[0]!.authenticated }; await repo.db.delete(); return output;
  });
  expect(result).toEqual({ counts: [1, 1, 1, 1], expired: 0, survivesRemoval: 1, survivesReopen: 1, authenticated: true });
});
