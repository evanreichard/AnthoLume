import { test, expect } from '@playwright/test';
import { installEvents } from './support';

test.beforeEach(async ({ page }) => { await page.goto('/'); await installEvents(page); });

test('complete-book atomic commit/rollback, durable bytes and checkpoint across page and database reopen', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, repo = p.repository;
    const data = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    let failed = false;
    try { await repo.importBook('local', 'interrupted', 'Interrupted', data, true); } catch { failed = true; }
    const afterFailure = [await repo.db.books.count(), await repo.db.checkpoints.count()];
    await repo.importBook('local', 'complete', 'Complete', data);
    await repo.accept('local', 'complete', '/body/DocFragment[2]/body/p[9]');
    return { failed, afterFailure, hash: p.fullMD5(data), bytes: data.byteLength, events: await repo.db.events.count() };
  });
  expect(result.failed).toBe(true); expect(result.afterFailure).toEqual([0, 0]); expect(result.events).toBe(0);
  await page.reload();
  const durable = await page.evaluate(async () => {
    const p = window.proof;
    const book = await p.repository.open('local', 'complete');
    p.repository.db.close();
    const reopened = new p.Repository(new p.ReaderDB());
    const checkpoint = await reopened.db.checkpoints.get(p.bookKey('local', 'complete'));
    const read = await reopened.open('local', 'complete');
    reopened.db.close();
    return { hash: p.fullMD5(await read.bytes.arrayBuffer()), bytes: book.size, ko: checkpoint?.ko, available: book.state };
  });
  expect(durable).toEqual({ hash: result.hash, bytes: result.bytes, ko: '/body/DocFragment[2]/body/p[9]', available: 'available' });
});

test('immutable IDs, atomic checkpoint+event, exact-ID ack, new events during ack and lease fencing', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, r = p.repository, a = p.accountScope('https://server.invalid', 'A');
    await r.signIn(a);
    await r.importBook(a, 'server-partial-md5', 'A', await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    await r.accept(a, 'server-partial-md5', 'first', window.testEvents.progress('server-partial-md5', 'first', 'id-one'));
    let duplicateRejected = false;
    try { await r.accept(a, 'server-partial-md5', 'modified', window.testEvents.progress('server-partial-md5', 'modified', 'id-one')); } catch { duplicateRejected = true; }
    const checkpointAfterDuplicate = (await r.db.checkpoints.toArray())[0];
    const lease = (await r.claim(a, 'tab-one', 100))!;
    const blocked = await r.claim(a, 'tab-two', 101);
    await r.accept(a, 'server-partial-md5', 'newer', window.testEvents.progress('server-partial-md5', 'newer', 'id-two'));
    let unsentRejected = false;
    try { await r.acknowledge(lease, [window.testEvents.receipt('id-two')], 110); } catch { unsentRejected = true; }
    await r.acknowledge(lease, [window.testEvents.receipt('id-one')], 110);
    const afterAck = await r.db.events.toArray();
    if (afterAck.length !== 1 || afterAck[0]?.id !== 'id-two') throw new Error('New event appended during acknowledgement was deleted');
    const oldLease = (await r.claim(a, 'tab-one', 111))!;
    const takeover = (await r.claim(a, 'tab-two', 1112))!;
    let staleRejected = false;
    try { await r.acknowledge(oldLease, [window.testEvents.receipt('id-two')], 1113); } catch { staleRejected = true; }
    let wrongAccountRejected = false;
    try { await r.acknowledge(takeover, [window.testEvents.receipt('id-two')], 1113, p.accountScope('https://server.invalid', 'B')); } catch { wrongAccountRejected = true; }
    await r.acknowledge(takeover, [window.testEvents.receipt('id-two')], 1113);
    return { duplicateRejected, checkpoint: checkpointAfterDuplicate?.ko, blocked: !blocked, unsentRejected, afterAck: afterAck.map(e => e.id), staleRejected, wrongAccountRejected, remaining: await r.db.events.count(), latest: (await r.db.checkpoints.toArray())[0]?.ko };
  });
  expect(result).toEqual({ duplicateRejected: true, checkpoint: 'first', blocked: true, unsentRejected: true, afterAck: ['id-two'], staleRejected: true, wrongAccountRejected: true, remaining: 0, latest: 'newer' });
});

test('two real tabs contend for one transactional lease; a crashed holder expires', async ({ page, context }) => {
  const scope = await page.evaluate(async () => {
    const p = window.proof, a = p.accountScope('https://server.invalid', 'A');
    await p.repository.signIn(a);
    await p.repository.importBook(a, 'book', 'A', await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    await p.repository.accept(a, 'book', 'ko', window.testEvents.progress('book', 'ko'));
    return a;
  });
  const second = await context.newPage(); await second.goto('/');
  const claims = await Promise.all([page.evaluate(scope => window.proof.repository.claim(scope, 'one', 100), scope), second.evaluate(scope => window.proof.repository.claim(scope, 'two', 100), scope)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const winner = claims.find(Boolean)!;
  if (winner.owner === 'one') await page.close(); else await second.close();
  const remaining = winner.owner === 'one' ? second : page;
  expect(await remaining.evaluate(scope => window.proof.repository.claim(scope, 'survivor', 1099), scope)).toBeUndefined();
  const takeover = await remaining.evaluate(scope => window.proof.repository.claim(scope, 'survivor', 1101), scope);
  expect(takeover?.fence).toBeGreaterThan(winner.fence);
});

test('logout retains hidden downloads/paused outbox; account switch, server origin and expired-session offline access', async ({ page, context }) => {
  await page.evaluate(async () => {
    const p = window.proof, r = p.repository;
    const a = p.accountScope('https://server.invalid', 'A');
    const data = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    await r.importBook('local', 'local-book', 'Local', data);
    await r.signIn(a); await r.importBook(a, 'remote-book', 'Private A', data);
    await r.accept(a, 'remote-book', '/body/DocFragment[1]/body/p[3]', window.testEvents.activity('remote-book', 'a-event'));
    await r.expire(a);
  });
  await context.setOffline(true);
  const expired = await page.evaluate(async () => {
    const p = window.proof, r = p.repository, a = p.accountScope('https://server.invalid', 'A');
    const book = await r.open(a, 'remote-book');
    const host = document.createElement('div'); host.style.cssText = 'height:480px;width:700px'; document.body.appendChild(host);
    let readerState = '';
    const reader = new p.ReaderController(host, status => { readerState = status.state; }, async () => { throw new Error('Offline restore must not publish'); });
    await reader.open(await book.bytes.arrayBuffer(), '/body/DocFragment[1]/body/p[3]');
    await reader.dispose(); host.remove();
    return { title: book.title, readerState, events: await r.db.events.count(), claim: await r.claim(a, 'offline', 100) };
  });
  expect(expired).toEqual({ title: 'Private A', readerState: 'ready', events: 1, claim: undefined });
  await context.setOffline(false);
  const result = await page.evaluate(async () => {
    const p = window.proof, r = p.repository, a = p.accountScope('https://server.invalid', 'A'), b = p.accountScope('https://server.invalid', 'B');
    await r.signIn(a);
    const inFlight = (await r.claim(a, 'old-request', 100))!;
    await r.logout(a);
    const logoutVisible = (await r.books(a)).length;
    const retained = await r.db.books.where('scope').equals(a).count();
    let openHidden = false;
    try { await r.open(a, 'remote-book'); } catch { openHidden = true; }
    await r.signIn(b);
    const bVisible = (await r.books(b)).length;
    const aPaused = !await r.claim(a, 'wrong-account', 101);
    let lateAckRejected = false;
    try { await r.acknowledge(inFlight, [window.testEvents.receipt('a-event', 'activity')], 102); } catch { lateAckRejected = true; }
    const localVisible = (await r.books('local')).length;
    const otherOrigin = (await r.books(p.accountScope('https://other.invalid', 'A'))).length;
    await r.signIn(a);
    let oldAckAfterRelogin = false;
    try { await r.acknowledge(inFlight, [window.testEvents.receipt('a-event', 'activity')], 103); } catch { oldAckAfterRelogin = true; }
    const resumed = (await r.claim(a, 'resumed', 104))!;
    const restored = (await r.books(a)).length;
    await r.signIn(b);
    const switchedHidden = (await r.books(a)).length === 0;
    const switchedPaused = !await r.claim(a, 'switched', 105);
    let switchedAckRejected = false;
    try { await r.acknowledge(resumed, [window.testEvents.receipt('a-event', 'activity')], 106); } catch { switchedAckRejected = true; }
    return { logoutVisible, retained, openHidden, bVisible, aPaused, lateAckRejected, localVisible, otherOrigin, oldAckAfterRelogin, resumed: resumed.ids, restored, switchedHidden, switchedPaused, switchedAckRejected, events: await r.db.events.count() };
  });
  expect(result).toEqual({ logoutVisible: 0, retained: 1, openHidden: true, bVisible: 0, aPaused: true, lateAckRejected: true, localVisible: 1, otherOrigin: 0, oldAckAfterRelogin: true, resumed: ['a-event'], restored: 1, switchedHidden: true, switchedPaused: true, switchedAckRejected: true, events: 1 });
});

test('lost-response duplicate delivery credits once; failures keep events; appended event survives exact receipt ack', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, r = p.repository, a = p.accountScope('https://server.invalid', 'A');
    await r.signIn(a);
    await r.importBook(a, 'book', 'A', await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    await r.accept(a, 'book', 'ko-one', window.testEvents.activity('book', 'one'));
    let clock = 100;
    const transport = new p.ReceiptTransportFake();
    const sync = new p.SyncCoordinator(r, transport, 'tab', () => clock);
    transport.dropNextResponse = true;
    const lostResponse = await sync.replay(a);
    const retainedAfterLoss = await r.db.events.count();
    clock = 1101; transport.authenticated = false;
    const unauthorized = await sync.replay(a);
    const paused = await sync.replay(a);
    await r.signIn(a);
    transport.authenticated = true; transport.failStatus = 500;
    const serverError = await sync.replay(a);
    transport.failStatus = undefined; clock = 2202;
    const delayed = new p.SyncCoordinator(r, { send: async (scope, events) => {
      const receipt = transport.send(scope, events);
      await r.accept(a, 'book', 'ko-two', window.testEvents.activity('book', 'two', 20));
      return receipt;
    } }, 'tab', () => clock);
    const acknowledged = await delayed.replay(a);
    return { lostResponse, retainedAfterLoss, unauthorized, paused, serverError, acknowledged, seconds: transport.creditedSeconds, remaining: (await r.db.events.toArray()).map(e => e.id), checkpoint: (await r.db.checkpoints.toArray())[0]?.ko };
  });
  expect(result).toEqual({ lostResponse: 'retryable', retainedAfterLoss: 1, unauthorized: 'auth-required', paused: 'idle-or-paused', serverError: 'retryable', acknowledged: 'acknowledged', seconds: 30, remaining: ['two'], checkpoint: 'ko-two' });
});

test('storage failure never reports a durable checkpoint or partially enqueues event', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.proof, r = p.repository, a = p.accountScope('https://server.invalid', 'A');
    await r.signIn(a); await r.importBook(a, 'book', 'A', await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    const before = await r.db.checkpoints.toArray();
    const hook = () => { throw new DOMException('Injected quota failure', 'QuotaExceededError'); };
    r.db.events.hook('creating', hook);
    let failureName = '';
    try { await r.accept(a, 'book', 'not-saved', window.testEvents.progress('book', 'not-saved')); } catch (error) { failureName = (error as Error).name; }
    r.db.events.hook('creating').unsubscribe(hook);
    return { failureName, before, after: await r.db.checkpoints.toArray(), events: await r.db.events.count() };
  });
  expect(result.failureName).toBe('QuotaExceededError'); expect(result.after).toEqual(result.before); expect(result.events).toBe(0);
});
