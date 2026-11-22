import { expect, test } from '@playwright/test';
import type { ReadingBridge, ReadingSnapshot } from '../../types';

test('leaving during preparation cancels the open without a Library error', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest;
    const account = { origin: location.origin, userId: 'cancel-open' };
    const ref = { kind: 'server' as const, account, documentId: 'cancel-book' };
    const file = await (await fetch('/fixtures/synthetic.epub')).blob();
    const snapshots: ReadingSnapshot[] = [];
    let arrived!: () => void;
    const preparing = new Promise<void>(resolve => { arrived = resolve; });
    const noWrite = async () => { throw new Error('Unexpected request'); };
    const bridge: ReadingBridge = {
      fetchFile: async () => new Response(file, { headers: { 'Content-Type': 'application/epub+zip' } }),
      getState: async (_, __, signal) => {
        arrived();
        await new Promise((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
        throw new Error('Expected cancellation');
      },
      registerDevice: async (_, device) => device,
      fetchCover: noWrite, submitProgress: noWrite, submitActivity: noWrite,
    };
    const runtime = new p.ReadingRuntime(bridge, state => snapshots.push(state), () => {});
    const lifetime = new AbortController();
    try {
      await runtime.start({ kind: 'authenticated', account });
      const selecting = runtime.setAccess({ kind: 'authenticated', account: { ...account } });
      const opening = runtime.openServerBook(ref, lifetime.signal).catch((error: Error) => error.name);
      await selecting;
      await Promise.race([preparing, opening.then(error => { throw new Error(`Open failed before preparation: ${error}`); })]);
      lifetime.abort();
      return { outcome: await opening, error: snapshots.at(-1)?.error, downloads: snapshots.at(-1)?.downloads.length, books: await runtime.repo.db.books.count(), pending: (await runtime.repo.pending()).length };
    } finally { lifetime.abort(); runtime.dispose(); }
  });
  expect(result).toEqual({ outcome: 'AbortError', error: null, downloads: 0, books: 0, pending: 0 });
});

test('authenticated EPUB cache revalidates, repairs and evicts without changing queued progress', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest;
    const original = await (await fetch('/fixtures/synthetic.epub')).blob();
    const replacement = await (await fetch('/fixtures/compatibility.epub')).blob();
    const account = { origin: location.origin, userId: 'reader-a' };
    const other = { origin: location.origin, userId: 'reader-b' };
    const ref = { kind: 'server' as const, account, documentId: 'test-book' };
    const validators: (string | null)[] = [];
    const deliveries: string[] = [];
    const tag = (version: number) => `W/"book-${version}"`;
    let version = 1, revision = '0', status = 200;
    const bridge: ReadingBridge = {
      async fetchFile(_, id, _signal, etag) {
        validators.push(etag ?? null);
        if (status !== 200) return new Response(null, { status });
        const current = id === ref.documentId ? version : 1;
        if (etag === tag(current)) return new Response(null, { status: 304, headers: { ETag: etag } });
        deliveries.push(id);
        return new Response(current === 1 ? original : replacement, { headers: { 'Content-Type': 'application/epub+zip', ETag: tag(current) } });
      },
      async getState(_, id) { return { document_id: id, revision, position: revision === '0' ? null : '/body/DocFragment[1]/body/h1[1]', fraction: revision === '0' ? null : .1, device_id: null, updated_at: null }; },
      registerDevice: async (_, device) => device,
      fetchCover: async () => { throw new Error('Not needed to read'); },
      submitProgress: async () => ({ body: null, status: 503 }),
      submitActivity: async () => ({ body: null, status: 503 }),
    };
    const runtime = new p.ReadingRuntime(bridge, () => {}, () => {});
    const lifetime = new AbortController();
    const open = async (book = ref) => {
      const read = new AbortController();
      try { return await runtime.openServerBook(book, read.signal); }
      finally { read.abort(); }
    };
    try {
      await runtime.start({ kind: 'authenticated', account });
      const coldStages: string[] = [];
      const first = await runtime.openServerBook(ref, lifetime.signal, message => coldStages.push(message));
      const noWholeBookFingerprint = first.manifest.integrity === null && first.row.checksum === null && first.row.protocolHash === null;
      const initialSummary = await runtime.readerCacheSummary();
      const summaryWithBook = initialSummary.books === 1 && initialSummary.epubBytes === original.size && initialSummary.metadataBytes > 0;
      revision = '1';
      const cached = await open();
      const local = { position: '/body/DocFragment[1]/body/p[2]', fraction: .25 };
      await runtime.save(ref, local);
      const promotionDeadline = performance.now() + 2000;
      while (!(await runtime.repo.pending()).length && performance.now() < promotionDeadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      revision = '2'; version = 2;
      const fresh = await open();
      const heldDuringReplacement = !!await runtime.repo.db.sources.get(first.row.sourceId!);
      lifetime.abort();
      for (let i = 0; i < 6; i++) await open({ ...ref, documentId: `next-${i}` });
      const evicted = await runtime.repo.db.books.get(first.row.key);
      const cachedCount = await runtime.repo.db.sources.filter(row => row.complete).count();
      const pending = await runtime.repo.pending();
      const downloads = deliveries.length;
      status = 403;
      const denied = await open({ ...ref, documentId: 'next-5' }).then(() => false, () => true);
      const localBook = { kind: 'local' as const, localId: 'keep-local' };
      await runtime.repo.install(localBook, original, 'Local book', null, null);
      const active = new AbortController();
      status = 200;
      const opened = await runtime.openServerBook({ ...ref, documentId: 'next-5' }, active.signal);
      await runtime.clearReaderCache();
      const held = await runtime.repo.db.sources.get(opened.row.sourceId!);
      const unavailable = (await runtime.repo.db.books.get(opened.row.key))?.availability === 'unavailable';
      const reopened = await open({ ...ref, documentId: 'next-5' });
      active.abort();
      const deadline = performance.now() + 2000;
      let released = false;
      while (!(released = !await runtime.repo.db.sources.get(opened.row.sourceId!)) && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await runtime.clearReaderCache();
      const { source: localSource } = await runtime.repo.open(localBook);
      const cleared = {
        held: !!held?.evictOnRelease, unavailable, released,
        fetchedWithoutValidator: validators.at(-1) === null && reopened.row.sourceId !== opened.row.sourceId,
        serverSources: await runtime.repo.db.sources.filter(row => row.key.startsWith('["server",')).count(),
        retainedPending: (await runtime.repo.pending()).length,
        retainedCheckpoint: (await runtime.repo.db.books.get(first.row.key))?.checkpoint,
        localBytes: localSource.kind === 'blob' && localSource.blob.size === original.size,
        summary: await runtime.readerCacheSummary(),
      };
      await runtime.setAccess({ kind: 'authenticated', account: other });
      const hidden = await open().then(() => false, () => true);
      return { firstValidators: validators.slice(0, 3), reused: cached.row.sourceId === first.row.sourceId, replaced: fresh.row.sourceId !== first.row.sourceId,
        remote: cached.row.checkpoint.fraction, pendingFraction: fresh.row.checkpoint.fraction, heldDuringReplacement, cachedCount,
        evicted: evicted?.availability, checkpoint: evicted?.checkpoint, pending: pending.map(event => event.payload.event_id).length, downloads, denied, hidden, cleared, coldStages, summaryWithBook, noWholeBookFingerprint };
    } finally { lifetime.abort(); runtime.dispose(); }
  });
  expect(result).toEqual({ coldStages: ['Connecting to the server…', 'Downloading EPUB…', 'Reading the ZIP directory…', 'Checking the EPUB package…', 'Fetching your saved position…', 'Saving a copy on this device…'], firstValidators: [null, 'W/"book-1"', 'W/"book-1"'], reused: true, replaced: true, remote: .1, pendingFraction: .25,
    heldDuringReplacement: true, cachedCount: 6, evicted: 'unavailable', checkpoint: { position: '/body/DocFragment[1]/body/p[2]', fraction: .25 }, pending: 1, downloads: 8, denied: true, hidden: true,
    summaryWithBook: true, noWholeBookFingerprint: true,
    cleared: { summary: { books: 0, epubBytes: 0, metadataBytes: 0 }, held: true, unavailable: true, released: true, fetchedWithoutValidator: true, serverSources: 0, retainedPending: 1, retainedCheckpoint: { position: '/body/DocFragment[1]/body/p[2]', fraction: .25 }, localBytes: true } });
});
