import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';

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
      const first = await runtime.openServerBook(ref, lifetime.signal);
      revision = '1';
      const cached = await open();
      const local = { position: '/body/DocFragment[1]/body/p[2]', fraction: .25 };
      await runtime.save(ref, local);
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
      await runtime.setAccess({ kind: 'authenticated', account: other });
      const hidden = await open().then(() => false, () => true);
      return { firstValidators: validators.slice(0, 3), reused: cached.row.sourceId === first.row.sourceId, replaced: fresh.row.sourceId !== first.row.sourceId,
        remote: cached.row.checkpoint.fraction, pendingFraction: fresh.row.checkpoint.fraction, heldDuringReplacement, cachedCount,
        evicted: evicted?.availability, checkpoint: evicted?.checkpoint, pending: pending.map(event => event.payload.event_id).length, downloads, denied, hidden };
    } finally { lifetime.abort(); runtime.dispose(); }
  });
  expect(result).toEqual({ firstValidators: [null, 'W/"book-1"', 'W/"book-1"'], reused: true, replaced: true, remote: .1, pendingFraction: .25,
    heldDuringReplacement: true, cachedCount: 6, evicted: 'unavailable', checkpoint: { position: '/body/DocFragment[1]/body/p[2]', fraction: .25 }, pending: 1, downloads: 8, denied: true, hidden: true });
});
