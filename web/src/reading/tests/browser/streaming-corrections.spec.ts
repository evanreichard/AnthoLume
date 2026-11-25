import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
});

test('twelve settled invalid source targets retain <=2 real engine DOMs, no inactive leases, current display and checkpoint', async ({
  page,
}) => {
  test.setTimeout(60000);
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      zip = await p.JSZip.loadAsync(await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
    let opf = await zip.file('book.opf')?.async('string');
    const opfName = Object.keys(zip.files).find((n) => n.endsWith('.opf'))!;
    opf ||= await zip.file(opfName)!.async('string');
    let items = '',
      spine = '',
      links = '';
    for (let n = 0; n < 12; n++) {
      zip.file(
        `bad${n}.xhtml`,
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Invalid target</title><link rel="stylesheet" href="s${n}.css"/></head><body><h1>Bounded source ${n}</h1><svg xmlns="http://www.w3.org/2000/svg"><text id="unsupported">Unsupported position namespace</text></svg></body></html>`,
      );
      zip.file(`s${n}.css`, 'p{color:blue}');
      items += `<item id="b${n}" href="bad${n}.xhtml" media-type="application/xhtml+xml"/><item id="s${n}" href="s${n}.css" media-type="text/css"/>`;
      spine += `<itemref idref="b${n}"/>`;
      links += `<li><a href="bad${n}.xhtml#unsupported">Invalid ${n}</a></li>`;
    }
    zip.file(opfName, opf.replace('</manifest>', items + '</manifest>').replace('</spine>', spine + '</spine>'));
    zip.file('nav.xhtml', (await zip.file('nav.xhtml')!.async('string')).replace('</ol>', links + '</ol>'));
    const host = document.createElement('div');
    host.style.cssText = 'width:390px;height:650px';
    document.body.appendChild(host);
    let state = '',
      publications = 0;
    const reader = new p.ReaderController(
      host,
      (status) => {
        state = status.state;
      },
      async () => {
        publications++;
      },
      { localOnly: true },
    );
    await reader.open(await zip.generateAsync({ type: 'blob' }));
    const original = host.querySelector('iframe')!.contentDocument!.body.textContent,
      samples = [];
    for (let n = 0; n < 12; n++) {
      await reader.toc(`bad${n}.xhtml#unsupported`);
      samples.push({
        state,
        ...reader.diagnostics(),
        iframes: host.querySelectorAll('iframe').length,
        sameDisplay: host.querySelector('iframe')!.contentDocument!.body.textContent === original,
        publications,
      });
    }
    await reader.toc('two.xhtml');
    const recovered = state;
    await reader.dispose();
    host.remove();
    return { samples, recovered };
  });
  for (const sample of result.samples) {
    expect(sample.state).toBe('error');
    expect(sample.loadedSections).toBeLessThanOrEqual(2);
    expect(sample.cache!.cachedDOMs).toBeLessThanOrEqual(2);
    expect(sample.cache!.urls).toBeLessThanOrEqual(1);
    expect(sample.contentDocuments).toBe(1);
    expect(sample.iframes).toBe(1);
    expect(sample.sameDisplay).toBe(true);
    expect(sample.publications).toBe(0);
  }
  expect(result.recovered).toBe('ready');
});

test('canonical child/sibling/anchor writes round-trip exactly; historical child-first and descendant fallback remain unchanged', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      source =
        '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><div><blockquote><p id="nested">N</p></blockquote><p id="first">F</p><p id="second">S</p><h1><a><img id="anchored"/></a></h1></div></body></html>',
      doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    const paths = ['nested', 'first', 'second', 'anchored'].map((id) => {
      const node = doc.getElementById(id)!,
        ko = p.koFromElement(0, node);
      return { id, ko, same: p.primaryElementFromKO(doc, ko) === node };
    });
    const old = '/body/DocFragment[1]/body/div[1]/p[3]/text()[1].23';
    return {
      paths,
      old,
      fallback: p.elementFromKO(doc, old).id,
      primary: p.elementFromKO(doc, '/body/DocFragment[1]/body/div[1]/p[2]').id,
    };
  });
  expect(result.paths).toEqual([
    { id: 'nested', ko: '/body/DocFragment[1]/body/div[1]/blockquote[1]/p[1]', same: true },
    { id: 'first', ko: '/body/DocFragment[1]/body/div[1]/p[1]', same: true },
    { id: 'second', ko: '/body/DocFragment[1]/body/div[1]/p[2]', same: true },
    { id: 'anchored', ko: '/body/DocFragment[1]/body/div[1]/h1[1]/a[1]/img[1]', same: true },
  ]);
  expect(result.fallback).toBe('second');
  expect(result.primary).toBe('second');
  expect(result.old).toBe('/body/DocFragment[1]/body/div[1]/p[3]/text()[1].23');
});

test('real native CFI round trips retain incoming legacy suffix bytes and write canonical repeated tags and authored anchors', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      zip = await p.JSZip.loadAsync(await (await fetch('/fixtures/synthetic.epub')).arrayBuffer()),
      chapter = await zip.file('one.xhtml')!.async('string');
    zip.file(
      'one.xhtml',
      chapter.replace(
        /<body>[\s\S]*<\/body>/,
        '<body><div><blockquote><p id="nested">Nested source words.</p></blockquote><p id="first">First direct paragraph source.</p><p id="second">Second direct paragraph source.</p><h1><a><img id="anchored" src="pixel.png" width="16" height="8"/></a></h1></div></body>',
      ),
    );
    zip.file(
      'nav.xhtml',
      (await zip.file('nav.xhtml')!.async('string')).replace(
        '</ol>',
        ['first', 'second', 'anchored'].map((id) => `<li><a href="one.xhtml#${id}">${id}</a></li>`).join('') + '</ol>',
      ),
    );
    const host = document.createElement('div');
    host.style.cssText = 'width:390px;height:650px';
    document.body.append(host);
    let status: import('../../controller').ReaderStatus = { state: 'opening', message: '' };
    const publications: string[] = [],
      old = '/body/DocFragment[1]/body/div[1]/p[3]/text()[1].23';
    const reader = new p.ReaderController(
      host,
      (value) => {
        status = value;
      },
      async (location) => {
        publications.push(location.ko);
      },
      { localOnly: true },
    );
    await reader.open(await zip.generateAsync({ type: 'blob' }), old);
    const opened = status.location!.ko;
    await reader.reflow(130, 'sans-serif');
    const reflowed = status.location!.ko,
      passiveWrites = publications.length;
    const visible = (element: Element) => {
      const frame = host.querySelector('iframe')!,
        origin = frame.getBoundingClientRect(),
        viewport = host.getBoundingClientRect();
      return [...element.getClientRects()].some(
        (r) =>
          r.right + origin.left > viewport.left &&
          r.left + origin.left < viewport.right &&
          r.bottom + origin.top > viewport.top &&
          r.top + origin.top < viewport.bottom,
      );
    };
    const legacyVisible = visible(p.elementFromKO(host.querySelector('iframe')!.contentDocument!, old)),
      targets = [];
    for (const id of ['first', 'second', 'anchored']) {
      await reader.toc(`one.xhtml#${id}`);
      const doc = host.querySelector('iframe')!.contentDocument!,
        node = doc.getElementById(id)!,
        ko = status.location!.ko;
      targets.push({
        id,
        ko,
        primary: p.primaryElementFromKO(doc, ko) === node,
        visible: visible(node),
        ready: status.state === 'ready',
      });
    }
    await reader.dispose();
    host.remove();
    return { opened, reflowed, passiveWrites, legacyVisible, publications, targets };
  });
  expect(result).toMatchObject({
    opened: '/body/DocFragment[1]/body/div[1]/p[3]/text()[1].23',
    reflowed: '/body/DocFragment[1]/body/div[1]/p[3]/text()[1].23',
    passiveWrites: 0,
    legacyVisible: true,
  });
  expect(result.publications).toEqual([
    '/body/DocFragment[1]/body/div[1]/p[1]',
    '/body/DocFragment[1]/body/div[1]/p[2]',
    '/body/DocFragment[1]/body/div[1]/h1[1]/a[1]/img[1]',
  ]);
  for (const target of result.targets) expect(target).toMatchObject({ ready: true, primary: true, visible: true });
});

test('intrinsic placeholders preserve authored geometry before load, release and reload; READY pixels are the real asset', async ({
  page,
}) => {
  test.setTimeout(120000);
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(23,154,233)';
    ctx.fillRect(0, 0, 16, 8);
    const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
    const native = Worker,
      results = [];
    for (const attributes of [
      '',
      'width="200"',
      'height="80"',
      'width="200" height="100"',
      'width="100%"',
      'style="width:100%"',
      'style="width:200px"',
      'style="height:80px"',
    ]) {
      const zip = await p.JSZip.loadAsync(await (await fetch('/fixtures/synthetic.epub')).arrayBuffer());
      zip.file('pixel.png', await png.arrayBuffer());
      const chapter = await zip.file('one.xhtml')!.async('string');
      zip.file('one.xhtml', chapter.replace('<body>', `<body><img id="sized" src="pixel.png" ${attributes}/>`));
      const file = await zip.generateAsync({ type: 'blob' }),
        policy = await p.validateEPUB(file),
        manifest = policy.manifest;
      policy.dispose();
      const host = document.createElement('div');
      host.style.cssText = 'width:390px;height:650px';
      document.body.appendChild(host);
      let state = '',
        held: (() => void) | undefined;
      window.Worker = new Proxy(native, {
        construct(target, args) {
          const worker = Reflect.construct(target, args) as Worker,
            post = worker.postMessage.bind(worker);
          worker.postMessage = ((data: { operation?: string; entry?: { name: string } }, transfer?: Transferable[]) => {
            if (data.operation === 'entry' && data.entry?.name === 'pixel.png' && !held)
              held = () => post(data, transfer || []);
            else post(data, transfer || []);
          }) as typeof worker.postMessage;
          return worker;
        },
      });
      const reader = new p.ReaderController(
          host,
          (value) => {
            state = value.state;
          },
          async () => {},
          { localOnly: true },
        ),
        opening = reader.open(p.blobSource(file), undefined, undefined, manifest);
      for (let i = 0; !held && i < 200; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      if (!held) throw new Error('Real image request was not held');
      const doc = host.querySelector('iframe')!.contentDocument!,
        image = doc.getElementById('sized') as HTMLImageElement;
      await image.decode();
      const placeholder = image.getAttribute('src')!,
        preloadState = state;
      const authored = new DOMParser()
        .parseFromString(
          `<html xmlns="http://www.w3.org/1999/xhtml"><body><img id="sized" ${attributes}/></body></html>`,
          'application/xhtml+xml',
        )
        .querySelector('img')!;
      const reference = doc.importNode(authored, false) as HTMLImageElement,
        url = URL.createObjectURL(png);
      reference.src = url;
      image.after(reference);
      await reference.decode();
      const r = reference.getBoundingClientRect(),
        expected = [r.width, r.height];
      reference.remove();
      URL.revokeObjectURL(url);
      const size = () => {
          const r = image.getBoundingClientRect();
          return [r.width, r.height];
        },
        before = size();
      held();
      window.Worker = native;
      await opening;
      const pixels = () => {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        const cx = c.getContext('2d')!;
        cx.drawImage(image, 0, 0, 1, 1);
        return [...cx.getImageData(0, 0, 1, 1).data];
      };
      const loaded = size(),
        real = image.getAttribute('src') !== placeholder && image.complete && pixels().join() === '23,154,233,255',
        ready = state;
      await reader.next();
      await reader.next();
      const released = size(),
        offscreenPlaceholder = image.getAttribute('src') === placeholder;
      await reader.previous();
      await reader.previous();
      const reloaded = size(),
        realAgain = image.getAttribute('src') !== placeholder && image.complete && pixels().join() === '23,154,233,255';
      const attrsPreserved = ['width', 'height'].every(
        (name) => image.getAttribute(name) === authored.getAttribute(name),
      );
      results.push({
        attributes,
        expected,
        before,
        loaded,
        released,
        reloaded,
        real,
        realAgain,
        ready,
        state,
        preloadState,
        offscreenPlaceholder,
        attrsPreserved,
      });
      await reader.dispose();
      host.remove();
    }
    window.Worker = native;
    return results;
  });
  for (const row of result) {
    for (const phase of ['before', 'loaded', 'released', 'reloaded'] as const) {
      expect(row[phase][0], `${row.attributes}: ${phase} width`).toBeCloseTo(row.expected[0]!, 1);
      expect(row[phase][1], `${row.attributes}: ${phase} height`).toBeCloseTo(row.expected[1]!, 1);
    }
    expect(row).toMatchObject({
      real: true,
      realAgain: true,
      ready: 'ready',
      state: 'ready',
      preloadState: 'opening',
      offscreenPlaceholder: true,
      attrsPreserved: true,
    });
  }
});
