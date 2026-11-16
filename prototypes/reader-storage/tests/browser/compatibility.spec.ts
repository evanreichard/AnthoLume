import { test, expect, type Page } from '@playwright/test';
import type { ReaderController, ReaderSnapshot, ReaderStatus } from '../../src/controller';
import { watchRequests } from './support';

declare global {
  interface Window { compatibility: { reader: ReaderController; host: HTMLDivElement; bytes: ArrayBuffer; fixture: string; publications: ReaderSnapshot[]; state: ReaderStatus } }
}
async function openFixture(page: Page, fixture: string) {
  return page.evaluate(async fixture => {
    const p = window.proof, bytes = await (await fetch(`/fixtures/${fixture}.epub`)).arrayBuffer();
    await p.repository.importBook('local', fixture, fixture, bytes);
    const host = document.createElement('div'); host.style.cssText = 'height:480px;width:700px'; document.body.appendChild(host);
    const c = window.compatibility = { host, bytes, fixture, publications: [] as ReaderSnapshot[], state: { state: 'opening', message: '' } as ReaderStatus, reader: null as unknown as ReaderController };
    c.reader = new p.ReaderController(host, status => { c.state = status; }, async location => { await p.repository.accept('local', fixture, location.ko); c.publications.push(location); });
    await c.reader.open(bytes);
    return c.state;
  }, fixture);
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const c = window.compatibility, frame = c.host.querySelector('iframe')!, doc = frame.contentDocument!;
    return { state: c.state.state, ko: c.state.location?.ko, publications: c.publications.length, sandbox: frame.getAttribute('sandbox'), firstHead: doc.head.firstElementChild?.outerHTML, srcdoc: frame.srcdoc.slice(0, 1200) };
  });
}
async function reopen(page: Page) {
  return page.evaluate(async () => {
    const p = window.proof, c = window.compatibility;
    const saved = (await p.repository.db.checkpoints.get(p.bookKey('local', c.fixture)))!.ko;
    await c.reader.dispose();
    c.reader = new p.ReaderController(c.host, status => { c.state = status; }, async location => { await p.repository.accept('local', c.fixture, location.ko); c.publications.push(location); });
    await c.reader.open(c.bytes, saved);
    const frame = c.host.querySelector('iframe')!, element = p.elementFromKO(frame.contentDocument!, saved);
    const visible = Array.from(element.getClientRects()).some(rect => rect.right > 0 && rect.left < frame.clientWidth && rect.bottom > 0 && rect.top < frame.clientHeight);
    return { saved, actual: c.state.location?.ko, visible, state: c.state.state, publications: c.publications.length };
  });
}

test('original representative renders rgb/media/packaged font and inline+packaged SVG with unchanged body structure/text and bytes', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  expect((await openFixture(page, 'representative')).state).toBe('ready');
  const result = await page.evaluate(async () => {
    const p = window.proof, c = window.compatibility, frame = c.host.querySelector('iframe')!, doc = frame.contentDocument!;
    await doc.fonts.load('16px ProofLato'); await doc.fonts.ready;
    const image = doc.getElementById('packaged-svg') as HTMLImageElement; await image.decode();
    const styled = frame.contentWindow!.getComputedStyle(doc.getElementById('target')!);
    const policy = await p.validateEPUB(c.bytes);
    function tree(node: Node): unknown {
      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const element = node as Element;
      return [element.namespaceURI, element.localName, element.id, Array.from(node.childNodes).filter(child => child.nodeType !== Node.COMMENT_NODE).map(tree)];
    }
    const index = p.parseKO(c.state.location!.ko).spine;
    const unchanged = JSON.stringify(tree(policy.documents.get(policy.spine[index]!)!.querySelector('body')!)) === JSON.stringify(tree(doc.body));
    const originalHash = p.fullMD5(c.bytes), storedHash = p.fullMD5(await (await p.repository.open('local', 'representative')).bytes.arrayBuffer());
    policy.dispose();
    return { color: styled.color, border: styled.borderTopWidth, family: styled.fontFamily, font: Array.from(doc.fonts).some(font => font.family === 'ProofLato' && font.status === 'loaded'), svgWidth: image.naturalWidth, inlineSVG: doc.querySelectorAll('svg').length, imageURL: image.getAttribute('src'), unchanged, originalHash, storedHash };
  });
  expect(result).toMatchObject({ color: 'rgb(12, 34, 56)', border: '3px', font: true, svgWidth: 80, inlineSVG: 1, unchanged: true });
  expect(result.family).toContain('ProofLato'); expect(result.imageURL).toMatch(/^blob:/); expect(result.originalHash).toBe(result.storedHash);
  const view = await snapshot(page); expect(view.publications).toBe(0); expect(view.sandbox).toBe('allow-same-origin'); expect(view.firstHead).toContain('Content-Security-Policy');
  expect(view.srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(view.srcdoc.indexOf('<title>'));
  await page.screenshot({ path: '../../_scratch/m2/reader-storage/compatible-reader.png', fullPage: true });
  await page.evaluate(() => window.compatibility.reader.dispose()); expect(unexpected).toEqual([]);
});

test('actual internal chapter/fragment links and TOC are serialized controller navigation; reflow and restore do not publish', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  expect((await openFixture(page, 'compatibility')).state).toBe('ready');
  const frame = page.frameLocator('iframe');
  await frame.locator('#internal').click();
  await expect.poll(() => page.evaluate(() => window.compatibility.publications.length)).toBe(1);
  expect((await snapshot(page)).ko).toBe('/body/DocFragment[2]/body/h1[1]');
  await page.evaluate(() => window.compatibility.reader.toc('one.xhtml'));
  expect((await snapshot(page)).publications).toBe(2);
  await frame.locator('#same-fragment').click();
  await expect.poll(() => page.evaluate(() => window.compatibility.publications.length)).toBe(3);
  const before = await snapshot(page); expect(before.ko).toBe('/body/DocFragment[1]/body/div[1]/p[1]');
  await page.evaluate(() => window.compatibility.reader.reflow(150));
  expect((await snapshot(page)).ko).toBe(before.ko); expect((await snapshot(page)).publications).toBe(3);
  const restored = await reopen(page); expect(restored).toEqual({ saved: before.ko, actual: before.ko, visible: true, state: 'ready', publications: 3 });
  const literal = await frame.locator('#asset-text').textContent(); expect(literal).toBe('drawing.svg font.woff2 style.css remain literal body text.');
  const assets = await page.locator('iframe').evaluate((f: HTMLIFrameElement) => {
    const doc = f.contentDocument!, style = f.contentWindow!.getComputedStyle(doc.getElementById('target')!);
    return { outline: style.outlineWidth, background: style.backgroundImage, useWidth: (doc.querySelector('use') as SVGGraphicsElement).getBBox().width, emptyChildren: doc.getElementById('empty-tree-node')!.children.length };
  });
  expect(assets.outline).toBe('2px'); expect(assets.background).toContain('blob:'); expect(assets.useWidth).toBe(20); expect(assets.emptyChildren).toBe(0);
  const passivity = await snapshot(page); expect(passivity.sandbox).toBe('allow-same-origin'); expect(passivity.firstHead).toContain('script-src');
  // Test-Only DOM Mutation - Even a new app-origin link injected after validation cannot cause native navigation or a checkpoint.
  await page.locator('iframe').evaluate((f: HTMLIFrameElement) => { const a = f.contentDocument!.createElement('a'); a.href = '/api/credential'; f.contentDocument!.body.appendChild(a); a.click(); });
  await expect.poll(() => page.evaluate(() => window.compatibility.state.state)).toBe('error');
  expect((await snapshot(page)).publications).toBe(3);
  await page.evaluate(() => window.compatibility.reader.dispose()); expect(unexpected).toEqual([]);
});

test('original Alice renders with its hash identity, real TOC, CSS and saved KO anchor under the selected boundary', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  const state = await openFixture(page, 'alice'); expect(state.state, state.message).toBe('ready');
  expect(state.toc!.length).toBeGreaterThan(0);
  await page.evaluate(() => window.compatibility.reader.toc(window.compatibility.state.toc![0]!.href));
  const current = await snapshot(page); expect(current.state).toBe('ready'); expect(current.publications).toBe(1);
  await page.evaluate(() => window.compatibility.reader.reflow(125));
  expect((await snapshot(page)).ko).toBe(current.ko); expect((await snapshot(page)).publications).toBe(1);
  expect(await reopen(page)).toMatchObject({ saved: current.ko, actual: current.ko, visible: true, state: 'ready', publications: 1 });
  const bytes = await page.evaluate(async () => {
    const p = window.proof, c = window.compatibility, policy = await p.validateEPUB(c.bytes);
    const source = policy.documents.get(policy.spine[p.parseKO(c.state.location!.ko).spine]!)!.querySelector('body')!;
    const rendered = c.host.querySelector('iframe')!.contentDocument!.body;
    const tree = (element: Element): string => JSON.stringify([element.localName, element.namespaceURI, element.id, Array.from(element.children).map(tree)]);
    const unchanged = tree(source) === tree(rendered) && source.textContent === rendered.textContent;
    if (!unchanged) {
      const flat = (element: Element) => Array.from(element.querySelectorAll('*')).map(child => `${child.localName}#${child.id}(${child.children.length})`);
      const expected = flat(source), actual = flat(rendered), index = expected.findIndex((item, i) => item !== actual[i]);
      throw new Error(JSON.stringify({ treeEqual: tree(source) === tree(rendered), textEqual: source.textContent === rendered.textContent, index, expected: expected.slice(index - 2, index + 5), actual: actual.slice(index - 2, index + 5), expectedText: source.textContent?.slice(0, 100), actualText: rendered.textContent?.slice(0, 100), srcdoc: c.host.querySelector('iframe')!.srcdoc.slice(c.host.querySelector('iframe')!.srcdoc.indexOf('figcenter c1') - 10, c.host.querySelector('iframe')!.srcdoc.indexOf('figcenter c1') + 150) }));
    }
    policy.dispose();
    return { size: c.bytes.byteLength, partial: p.partialMD5(c.bytes), full: p.fullMD5(await (await p.repository.open('local', 'alice')).bytes.arrayBuffer()), unchanged };
  });
  expect(bytes).toEqual({ size: 1402237, partial: '386d1cb51fe4a72e5c9fdad5e059bad9', full: '0f36c66155de34b281c4791654d0b1ce', unchanged: true });
  expect((await snapshot(page)).sandbox).toBe('allow-same-origin');
  await page.evaluate(() => window.compatibility.reader.dispose()); expect(unexpected).toEqual([]);
});

test('CSS/SVG/metadata/body active or escaping references reject before import publication and live parsing', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  const result = await page.evaluate(async () => {
    const p = window.proof, cases: string[] = await (await fetch('/fixtures/compat-hostile.json')).json();
    let rejected = 0, errorStates = 0;
    for (const name of cases) {
      const bytes = await (await fetch(`/fixtures/compat-hostile-${name}.epub`)).arrayBuffer();
      let failed = false;
      try { await p.repository.importBook('local', name, name, bytes); } catch { rejected++; failed = true; }
      if (!failed) throw new Error(`Hostile reference became available: ${name}`);
      const host = document.createElement('div'); document.body.appendChild(host); let state = '';
      const reader = new p.ReaderController(host, value => { state = value.state; }, async () => { throw new Error('Hostile content published progress'); });
      await reader.open(bytes); if (state === 'error') errorStates++;
      await reader.dispose(); host.remove();
    }
    return { cases: cases.length, rejected, errorStates, books: await p.repository.db.books.count(), checkpoints: await p.repository.db.checkpoints.count(), engines: p.lifecycle.engines };
  });
  expect(result).toEqual({ cases: 26, rejected: 26, errorStates: 26, books: 0, checkpoints: 0, engines: 0 });
  expect(unexpected).toEqual([]);
});

test('passive chapter remains script-disabled after test-controlled same-origin self-navigation without a target CSP', async ({ page }) => {
  await page.goto('/');
  const target = '/fixtures/passive-navigation-target.html';
  const unexpected = await watchRequests(page, target);
  expect((await openFixture(page, 'representative')).state).toBe('ready');
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement, target) => { frame.srcdoc = ''; frame.removeAttribute('srcdoc'); frame.src = target; }, target);
  await expect(page.frameLocator('iframe').getByText('Test-only same-origin navigation target.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => ({ sandbox: document.querySelector('iframe')!.getAttribute('sandbox'), dom: document.body.dataset.passivityBroken, storage: localStorage.getItem('passivity-broken'), publications: window.compatibility.publications.length }))).toEqual({ sandbox: 'allow-same-origin', dom: undefined, storage: null, publications: 0 });
  await page.evaluate(() => window.compatibility.reader.dispose()); expect(unexpected).toEqual([]);
});
