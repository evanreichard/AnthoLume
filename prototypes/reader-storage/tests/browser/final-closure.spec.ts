import { test, expect } from '@playwright/test';
import { watchRequests } from './support';

test('review raw-text reproductions and case/delimiter/CSS-string variants reject at import/open before engine creation', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  const result = await page.evaluate(async () => {
    const p = window.proof, cases: string[] = await (await fetch('/fixtures/closure-rawtext.json')).json();
    const hashes: Record<string, { sha256: string }> = await (await fetch('/fixtures/closure-fixtures.json')).json();
    let rejected = 0, errors = 0, immutable = 0, publications = 0;
    for (const name of cases) {
      const bytes = await (await fetch(`/fixtures/${name}.epub`)).arrayBuffer();
      const hash = async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (await hash() !== hashes[name]!.sha256) throw new Error('Fixture differs from original reproduction/variant');
      let failed = false;
      try { await p.repository.importBook('local', name, name, bytes); } catch { failed = true; rejected++; }
      if (!failed) throw new Error(`Unsafe raw text became available: ${name}`);
      const host = document.createElement('div'); document.body.appendChild(host); let state = '';
      const reader = new p.ReaderController(host, value => { state = value.state; }, async () => { publications++; });
      await reader.open(bytes); if (state === 'error') errors++;
      await reader.dispose(); host.remove();
      if (await hash() === hashes[name]!.sha256) immutable++;
    }
    return { cases: cases.length, rejected, errors, immutable, publications, engines: p.lifecycle.engines, books: await p.repository.db.books.count(), checkpoints: await p.repository.db.checkpoints.count() };
  });
  expect(result).toEqual({ cases: 9, rejected: 9, errors: 9, immutable: 9, publications: 0, engines: 0, books: 0, checkpoints: 0 });
  expect(unexpected).toEqual([]);
});

test('inert whole-document guard independently detects head-to-body manufacture without executing or fetching', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  const result = await page.evaluate(() => {
    const doc = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><head><style><![CDATA[/* </style><img id="head-manufactured" src="https://whole-document-closure.invalid/probe"/> */]]></style></head><body><p id="original">Original body</p></body></html>', 'application/xhtml+xml');
    const before = doc.querySelector('body')!.outerHTML;
    let rejected = false;
    try { window.proof.requireStableBody(doc); } catch (error) { rejected = String(error).includes('head/body KO structure'); }
    const benign = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><head><style><![CDATA[@media(min-width:100px){p{color:rgb(12,34,56)}}/* </stylesheet> is not an HTML end tag */]]></style></head><body><p id="original">Original body</p></body></html>', 'application/xhtml+xml');
    window.proof.requireStableBody(benign);
    return { rejected, originalUnchanged: before === doc.querySelector('body')!.outerHTML, liveManufactured: !!document.getElementById('head-manufactured'), engines: window.proof.lifecycle.engines };
  });
  expect(result).toEqual({ rejected: true, originalUnchanged: true, liveManufactured: false, engines: 0 }); expect(unexpected).toEqual([]);
});

for (const [fixture, navPath, selected] of [
  ['closure-review-subdir-toc', 'OPS/navigation/toc.xhtml', '../two.xhtml'],
  ['closure-subdir-ncx', 'OPS/navigation/toc.ncx', '../two.xhtml#second']
]) test(`relocated ${navPath} selects chapter two once with original bytes, body and raw hrefs`, async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  const result = await page.evaluate(async ({ fixture, navPath, selected }) => {
    const p = window.proof, bytes = await (await fetch(`/fixtures/${fixture}.epub`)).arrayBuffer();
    const beforeHash = p.fullMD5(bytes), policy = await p.validateEPUB(bytes);
    const navBefore = new TextDecoder().decode(policy.data.get(navPath)!);
    const opfBefore = new TextDecoder().decode(policy.data.get(policy.opf)!);
    const sourceBody = new DOMParser().parseFromString(new TextDecoder().decode(policy.data.get('OPS/two.xhtml')!), 'application/xhtml+xml').querySelector('body')!;
    await p.repository.importBook('local', fixture, fixture, bytes);
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    let state: import('../../src/controller').ReaderStatus = { state: 'opening', message: '' }; let publications = 0;
    const reader = new p.ReaderController(host, value => { state = value; }, async location => { await p.repository.accept('local', fixture, location.ko); publications++; });
    await reader.open(bytes);
    const initialState = state.state, initialPublications = publications, rawHrefs = state.toc?.map(item => item.href);
    await reader.toc(selected);
    const finalState = state.state, finalHrefs = state.toc?.map(item => item.href), ko = state.location?.ko;
    const rendered = host.querySelector('iframe')!.contentDocument!.body;
    const tree = (element: Element): string => JSON.stringify([element.namespaceURI, element.localName, element.id, Array.from(element.children).map(tree)]);
    const bodyUnchanged = tree(sourceBody) === tree(rendered) && sourceBody.textContent === rendered.textContent;
    let denied = 0;
    for (const value of ['https://navigation-closure.invalid/chapter', '../absent.xhtml', '../two.xhtml#absent']) try { await reader.toc(value); } catch { denied++; }
    const stored = await (await p.repository.open('local', fixture)).bytes.arrayBuffer();
    const storedPolicy = await p.validateEPUB(stored);
    const navUnchanged = navBefore === new TextDecoder().decode(storedPolicy.data.get(navPath)!);
    const opfUnchanged = opfBefore === new TextDecoder().decode(storedPolicy.data.get(policy.opf)!);
    const checkpoint = await p.repository.db.checkpoints.get(p.bookKey('local', fixture));
    const sandbox = host.querySelector('iframe')!.getAttribute('sandbox');
    await reader.dispose(); host.remove(); policy.dispose(); storedPolicy.dispose();
    return { initialState, initialPublications, finalState, rawHrefs, finalHrefs, ko, publications, denied, bodyUnchanged, navUnchanged, opfUnchanged, byteHashUnchanged: beforeHash === p.fullMD5(stored) && beforeHash === p.fullMD5(bytes), checkpoint: checkpoint?.ko, sandbox, engines: p.lifecycle.engines, destroyed: p.lifecycle.destroyed, listeners: p.lifecycle.listeners, contentListeners: p.lifecycle.contentListeners };
  }, { fixture: fixture!, navPath: navPath!, selected: selected! });
  expect(result).toMatchObject({ initialState: 'ready', initialPublications: 0, finalState: 'ready', publications: 1, denied: 3, bodyUnchanged: true, navUnchanged: true, opfUnchanged: true, byteHashUnchanged: true, sandbox: 'allow-same-origin', engines: 1, destroyed: 1, listeners: 0, contentListeners: 0 });
  expect(result.rawHrefs).toContain(selected); expect(result.finalHrefs).toEqual(result.rawHrefs);
  expect(result.ko).toMatch(/^\/body\/DocFragment\[2\]/); expect(result.checkpoint).toBe(result.ko); expect(unexpected).toEqual([]);
});

test('external and missing-fragment NAV/NCX targets still reject before availability/engine creation', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  const result = await page.evaluate(async () => {
    const p = window.proof, cases: string[] = await (await fetch('/fixtures/closure-invalid-navigation.json')).json(); let rejected = 0, errors = 0, publications = 0;
    for (const fixture of cases) {
      const bytes = await (await fetch(`/fixtures/${fixture}.epub`)).arrayBuffer();
      try { await p.repository.importBook('local', fixture, fixture, bytes); } catch { rejected++; }
      const host = document.createElement('div'); document.body.appendChild(host); let state = '';
      const reader = new p.ReaderController(host, value => { state = value.state; }, async () => { publications++; });
      await reader.open(bytes); if (state === 'error') errors++;
      await reader.dispose(); host.remove();
    }
    return { cases: cases.length, rejected, errors, publications, engines: p.lifecycle.engines, books: await p.repository.db.books.count(), checkpoints: await p.repository.db.checkpoints.count() };
  });
  expect(result).toEqual({ cases: 4, rejected: 4, errors: 4, publications: 0, engines: 0, books: 0, checkpoints: 0 }); expect(unexpected).toEqual([]);
});

test('the original review SVG style raw-text control remains inert and allowed, not blanket-rejected', async ({ page }) => {
  await page.goto('/'); const unexpected = await watchRequests(page);
  const result = await page.evaluate(async () => {
    const p = window.proof, bytes = await (await fetch('/fixtures/closure-review-body-svg-css-rawtext.epub')).arrayBuffer();
    const before = p.fullMD5(bytes); await p.validateEPUB(bytes);
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host); let state = ''; let publications = 0;
    const reader = new p.ReaderController(host, value => { state = value.state; }, async () => { publications++; });
    await reader.open(bytes);
    const doc = host.querySelector('iframe')!.contentDocument!;
    const manufactured = !!doc.getElementById('rawtext-probe');
    const svgStyle = Array.from(doc.querySelectorAll('style')).find(element => element.namespaceURI === 'http://www.w3.org/2000/svg');
    const inertText = svgStyle?.textContent?.includes('</style>');
    await reader.dispose(); host.remove(); return { state, publications, manufactured, inertText, unchanged: before === p.fullMD5(bytes) };
  });
  expect(result).toEqual({ state: 'ready', publications: 0, manufactured: false, inertText: true, unchanged: true }); expect(unexpected).toEqual([]);
});
