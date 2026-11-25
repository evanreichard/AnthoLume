import { expect, test } from '@playwright/test';
import type { ReaderStatus } from '../../controller';

test('ordinary XHTML renders without changing the saved reading position', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest;
    const zip = await p.JSZip.loadAsync(await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    const chapter = await zip.file('one.xhtml')!.async('string');
    zip.file(
      'one.xhtml',
      chapter.replace(
        /<body>[\s\S]*<\/body>/,
        '<body><p>Press <kbd>Enter</kbd>.</p><p id="resume">A <dfn>term</dfn> with <mark>highlighting</mark> and <var>x</var>.</p></body>',
      ),
    );
    const host = document.createElement('div');
    host.style.cssText = 'width:390px;height:650px';
    document.body.append(host);
    let status: ReaderStatus | undefined;
    let publications = 0;
    const reader = new p.ReaderController(
      host,
      (next) => {
        status = next;
      },
      async () => {
        publications++;
      },
    );
    const saved = '/body/DocFragment[1]/body/p[2]';
    try {
      await reader.open(await zip.generateAsync({ type: 'blob' }), saved);
      if (status?.state !== 'ready') throw new Error(status?.message ?? 'Reader did not open');
      const doc = host.querySelector('iframe')?.contentDocument;
      return {
        state: status?.state,
        restored: status?.location?.ko,
        anchor: doc && p.primaryElementFromKO(doc, saved)?.textContent,
        markup: [...(doc?.querySelectorAll('kbd, dfn, mark, var') ?? [])].map((node) => node.textContent),
        publications,
      };
    } finally {
      await reader.dispose();
      host.remove();
    }
  });
  expect(result).toEqual({
    state: 'ready',
    restored: '/body/DocFragment[1]/body/p[2]',
    anchor: 'A term with highlighting and x.',
    markup: ['Enter', 'term', 'highlighting', 'x'],
    publications: 0,
  });
});
test('packaged font/SVG/media styles and original rendered body survive; sandbox lifetime blocks scripts after privileged same-origin navigation', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      bytes = await (await fetch('/fixtures/representative.epub')).arrayBuffer();
    const policy = await p.validateEPUB(bytes),
      host = document.createElement('div');
    host.style.cssText = 'width:700px;height:480px';
    document.body.appendChild(host);
    const reader = new p.ReaderController(
      host,
      () => {},
      async () => {},
    );
    await reader.open(bytes);
    const frame = host.querySelector('iframe')!,
      doc = frame.contentDocument!;
    await doc.fonts.load('16px ProofLato');
    await doc.fonts.ready;
    const image = doc.getElementById('packaged-svg') as HTMLImageElement;
    await image.decode();
    const style = frame.contentWindow!.getComputedStyle(doc.getElementById('target')!);
    const tree = (node: Node): unknown =>
      node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE
        ? node.textContent
        : node.nodeType === Node.ELEMENT_NODE
          ? [
              (node as Element).namespaceURI,
              (node as Element).localName,
              (node as Element).id,
              [...node.childNodes].filter((c) => c.nodeType !== Node.COMMENT_NODE).map(tree),
            ]
          : null;
    const sameBody =
      JSON.stringify(tree((await policy.document(policy.spine[0]!)).querySelector('body')!)) ===
      JSON.stringify(tree(doc.body));
    const positive = {
      sameBody,
      color: style.color,
      border: style.borderTopWidth,
      font: [...doc.fonts].some((font) => font.family === 'ProofLato' && font.status === 'loaded'),
      svgWidth: image.naturalWidth,
      inlineSVG: doc.querySelectorAll('svg').length,
      url: image.getAttribute('src'),
    };
    frame.srcdoc =
      '<html><body><script>parent.document.body.dataset.passivityBroken="yes";parent.localStorage.setItem("passivity-broken","yes")</script></body></html>';
    await new Promise((resolve) => setTimeout(resolve, 100));
    const srcdocSafe = !document.body.dataset.passivityBroken && !localStorage.getItem('passivity-broken');
    frame.removeAttribute('srcdoc');
    frame.src = '/fixtures/passive-navigation-target.html';
    await new Promise((resolve) => setTimeout(resolve, 250));
    const navigationSafe = !document.body.dataset.passivityBroken && !localStorage.getItem('passivity-broken');
    await reader.dispose();
    policy.dispose();
    host.remove();
    return { ...positive, srcdocSafe, navigationSafe };
  });
  expect(result).toMatchObject({
    sameBody: true,
    color: 'rgb(12, 34, 56)',
    border: '3px',
    font: true,
    svgWidth: 80,
    inlineSVG: 1,
    srcdocSafe: true,
    navigationSafe: true,
  });
  expect(result.url).toMatch(/^blob:/);
});
