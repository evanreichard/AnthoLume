import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import type {} from '../src/main';

const bookHash = createHash('sha256').update(await readFile(new URL('../../reader-storage/public/fixtures/synthetic.epub', import.meta.url))).digest('hex');

test('same-origin signed cookie, nullable generated list, exact EPUB bytes and real CSRF denial', async ({ page, context, fixtureServer }) => {
  const anonymous = await page.evaluate(async () => {
    const response = await fetch('/api/v1/documents');
    return { status: response.status, media: response.headers.get('Content-Type'), problem: await response.json() };
  });
  expect(anonymous.status).toBe(401); expect(anonymous.media).toBe('application/problem+json'); expect(anonymous.problem.code).toBe('unauthenticated');
  const loaded = await page.evaluate(async key => { await window.integration.boot(key); return window.integration.loadBook(); }, fixtureServer.key);
  expect(loaded.list.items[0]).toEqual({ id: 'book-a', title: null, author: 'Synthetic Author' });
  expect(loaded.list.total).toBe(2); expect(loaded.sha256).toBe(bookHash); expect(loaded.bytes).toBeGreaterThan(0);
  expect(loaded.disposition).toBe('attachment; filename="synthetic.epub"');
  const cookie = (await context.cookies()).find(cookie => cookie.name === 'proof_session');
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.sameSite).toBe('Strict');
  const denied = await page.evaluate(() => window.integration.badCSRF());
  expect(denied.status).toBe(403); expect(denied.problem?.code).toBe('csrf');
  const state = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(state.sha256).toBe(bookHash); expect(state.bytes).toBe(loaded.bytes); expect(state.receipts).toEqual([]);
  const mutation = state.requests.find(request => request.method === 'POST');
  expect(mutation).toMatchObject({ origin: fixtureServer.origin, cookie: true, csrf: true, status: 403 });
  const controls = await page.evaluate(async () => (await fetch('/__fixture/session', { method: 'POST' })).status);
  expect(controls).toBe(403);
});

test('durable browser append/reload then real progress and activity receipts remove only their IDs', async ({ page, fixtureServer }) => {
  await page.evaluate(async key => {
    await window.integration.boot(key); await window.integration.loadBook();
    await window.integration.appendProgress('durable-progress', '0', .6);
    await window.integration.appendActivity('durable-activity');
  }, fixtureServer.key);
  await page.reload(); await page.waitForFunction(() => !!window.integration);
  const durable = await page.evaluate(() => window.integration.snapshot());
  expect(durable.events.map(event => event.id)).toEqual(['durable-progress', 'durable-activity']);
  expect(durable.checkpoint?.ko).toBe('/body/DocFragment[1]/body/p[1]');
  await page.evaluate(key => window.integration.boot(key), fixtureServer.key);
  expect(await page.evaluate(() => window.integration.replay())).toBe('acknowledged');
  expect((await page.evaluate(() => window.integration.snapshot())).events).toEqual([]);
  const state = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(state.head).toBe('1'); expect(state.activities).toBe(1); expect(state.seconds).toBe(30);
  expect(state.receipts).toEqual([
    { id: 'durable-activity', status: 200, body: { event_id: 'durable-activity', kind: 'activity', revision: null } },
    { id: 'durable-progress', status: 200, body: { event_id: 'durable-progress', kind: 'progress', revision: '1' } },
  ]);
  expect(state.requests.filter(request => request.method === 'POST')).toEqual([
    { method: 'POST', path: '/api/v1/me/reading-progress', origin: fixtureServer.origin, cookie: true, csrf: true, status: 200 },
    { method: 'POST', path: '/api/v1/me/activity', origin: fixtureServer.origin, cookie: true, csrf: true, status: 200 },
  ]);
  expect(await page.evaluate(() => window.integration.openStored())).toMatchObject({ sha256: bookHash });
});

test('actual expired cookie 401 retains events and pauses replay; same-account restore resumes', async ({ page, context, fixtureServer }) => {
  const original = await page.evaluate(async key => {
    const boot = await window.integration.boot(key); await window.integration.loadBook();
    await window.integration.appendActivity('after-expiry');
    await window.integration.control(key, 'expire');
    return boot;
  }, fixtureServer.key);
  expect((await context.cookies()).some(cookie => cookie.name === 'proof_session')).toBe(false);
  expect(await page.evaluate(() => window.integration.replay())).toBe('auth-required');
  const paused = await page.evaluate(() => window.integration.snapshot());
  expect(paused.events.map(event => event.id)).toEqual(['after-expiry']);
  expect(paused.access).toMatchObject({ authenticated: false, visible: true });
  const before = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(before.requests.at(-1)).toMatchObject({ path: '/api/v1/me/activity', status: 401, cookie: false });
  expect(await page.evaluate(() => window.integration.replay())).toBe('idle-or-paused');
  expect((await page.evaluate(key => window.integration.serverState(key), fixtureServer.key)).requests).toHaveLength(before.requests.length);
  expect(await page.evaluate(() => window.integration.openStored())).toMatchObject({ sha256: bookHash });
  const restored = await page.evaluate(key => window.integration.boot(key), fixtureServer.key);
  expect(restored.scope).toBe(original.scope);
  expect(await page.evaluate(() => window.integration.replay())).toBe('acknowledged');
  expect((await page.evaluate(() => window.integration.snapshot())).events).toEqual([]);
  const state = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(state.activities).toBe(1); expect(state.seconds).toBe(30);
});

test('lost HTTP response after partial-batch commit, SQLite reopen and browser reload retry once', async ({ page, fixtureServer }) => {
  const failed: string[] = []; page.on('requestfailed', request => failed.push(request.url()));
  await page.evaluate(async key => {
    await window.integration.boot(key); await window.integration.loadBook();
    await window.integration.appendProgress('lost-progress', '0', .6);
    await window.integration.appendActivity('lost-activity');
    await window.integration.control(key, 'fault', { mode: 'lose', kind: 'activity' });
  }, fixtureServer.key);
  expect(await page.evaluate(() => window.integration.replay())).toBe('retryable');
  expect(failed.some(url => url.endsWith('/api/v1/me/activity'))).toBe(true);
  expect((await page.evaluate(() => window.integration.snapshot())).events.map(event => event.id)).toEqual(['lost-progress', 'lost-activity']);
  const committed = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(committed.head).toBe('1'); expect(committed.activities).toBe(1); expect(committed.receipts).toHaveLength(2);
  await page.evaluate(key => window.integration.control(key, 'reopen').then(() => undefined), fixtureServer.key);
  await page.reload(); await page.waitForFunction(() => !!window.integration);
  expect((await page.evaluate(() => window.integration.snapshot())).events.map(event => event.id)).toEqual(['lost-progress', 'lost-activity']);
  await page.evaluate(key => window.integration.boot(key), fixtureServer.key);
  expect(await page.evaluate(() => window.integration.replay())).toBe('acknowledged');
  expect((await page.evaluate(() => window.integration.snapshot())).events).toEqual([]);
  const retried = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(retried.opens).toBe(committed.opens + 1); expect(retried.receipts).toEqual(committed.receipts);
  expect(retried.head).toBe('1'); expect(retried.activities).toBe(1); expect(retried.seconds).toBe(30);
});

test('KO-style operation advances actual head; real CAS conflict retains outbox until explicit new backward choice', async ({ page, fixtureServer }) => {
  await page.evaluate(async key => {
    await window.integration.boot(key); await window.integration.loadBook();
    await window.integration.appendProgress('stale-local', '0', .2, '/body/DocFragment[1]/body/p[2]');
    await window.integration.control(key, 'ko', { fraction: .8, position: '/ko/newer.text().7' });
  }, fixtureServer.key);
  expect(await page.evaluate(() => window.integration.replay())).toBe('blocked');
  const blocked = await page.evaluate(() => window.integration.snapshot());
  expect(blocked.events.map(event => event.id)).toEqual(['stale-local']);
  expect(blocked.deliveries).toEqual([{ id: 'stale-local', status: 409 }]);
  const server = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(server.head).toBe('1'); expect(server.progress).toEqual([{ device: 'a-second', fraction: .8, position: '/ko/newer.text().7' }]);
  expect(server.receipts).toMatchObject([{ id: 'stale-local', status: 409, body: { code: 'progress_conflict', current_revision: '1' } }]);
  const early = await page.evaluate(async () => { try { await window.integration.chooseLocal('stale-local', 'stale-local', '1', .1, '/body/DocFragment[1]/body/p[1]'); return false; } catch { return true; } });
  expect(early).toBe(true);
  await page.waitForTimeout(1100);
  const choice = await page.evaluate(() => window.integration.chooseLocal('stale-local', 'explicit-backward', '1', .1, '/body/DocFragment[1]/body/p[1]'));
  expect(choice.events.map(event => event.id)).toEqual(['explicit-backward']); expect(choice.checkpoint?.ko).toBe('/body/DocFragment[1]/body/p[1]');
  expect(await page.evaluate(() => window.integration.replay())).toBe('acknowledged');
  expect((await page.evaluate(() => window.integration.snapshot())).events).toEqual([]);
  const chosen = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(chosen.head).toBe('2'); expect(chosen.progress).toEqual([
    { device: 'a-device', fraction: .1, position: '/body/DocFragment[1]/body/p[1]' },
    { device: 'a-second', fraction: .8, position: '/ko/newer.text().7' },
  ]);
  expect(chosen.receipts.find(receipt => receipt.id === 'stale-local')).toEqual(server.receipts[0]);
});

test('another KO write invalidates an explicit choice before replay without silently rebasing it', async ({ page, fixtureServer }) => {
  await page.evaluate(async key => {
    await window.integration.boot(key); await window.integration.loadBook();
    await window.integration.appendProgress('stale-choice', '0', .2);
    await window.integration.control(key, 'ko', { fraction: .8, position: '/ko/first' });
  }, fixtureServer.key);
  expect(await page.evaluate(() => window.integration.replay())).toBe('blocked');
  await page.waitForTimeout(1100);
  await page.evaluate(async key => {
    await window.integration.chooseLocal('stale-choice', 'raced-choice', '1', .1, '/body/DocFragment[1]/body/p[1]');
    await window.integration.control(key, 'ko', { fraction: .9, position: '/ko/intervening' });
  }, fixtureServer.key);
  expect(await page.evaluate(() => window.integration.replay())).toBe('blocked');
  expect((await page.evaluate(() => window.integration.snapshot())).events.map(event => event.id)).toEqual(['raced-choice']);
  const state = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
  expect(state.head).toBe('2');
  expect(state.progress).toEqual([{ device: 'a-second', fraction: .9, position: '/ko/intervening' }]);
  expect(state.receipts.find(receipt => receipt.id === 'raced-choice')).toMatchObject({ status: 409, body: { current_revision: '2' } });
});

for (const mode of ['wrong-kind', 'wrong-revision', 'wrong-id', 'extra-field']) {
  test(`malicious HTTP 200 receipt ${mode} cannot delete either queued event`, async ({ page, fixtureServer }) => {
    const kind = mode === 'wrong-kind' ? 'activity' : 'progress';
    await page.evaluate(async ({ key, mode, kind }) => {
      await window.integration.boot(key); await window.integration.loadBook();
      if (kind === 'activity') { await window.integration.appendActivity('malicious-activity'); await window.integration.appendProgress('malicious-progress', '0', .4); }
      else { await window.integration.appendProgress('malicious-progress', '0', .4); await window.integration.appendActivity('malicious-activity'); }
      await window.integration.control(key, 'fault', { mode, kind });
    }, { key: fixtureServer.key, mode, kind });
    const wire = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(kind === 'activity' ? '/api/v1/me/activity' : '/api/v1/me/reading-progress'));
    expect(await page.evaluate(() => window.integration.replay())).toBe('blocked');
    const malicious = await wire; expect(malicious.status()).toBe(200);
    const body = await malicious.json();
    if (mode === 'wrong-kind') expect(body.kind).toBe('progress');
    if (mode === 'wrong-revision') expect(body.revision).toBe('999');
    if (mode === 'wrong-id') expect(body.event_id).toBe('not-in-flight');
    if (mode === 'extra-field') expect(body.unexpected).toBe(true);
    const retained = await page.evaluate(() => window.integration.snapshot());
    expect(retained.events.map(event => event.id).sort()).toEqual(['malicious-activity', 'malicious-progress']);
    expect(retained.deliveries.map(delivery => delivery.status)).toEqual([200, 200]);
    const committed = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
    expect(committed.head).toBe('1'); expect(committed.activities).toBe(1); expect(committed.receipts).toHaveLength(2);
    await page.reload(); await page.waitForFunction(() => !!window.integration);
    expect((await page.evaluate(() => window.integration.snapshot())).events).toHaveLength(2);
    await page.evaluate(key => window.integration.boot(key), fixtureServer.key);
    expect(await page.evaluate(() => window.integration.replay())).toBe('acknowledged');
    expect((await page.evaluate(() => window.integration.snapshot())).events).toEqual([]);
    const retried = await page.evaluate(key => window.integration.serverState(key), fixtureServer.key);
    expect(retried.receipts).toEqual(committed.receipts); expect(retried.head).toBe('1'); expect(retried.activities).toBe(1);
  });
}
