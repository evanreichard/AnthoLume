import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { WorkerMemoryProbe } from '../worker-memory';
test.use({ trace: 'off' });

test('300 MB streamed download publishes complete originals, bounded caches and on-demand integrity without full-file buffers', async ({ page }) => {
  test.setTimeout(240000);
  const reference = JSON.parse(readFileSync(new URL('../../../../../_scratch/m3/reader/public-300m.json', import.meta.url), 'utf8'));
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const workers = new WorkerMemoryProbe(page.context(), page); await workers.start();
  const cdp = await page.context().newCDPSession(page), measured = { peakHeap: 0, peakBacking: 0, samples: 0, phases: {} as Record<string, number> }; let phase = 'stage';
  await page.exposeFunction('memoryPhase', (value: string) => { phase = value; });
  const timer = setInterval(() => { void cdp.send('Runtime.getHeapUsage').then(m => { measured.samples++; measured.peakHeap = Math.max(measured.peakHeap, m.usedSize); measured.peakBacking = Math.max(measured.peakBacking, m.backingStorageSize || 0); measured.phases[phase] = Math.max(measured.phases[phase] || 0, m.backingStorageSize || 0); }).catch(() => undefined); }, 250);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`large-${crypto.randomUUID()}`)), ref = { kind: 'local' as const, localId: 'public-large' };
    const originalRead = Blob.prototype.arrayBuffer, originalResponse = Response.prototype.arrayBuffer;
    let forbiddenFullReads = 0;
    Blob.prototype.arrayBuffer = function () { if (this.size > p.sourceLimits.chunkBytes) { forbiddenFullReads++; throw new Error('Unexpected main-world whole source materialization'); } return originalRead.call(this); };
    Response.prototype.arrayBuffer = function () { if (this.url.endsWith('/public-300m.epub')) { forbiddenFullReads++; throw new Error('Unexpected whole download materialization'); } return originalResponse.call(this); };
    const host = document.createElement('div'); host.style.cssText = 'width:390px;height:650px'; document.body.appendChild(host);
    try {
      const response = await fetch('/public-300m.epub'), stage = await repo.stageStream(ref, response.body!);
      const partialAvailable = await repo.db.books.count(), chunkCount = await repo.db.sourceChunks.count();
      await (window as unknown as { memoryPhase(value: string): Promise<void> }).memoryPhase('validate');
      const policy = await repo.validateStage(stage); await repo.publish(ref, stage, policy.manifest, 'Public large', null, null); policy.dispose();
      await (window as unknown as { memoryPhase(value: string): Promise<void> }).memoryPhase('open');
      const bytesBefore = p.sourceStats.readBytes, opened = await repo.open(ref);
      let status: import('../../controller').ReaderStatus = { state: 'opening', message: '' }, saves = 0;
      const reader = new p.ReaderController(host, next => { status = next; }, async location => { await repo.save(ref, { position: location.ko, fraction: location.fraction }); saves++; }, { localOnly: true });
      await reader.open(opened.source, undefined, undefined, opened.manifest);
      const openBytes = p.sourceStats.readBytes - bytesBefore, initial = status.state;
      await (window as unknown as { memoryPhase(value: string): Promise<void> }).memoryPhase('navigate');
      let decoded = 0;
      for (const n of [0, 37, 74, 1, 38, 73]) {
        await reader.toc(`c${n}.xhtml`); const image = host.querySelector('iframe')!.contentDocument!.querySelector('img')!; await image.decode(); if (image.naturalWidth === 1024 && image.naturalHeight === 1024) decoded++;
      }
      const diagnostics = reader.diagnostics(), events = await repo.db.events.count(), checksum = opened.row.checksum, protocolHash = opened.row.protocolHash;
      await reader.dispose(); const released = reader.diagnostics();
      // Original Chunk Corruption - Opening remains bounded; the first touched corrupt chunk must fail, not rehash the book eagerly.
      const chunk = await repo.db.sourceChunks.get(`${stage.id}:0`), bytes = new Uint8Array(chunk!.data); bytes[0] ^= 1;
      await repo.db.sourceChunks.put({ ...chunk!, data: bytes.buffer }); const corrupt = await repo.open(ref); let corruptRejected = false;
      try { await new p.ArchiveReader(corrupt.source, corrupt.manifest.index).bytes('mimetype'); } catch (error) { corruptRejected = String(error).includes('integrity'); }
      const out = { size: stage.size, partialAvailable, chunkCount, initial, final: status.state, decoded, saves, events, checksum, protocolHash, sourceKind: opened.source.kind, openBytes, diagnostics, released, maxRead: p.sourceStats.maxRead, forbiddenFullReads, corruptRejected, staging: { ...repo.stagingStats }, workers: { ...p.sourceScheduler }, stagingWorkers: { ...p.stagingWorkers } };
      await repo.db.delete(); return out;
    } finally { Blob.prototype.arrayBuffer = originalRead; Response.prototype.arrayBuffer = originalResponse; host.remove(); }
  }).finally(async () => { clearInterval(timer); await workers.stop(); await cdp.detach(); });
  console.log('public large source measurements', JSON.stringify({ ...measured, staging: result.staging, workers: workers.peaks }));
  for (const [operation, budget] of [['hash', 8], ['index', 16], ['entry', 40], ['release', 10]] as const) { const peak = workers.peaks[operation]!; expect(peak?.samples, operation).toBeGreaterThan(0); expect(peak?.backing, operation).toBeGreaterThan(0); expect(peak.backing, operation).toBeLessThan(budget * 1024 * 1024); }
  expect(workers.peaks.starting?.backing || 0).toBeLessThan(40 * 1024 * 1024);
  expect(measured.samples).toBeGreaterThan(5); expect(measured.peakHeap).toBeLessThan(96 * 1024 * 1024); expect(measured.peakBacking).toBeLessThan(128 * 1024 * 1024);
  expect(result.diagnostics.source.peakEntry).toBeLessThanOrEqual(reference.imageBytes * 2);
  expect(result.size).toBe(reference.size); expect(result.size).toBeGreaterThan(300 * 1024 * 1024);
  expect(result).toMatchObject({ partialAvailable: 0, initial: 'ready', final: 'ready', decoded: 6, saves: 6, events: 0, sourceKind: 'idb', forbiddenFullReads: 0, corruptRejected: true, checksum: reference.sha256, protocolHash: reference.protocolHash });
  expect(result.chunkCount).toBe(Math.ceil(reference.size / 262144)); expect(result.maxRead).toBeLessThanOrEqual(262144); expect(result.openBytes).toBeLessThan(16 * 1024 * 1024);
  expect(result.diagnostics.cache!.peakDOMs).toBeLessThanOrEqual(2); expect(result.diagnostics.cache!.peakAssetBytes).toBeLessThanOrEqual(64 * 1024 * 1024); expect(result.diagnostics.loadedSections).toBeLessThanOrEqual(2);
  expect(result.released.cache).toBeNull(); expect(result.released.contentDocuments).toBe(0); expect(result.workers.active).toBe(0); expect(result.workers.peak).toBeLessThanOrEqual(2); expect(result.stagingWorkers.active).toBe(0); expect(result.stagingWorkers.peakWindow).toBe(8 * 1024 * 1024);
});

test('staging quota, cancellation and expired crash partials never publish availability or erase pending events', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`staging-${crypto.randomUUID()}`)), ref = { kind: 'local' as const, localId: 'retry' };
    let quota = false, writes = 0;
    const fail = () => { if (++writes === 2) throw new DOMException('Staged quota failure', 'QuotaExceededError'); }; repo.db.sourceChunks.hook('creating', fail);
    try { await repo.stageStream(ref, new Blob([new Uint8Array(800000)]).stream()); } catch (error) { quota = (error as Error).name === 'QuotaExceededError'; } repo.db.sourceChunks.hook('creating').unsubscribe(fail);
    const afterQuota = { chunks: await repo.db.sourceChunks.count(), sources: await repo.db.sources.count(), books: await repo.db.books.count() };
    const controller = new AbortController(); let cancelled = false, count = 0;
    try { await repo.stageStream(ref, new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(262144)); if (++count === 2) controller.abort(); } }), controller.signal); } catch (error) { cancelled = (error as Error).name === 'AbortError'; }
    const old = await repo.stageBlob(ref, new Blob(['partial'])); await repo.db.sources.update(old.id, { until: Date.now() - 1 });
    const event = { id: 'retained-event', key: 'server-key', scope: 'retained-account', created: 1, kind: 'activity' as const, payload: { event_id: 'retained-event', document_id: 'original-server', device_id: 'owned-device', start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: .1, end_fraction: .2 } };
    await repo.db.events.add(event); await repo.cleanupStages();
    const bytes = await (await fetch('/fixtures/synthetic.epub')).blob(), stage = await repo.stageStream(ref, bytes.stream()), policy = await repo.validateStage(stage); await repo.publish(ref, stage, policy.manifest, null, null, null); policy.dispose();
    const output = { quota, afterQuota, cancelled, available: (await repo.db.books.toArray())[0]!.availability, partials: (await repo.db.sources.toArray()).filter(s => !s.complete).length, events: (await repo.pending()).map(e => e.id) }; await repo.db.delete(); return output;
  });
  expect(result).toEqual({ quota: true, afterQuota: { chunks: 0, sources: 0, books: 0 }, cancelled: true, available: 'available', partials: 0, events: ['retained-event'] });
});
