import { expect, test } from '@playwright/test';

for (const version of [5, 6] as const) test(`v${version} migrates offline without copying chunks or mixing profile records`, async ({ page, context }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const name = `upgrade-${version}`;
  await page.evaluate(async ({ name, version }) => window.readingTest.seedLegacyLibrary(name, version), { name, version });
  await page.route('**/api/**', route => route.abort());
  await context.setOffline(true);
  const askedToClose = await page.evaluate(async ({ name, version }) => {
    const p = window.readingTest, db = new p.ReadingDB(name);
    const oldTab = p.legacyLibrary(name, version);
    await oldTab.open(); let askedToClose = false;
    oldTab.on('versionchange', () => { askedToClose = true; oldTab.close(); });
    await db.open(); db.close(); return askedToClose;
  }, { name, version });
  expect(askedToClose).toBe(true);
  // Harness Assets - The Vite test worker scripts are not a precached production shell. Keep the API blocked.
  await context.setOffline(false);
  const result = await page.evaluate(async name => {
    const p = window.readingTest, db = new p.ReadingDB(name), repo = new p.Repository(db);
    const ref = (userId: string, readingGeneration = 'g1') => ({ kind: 'server' as const, documentId: 'doc', account: { origin: location.origin, userId, readingGeneration } });
    const a = await repo.openOffline(ref('alice')), b = await repo.openOffline(ref('bob'));
    const otherGeneration = await repo.openOffline(ref('alice', 'restored')).then(() => 'opened', () => 'missing');
    const local = await repo.open({ kind: 'local', localId: 'only-here' });
    const contents = new TextDecoder().decode(await new p.ArchiveReader(a.source, a.manifest.index).bytes('mimetype'));
    const sourceIds = [a.row.sourceId, b.row.sourceId];
    const events = (await repo.pending()).map(e => e.id).sort();
    const drafts = (await db.offline.toArray()).map(d => d.id).sort();
    const pin = a.row.pinned, positions = (await db.positions.toArray()).map(p => p.checkpoint.fraction).sort();
    const before = await db.sourceChunks.orderBy('key').primaryKeys();
    await repo.cleanupStages(); const leased = !!(await db.sources.get('source-alice'))?.evictOnRelease;
    await db.sources.update('source-alice', { cacheReaders: {} }); await repo.cleanupStages();
    const after = await db.sourceChunks.orderBy('key').primaryKeys();
    const copies = await db.downloads.count();
    const shelf = (await repo.projection({ kind: 'offline', account: ref('alice').account })).books;
    await repo.removeFromDevice(ref('alice'), new AbortController().signal, 'offline');
    const removed = await db.downloads.count(), privateRows = await db.positions.count();
    const output = { contents, copies, pin, sourceIds, before, after, leased, positions, events, drafts, a: a.row.checkpoint.fraction, b: b.row.checkpoint.fraction,
      sameShelf: shelf[0]?.sourceId === a.row.sourceId && shelf[0]?.checkpoint.fraction === a.row.checkpoint.fraction,
      otherGeneration, local: local.row.title, removed, privateRows };
    await db.delete(); return output;
  }, name);
  expect(result).toEqual({ contents: 'application/epub+zip', copies: 1, pin: version === 6, sourceIds: ['source-bob', 'source-bob'],
    before: ['source-alice:0', 'source-bob:0'], after: ['source-bob:0'], leased: true, positions: [.1,.2],
    events: version === 6 ? ['event-alice','event-bob'] : [], drafts: version === 6 ? ['alice-draft'] : ['event-alice','event-bob'],
    a: version === 6 ? .3 : .1, b: .2, sameShelf: true, otherGeneration: 'missing', local: 'Personal book', removed: 0, privateRows: 2 });
});

test('a pin follows an atomic replacement while a leased reader keeps its original bytes', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, name = 'replace-pinned'; await p.seedLegacyLibrary(name, 6);
    const db = new p.ReadingDB(name), repo = new p.Repository(db);
    const account = { origin: location.origin, userId: 'bob', readingGeneration: 'g1' };
    const ref = { kind: 'server' as const, documentId: 'doc', account }, reader = new AbortController();
    const opened = await repo.openOffline(ref), old = opened.row.sourceId!;
    await repo.keepSource(old, reader.signal);
    const file = await (await fetch('/fixtures/compatibility.epub')).blob();
    const stage = await repo.stageBlob(ref, file), policy = await repo.validateStage(stage);
    const publish = () => repo.publish(ref, stage, policy.manifest, 'Replacement', null, null, undefined, undefined, { etag: '"new"', previousSource: old });
    const fail = () => { throw new Error('failed pointer swap'); };
    db.downloads.hook('updating', fail);
    const failure = await publish().then(() => '', e => String(e));
    db.downloads.hook('updating').unsubscribe(fail);
    const afterFailure = await repo.cachedOriginal(ref);
    try { await publish(); } finally { policy.dispose(); }
    const next = await repo.openOffline({ ...ref, account: { ...account, userId: 'alice' } });
    const originalStillReadable = await p.checksum(opened.source) === opened.row.checksum;
    reader.abort();
    const until = performance.now() + 2000;
    while (await db.sources.get(old) && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
    const released = !await db.sources.get(old); await db.delete();
    return { failure, unchanged: afterFailure?.sourceId === old && afterFailure.pinned, switched: next.row.sourceId === stage.id, pin: next.row.pinned,
      etag: next.row.etag, draft: next.row.checkpoint.fraction, originalStillReadable, released };
  });
  expect(result).toEqual({ failure: expect.stringContaining('failed pointer swap'), unchanged: true, switched: true, pin: true, etag: '"new"', draft: .3, originalStillReadable: true, released: true });
});

test('failed v7 upgrade rolls back both schema and data and can be retried', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, name = 'rollback'; await p.seedLegacyLibrary(name, 6);
    const broken = new p.ReadingDB(name);
    broken.positions.hook('creating', (_, row) => { if (row.ref.account.userId === 'bob') throw new Error('injected position failure'); });
    const error = await broken.open().then(() => '', e => String(e)); broken.close();
    const old = p.legacyLibrary(name, 6); await old.open();
    const unchanged = { version: old.backendDB().version, books: await old.table('books').count(), events: await old.table('events').count(), chunks: await old.table('sourceChunks').count(),
      partial: old.backendDB().objectStoreNames.contains('downloads') };
    old.close(); const retry = new p.ReadingDB(name), copies = await retry.downloads.count(); await retry.delete(); return { error, unchanged, copies };
  });
  expect(result).toEqual({ error: expect.stringContaining('injected position failure'), unchanged: { version: 60, books: 3, events: 2, chunks: 2, partial: false }, copies: 1 });
});
