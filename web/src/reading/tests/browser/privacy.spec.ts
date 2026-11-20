import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';
test('provider switches A to B without even one stale metadata/pending-count projection', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => {
    const p = window.readingTest;
    const repo = new p.Repository(), bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    for (const [userId, count] of [['B', 1], ['A', 2]] as const) {
      const account = { origin: location.origin, userId }, ref = { kind: 'server' as const, account, documentId: userId + '-original' };
      await repo.setAccess({ kind: 'authenticated', account }); await repo.install(ref, bytes, 'Private ' + userId, null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
      await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .1 });
      if (count > 1) await repo.credit(ref, { event_id: crypto.randomUUID(), document_id: ref.documentId, device_id: (await repo.device(account)).id, start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: 0, end_fraction: .1 });
    }
    repo.db.close();
    const offline = async () => { throw new Error('offline'); }; const bridge: ReadingBridge = { registerDevice: offline, getState: offline, fetchFile: offline, fetchCover: offline, submitProgress: offline, submitActivity: offline };
    Object.assign(window, { privacyBridge: bridge }); p.project({ kind: 'authenticated', account: { origin: location.origin, userId: 'A' } }, bridge);
  });
  await expect.poll(async () => JSON.parse(await page.locator('#projection').innerText())).toEqual({ titles: ['Private A'], pending: 2, conflicts: 0, ready: true });
  const immediate = await page.evaluate(() => {
    window.readingTest.project({ kind: 'authenticated', account: { origin: location.origin, userId: 'B' } }, (window as unknown as { privacyBridge: ReadingBridge }).privacyBridge);
    return JSON.parse(document.getElementById('projection')!.textContent!);
  });
  expect(immediate.titles).not.toContain('Private A'); expect(immediate.pending).toBe(0);
  await expect.poll(async () => JSON.parse(await page.locator('#projection').innerText())).toEqual({ titles: ['Private B'], pending: 1, conflicts: 0, ready: true });
});
