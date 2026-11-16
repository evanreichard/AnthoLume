import { test, expect } from '@playwright/test';
import { installEvents } from './support';

test.beforeEach(async ({ page }) => { await page.goto('/'); await installEvents(page); });

for (const transition of ['relogin', 'takeover']) test(`late 401 after ${transition} cannot expire the current session or lease`, async ({ page }) => {
  const result = await page.evaluate(async transition => {
    const p = window.proof, r = p.repository, scope = p.accountScope('https://server.invalid', 'A');
    await r.signIn(scope); await r.importBook(scope, 'book', 'Book', await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    await r.accept(scope, 'book', 'saved', window.testEvents.progress('book', 'saved', 'event'));
    let clock = 100;
    let reply!: (value: { status: 401; scope: typeof scope }) => void;
    let entered!: () => void;
    const sending = new Promise<void>(resolve => { entered = resolve; });
    const sync = new p.SyncCoordinator(r, { send: () => new Promise(resolve => { reply = resolve; entered(); }) }, 'old-session', () => clock);
    const pending = sync.replay(scope); await sending;
    if (transition === 'relogin') { await r.logout(scope); await r.signIn(scope); clock = 101; }
    else clock = 1101;
    const fresh = await r.claim(scope, 'fresh-session', clock);
    const before = await r.db.access.get(scope);
    reply({ status: 401, scope });
    const outcome = await pending;
    return { outcome, fresh: !!fresh, sameAccess: JSON.stringify(await r.db.access.get(scope)) === JSON.stringify(before), sameLease: JSON.stringify(await r.db.leases.get(scope)) === JSON.stringify(fresh), authenticated: (await r.db.access.get(scope))?.authenticated, pending: await r.db.events.count() };
  }, transition);
  expect(result).toEqual({ outcome: 'idle-or-paused', fresh: true, sameAccess: true, sameLease: true, authenticated: true, pending: 1 });
});

test('concurrent and subsequent open reject; repeated disposal releases the single engine', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    const reader = new p.ReaderController(host, () => {}, async () => {});
    const first = reader.open(bytes);
    const concurrent = reader.open(bytes).then(() => false, () => true);
    await first;
    const subsequent = await reader.open(bytes).then(() => false, () => true);
    const frames = host.querySelectorAll('iframe').length;
    await Promise.all([reader.dispose(), reader.dispose()]);
    const afterDispose = await reader.open(bytes).then(() => false, () => true);
    const remaining = host.querySelectorAll('iframe').length; host.remove();
    return { concurrent: await concurrent, subsequent, afterDispose, frames, remaining, ...p.lifecycle };
  });
  expect(result).toEqual({ concurrent: true, subsequent: true, afterDispose: true, frames: 1, remaining: 0, created: 1, disposed: 1, engines: 1, destroyed: 1, listeners: 0, contentListeners: 0 });
});

test('nested KO reads use legacy child-axis first, whole-path fallback only on miss; contradictory writer refuses a false round trip', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, bytes = await (await fetch('/fixtures/nested.epub')).arrayBuffer();
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    const saved = '/body/DocFragment[1]/body/div[1]/p[2]';
    let restored = ''; let published = 0;
    const reader = new p.ReaderController(host, status => { restored = status.location?.ko || ''; }, async () => { published++; });
    await reader.open(bytes, saved);
    const doc = host.querySelector('iframe')!.contentDocument!;
    const childFirst = p.elementFromKO(doc, saved).id;
    const fallback = p.elementFromKO(doc, '/body/DocFragment[1]/body/div[1]/p[3]').id;
    const figureChild = p.elementFromKO(doc, '/body/DocFragment[1]/body/div[2]/p[2]').id;
    const figureFallback = p.elementFromKO(doc, '/body/DocFragment[1]/body/div[2]/p[3]').id;
    const conflicts: string[] = [];
    for (const id of ['first', 'figure-first']) {
      try { p.koFromElement(0, doc.getElementById(id)!); } catch (error) { conflicts.push(String(error)); }
    }
    const readableWriterPath = p.koFromElement(0, doc.getElementById('second')!);
    await reader.dispose(); host.remove();
    return { childFirst, fallback, figureChild, figureFallback, restored, saved, published, conflicts, readableWriterPath };
  });
  expect(result.childFirst).toBe('second'); expect(result.fallback).toBe('second');
  expect(result.figureChild).toBe('figure-second'); expect(result.figureFallback).toBe('figure-second');
  expect(result.restored).toBe(result.saved); expect(result.published).toBe(0);
  expect(result.conflicts).toHaveLength(2); expect(result.conflicts.every(message => message.includes('writer/reader disagree'))).toBe(true);
  expect(result.readableWriterPath).toBe('/body/DocFragment[1]/body/div[1]/p[3]');
});

test('stale API-shaped progress traverses durable outbox and SyncCoordinator and ends blocked, not acknowledged', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, r = p.repository, scope = p.accountScope('https://server.invalid', 'A');
    await r.signIn(scope); await r.importBook(scope, 'book', 'Book', await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    const transport = new p.ReceiptTransportFake();
    const initial = transport.progress(scope, 'book').read().revision;
    transport.progress(scope, 'book').propose({ ko: 'server', fraction: 0.8 }, '0');
    await r.accept(scope, 'book', 'local', window.testEvents.progress('book', 'local', 'stale', '0'));
    const before = await r.db.events.toArray();
    const outcome = await new p.SyncCoordinator(r, transport, 'tab', () => 100).replay(scope);
    const after = await r.db.events.toArray();
    return { initial, outcome, sameEvents: JSON.stringify(before) === JSON.stringify(after), head: transport.progress(scope, 'book').read(), checkpoint: (await r.db.checkpoints.toArray())[0]?.ko, receiptCount: transport.receipts.size };
  });
  expect(result).toEqual({ initial: '0', outcome: 'blocked', sameEvents: true, head: { ko: 'server', fraction: 0.8, revision: '1' }, checkpoint: 'local', receiptCount: 0 });
});

test('valid API progress retries its original receipt after head advance and acknowledges through the coordinator', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, r = p.repository, scope = p.accountScope('https://server.invalid', 'A');
    await r.signIn(scope); await r.importBook(scope, 'book', 'Book', await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    await r.accept(scope, 'book', 'local', window.testEvents.progress('book', 'local', 'identified', '0'));
    const event = (await r.db.events.toArray())[0]!;
    const transport = new p.ReceiptTransportFake(); let clock = 100;
    const sync = new p.SyncCoordinator(r, transport, 'tab', () => clock);
    transport.dropNextResponse = true;
    const lost = await sync.replay(scope);
    transport.progress(scope, 'book').propose({ ko: 'other-device', fraction: 0.9 }, '1');
    clock = 1101;
    const acknowledged = await sync.replay(scope);
    return { lost, acknowledged, fields: Object.keys(event.payload).sort(), pending: await r.db.events.count(), head: transport.progress(scope, 'book').read(), checkpoint: (await r.db.checkpoints.toArray())[0]?.ko };
  });
  expect(result).toEqual({ lost: 'retryable', acknowledged: 'acknowledged', fields: ['base_revision', 'device_id', 'document_id', 'event_id', 'fraction', 'observed_at', 'position'], pending: 0, head: { ko: 'other-device', fraction: 0.9, revision: '2' }, checkpoint: 'local' });
});

test('malformed/wrong-ID/kind/revision receipts cannot delete durable events through coordinator or repository', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, scope = p.accountScope('https://server.invalid', 'A');
    const good = window.testEvents.receipt('event');
    const cases: unknown[] = [null, [], ['event'], [{ ...good, event_id: 'other' }], [{ ...good, kind: 'activity' }], [{ ...good, revision: 1 }], [{ ...good, revision: '0' }], [{ ...good, revision: '01' }], [{ ...good, revision: '9999999999999999999' }], [{ ...good, revision: null }], [{ event_id: 'event', kind: 'progress' }], [{ ...good, revision: '2' }], [good, good], [{ ...good, extra: true }], [{ event_id: 'event', kind: 'activity', revision: '1' }]];
    const outcomes: string[] = []; let rejected = 0, retained = 0;
    for (let i = 0; i < cases.length; i++) {
      const dbName = `review-receipts-${i}`, r = new p.Repository(new p.ReaderDB(dbName));
      await r.signIn(scope); await r.importBook(scope, 'book', 'Book', await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
      const event = i === cases.length - 1 ? window.testEvents.activity('book', 'event') : window.testEvents.progress('book', 'saved', 'event');
      await r.accept(scope, 'book', 'saved', event);
      const receipts = cases[i];
      outcomes.push(await new p.SyncCoordinator(r, { send: () => ({ status: 200, scope, receipts }) }, 'tab', () => 100).replay(scope));
      const lease = (await r.db.leases.get(scope))!;
      try { await r.acknowledge(lease, receipts, 101); } catch { rejected++; }
      r.db.close();
      const reopened = new p.ReaderDB(dbName);
      retained += await reopened.events.count();
      await reopened.delete();
    }
    return { cases: cases.length, outcomes, rejected, retained };
  });
  expect(result.outcomes).toEqual(Array(result.cases).fill('blocked'));
  expect(result.rejected).toBe(result.cases); expect(result.retained).toBe(result.cases);
});
