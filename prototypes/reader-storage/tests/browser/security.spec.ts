import { test, expect } from '@playwright/test';
import { watchRequests } from './support';

test('synthetic adversarial EPUBs reject before engine/network/navigation and never publish availability', async ({ page }) => {
  await page.goto('/');
  const requests = await watchRequests(page);
  const result = await page.evaluate(async () => {
    const attacks: string[] = await (await fetch('/fixtures/attacks.json')).json();
    const rejected: string[] = [], accepted: string[] = [], engineErrors: string[] = [];
    let published = 0;
    for (const attack of attacks) {
      const bytes = await (await fetch(`/fixtures/adversarial-${attack}.epub`)).arrayBuffer();
      try { await window.proof.repository.importBook('local', attack, attack, bytes); accepted.push(attack); } catch { rejected.push(attack); }
      const host = document.createElement('div'); document.body.appendChild(host);
      let state = '';
      const reader = new window.proof.ReaderController(host, status => { state = status.state; }, async () => { published++; });
      await reader.open(bytes);
      if (state === 'error') engineErrors.push(attack);
      await reader.dispose(); host.remove();
    }
    return { attacks, rejected, accepted, engineErrors, published, books: await window.proof.repository.db.books.count(), engines: window.proof.lifecycle.engines };
  });
  expect(result.rejected).toEqual(result.attacks); expect(result.accepted).toEqual([]);
  expect(result.engineErrors).toEqual(result.attacks); expect(result.published).toBe(0);
  expect(result.books).toBe(0); expect(result.engines).toBe(0); expect(requests).toEqual([]);
  expect(page.url()).toBe('http://127.0.0.1:5314/');
});

test('real EPUB.js iframe has early CSP and script-disabled sandbox, hostile parser script cannot access parent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open synthetic EPUB', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'ready');
  const result = await page.locator('[data-testid="reader-host"] iframe').evaluate((frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument!;
    return { sandbox: frame.getAttribute('sandbox'), firstHead: doc.head.firstElementChild?.outerHTML };
  });
  expect(result.sandbox).not.toContain('allow-scripts'); expect(result.firstHead).toContain('Content-Security-Policy');
  expect(result.firstHead).toContain("connect-src 'none'");
  // Defense In Depth - Mutate only the test frame to exercise Chromium's sandbox independently of preflight rejection.
  await page.locator('[data-testid="reader-host"] iframe').evaluate((frame: HTMLIFrameElement) => {
    frame.srcdoc = '<html><head><script>parent.localStorage.setItem("epub-pwned","yes");parent.document.body.dataset.pwned="yes";</script></head><body onload="parent.localStorage.setItem(\'epub-pwned\',\'yes\')">hostile</body></html>';
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => ({ storage: localStorage.getItem('epub-pwned'), dom: document.body.dataset.pwned }))).toEqual({ storage: null, dom: undefined });
});

test('book-internal links are blocked rather than causing unrecorded engine navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open synthetic EPUB', exact: true }).click();
  await expect(page.getByRole('status')).toHaveAttribute('data-state', 'ready');
  const before = await page.getByTestId('position').innerText();
  await page.locator('[data-testid="reader-host"] iframe').evaluate((frame: HTMLIFrameElement) => {
    const anchor = frame.contentDocument!.createElement('a'); anchor.href = 'two.xhtml'; anchor.textContent = 'Chapter link';
    frame.contentDocument!.body.appendChild(anchor); anchor.click();
  });
  await page.waitForTimeout(100);
  expect(await page.getByTestId('position').innerText()).toBe(before);
  expect(await page.evaluate(() => window.proof.publications.length)).toBe(0);
});
