import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';
test('the offline snapshot counts this profile’s outbox without loading another profile’s events', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest;
    const unreachable = async () => { throw new Error('Unexpected network call'); };
    const bridge: ReadingBridge = { registerDevice: unreachable, fetchCover: unreachable, fetchFile: unreachable,
      getState: unreachable, submitProgress: unreachable, submitActivity: unreachable };
    let pending = 0;
    const runtime = new p.ReadingRuntime(bridge, snapshot => { pending = snapshot.pendingCount; }, () => {});
    try {
      for (const userId of ['A', 'B']) {
        const account = { origin: location.origin, userId };
        const ref = { kind: 'server' as const, account, documentId: 'shared' };
        await runtime.repo.setAccess({ kind: 'authenticated', account });
        await p.verifiedCapture(runtime.repo, ref, undefined, { event_id: userId, document_id: ref.documentId,
          device_id: (await runtime.repo.device(account)).id, start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: 0, end_fraction: .1 });
      }
      const foreignReads: string[] = [];
      runtime.repo.db.events.hook('reading', event => { if (event?.id === 'B') foreignReads.push(event.id); return event; });
      await runtime.start({ kind: 'offline', account: { origin: location.origin, userId: 'A' } });
      return { pending, foreignReads };
    } finally { runtime.dispose(); }
  });
  expect(result).toEqual({ pending: 1, foreignReads: [] });
});

test('provider switches A to B without even one stale metadata/pending-count projection', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => {
    const p = window.readingTest;
    const repo = new p.Repository(), bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    for (const [userId, count] of [['B', 1], ['A', 2]] as const) {
      const account = { origin: location.origin, userId }, ref = { kind: 'server' as const, account, documentId: userId + '-original' };
      await repo.setAccess({ kind: 'authenticated', account }); await repo.install(ref, bytes, 'Private ' + userId, null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
      await p.verifiedCapture(repo, ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .1 });
      if (count > 1) await p.verifiedCapture(repo, ref, undefined, { event_id: crypto.randomUUID(), document_id: ref.documentId, device_id: (await repo.device(account)).id, start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: 0, end_fraction: .1 });
    }
    repo.db.close();
    const offline = async () => { throw new Error('offline'); }; const bridge: ReadingBridge = { registerDevice: offline, getState: offline, fetchFile: offline, fetchCover: offline, submitProgress: offline, submitActivity: offline };
    Object.assign(window, { privacyBridge: bridge }); p.project({ kind: 'authenticated', account: { origin: location.origin, userId: 'A' } }, bridge);
  });
  await expect.poll(async () => JSON.parse(await page.locator('#projection').innerText())).toEqual({ titles: ['Private A'], pending: 2, ready: true });
  const immediate = await page.evaluate(() => {
    window.readingTest.project({ kind: 'authenticated', account: { origin: location.origin, userId: 'B' } }, (window as unknown as { privacyBridge: ReadingBridge }).privacyBridge);
    return JSON.parse(document.getElementById('projection')!.textContent!);
  });
  expect(immediate.titles).not.toContain('Private A'); expect(immediate.pending).toBe(0);
  await expect.poll(async () => JSON.parse(await page.locator('#projection').innerText())).toEqual({ titles: ['Private B'], pending: 1, ready: true });
});
