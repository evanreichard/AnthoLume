import { test, expect } from '@playwright/test';
import { watchRequests } from './support';

test('passive manifested CSS remains usable without outbound requests', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  const color = await page.evaluate(async () => {
    const p = window.proof, bytes = await (await fetch('/fixtures/passive-css.epub')).arrayBuffer();
    await p.repository.importBook('local', 'passive', 'Passive CSS', bytes);
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    const reader = new p.ReaderController(host, () => {}, async () => {});
    await reader.open(bytes);
    const frame = host.querySelector('iframe')!;
    const color = frame.contentWindow!.getComputedStyle(frame.contentDocument!.body).color;
    await reader.dispose(); host.remove(); return color;
  });
  expect(color).toBe('rgb(1, 2, 3)'); expect(unexpected).toEqual([]);
});

for (const group of ['aliases', 'structures']) test(`${group}: reject effective-role aliases or broken container/OPF/spine before availability or engine creation`, async ({ page }) => {
  await page.goto('/');
  const unexpected = await watchRequests(page);
  const result = await page.evaluate(async group => {
    const p = window.proof;
    const cases: string[] = await (await fetch(`/fixtures/${group}.json`)).json();
    const rejected: string[] = [];
    for (const name of cases) {
      const bytes = await (await fetch(`/fixtures/review-${name}.epub`)).arrayBuffer();
      let importFailed = false;
      try { await p.repository.importBook('local', name, name, bytes); } catch { importFailed = true; }
      if (!importFailed) throw new Error(`Invalid ${group} became available: ${name}`);
      const host = document.createElement('div'); document.body.appendChild(host);
      let state = '';
      const reader = new p.ReaderController(host, status => { state = status.state; }, async () => { throw new Error('Invalid content published position'); });
      await reader.open(bytes); await reader.dispose(); host.remove();
      if (state !== 'error') throw new Error(`Invalid ${group} opened: ${name}`);
      rejected.push(name);
    }
    return { cases, rejected, books: await p.repository.db.books.count(), checkpoints: await p.repository.db.checkpoints.count(), engines: p.lifecycle.engines };
  }, group);
  expect(result.rejected).toEqual(result.cases);
  expect(result.books).toBe(0); expect(result.checkpoints).toBe(0); expect(result.engines).toBe(0);
  expect(unexpected).toEqual([]);
});

test('network watcher catches arbitrary origins and same-origin non-harness paths', async ({ page }) => {
  await page.goto('/');
  const unexpected = await watchRequests(page);
  // Watcher Fault Check - These deliberate test fetches must be noticed and aborted, not silently filtered by attacker hostname.
  await page.evaluate(async () => {
    await Promise.all(['https://not-a-fixture-host.invalid/probe', '/unapproved-book-request'].map(url => fetch(url).catch(() => undefined)));
  });
  expect(unexpected.sort()).toEqual(['http://127.0.0.1:5314/unapproved-book-request', 'https://not-a-fixture-host.invalid/probe'].sort());
});
