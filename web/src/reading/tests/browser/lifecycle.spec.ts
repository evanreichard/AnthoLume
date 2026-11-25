import { expect, test } from '@playwright/test';
test('actual global listener and owned object-URL baselines return after repeated real mounts, including native fonts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const urls = new Set<string>(),
      listeners: {
        target: EventTarget;
        type: string;
        callback: EventListenerOrEventListenerObject | null;
        capture: boolean;
      }[] = [];
    const add = EventTarget.prototype.addEventListener,
      remove = EventTarget.prototype.removeEventListener,
      watched = new Set(['keydown', 'resize', 'orientationchange', 'orientationChange', 'unload', 'visibilitychange']);
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      if (
        (this === window || this === document) &&
        watched.has(type) &&
        !listeners.some((x) => x.target === this && x.type === type && x.callback === callback && x.capture === capture)
      )
        listeners.push({ target: this, type, callback, capture });
      return add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (type, callback, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture,
        index = listeners.findIndex(
          (x) => x.target === this && x.type === type && x.callback === callback && x.capture === capture,
        );
      if (index !== -1) listeners.splice(index, 1);
      return remove.call(this, type, callback, options);
    };
    const create = URL.createObjectURL,
      revoke = URL.revokeObjectURL;
    URL.createObjectURL = (value) => {
      const url = create(value);
      urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (value) => {
      urls.delete(value);
      revoke(value);
    };
    Object.assign(window, {
      resourceEvidence: () => ({ urls: urls.size, listeners: listeners.map((x) => x.type).sort() }),
    });
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const evidence = () =>
      page.evaluate(() =>
        (window as unknown as { resourceEvidence(): { urls: number; listeners: string[] } }).resourceEvidence(),
      ),
    baseline = await evidence();
  for (const fixture of ['synthetic', 'representative', 'large-media']) {
    await page.evaluate(async (fixture) => {
      const p = window.readingTest,
        bytes = await (await fetch(`/fixtures/${fixture}.epub`)).arrayBuffer(),
        host = document.createElement('div');
      host.style.cssText = 'width:700px;height:480px';
      document.body.appendChild(host);
      const reader = new p.ReaderController(
        host,
        () => {},
        async () => {},
        { localOnly: true },
      );
      await reader.open(bytes);
      await reader.reflow(120, 'Lato');
      await reader.next();
      Object.assign(window, { mountedReader: reader, readerHost: host });
    }, fixture);
    expect((await evidence()).urls).toBeGreaterThan(baseline.urls);
    await page.evaluate(async () => {
      const refs = window as unknown as {
        mountedReader: import('../../controller').ReaderController;
        readerHost: HTMLElement;
      };
      await refs.mountedReader.dispose();
      refs.readerHost.remove();
    });
    await expect.poll(evidence).toEqual(baseline);
  }
});
test('ten commands serialize; concurrent/repeated open rejects and disposal suppresses late engine publication', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer(),
      host = document.createElement('div');
    host.style.cssText = 'width:700px;height:480px';
    document.body.appendChild(host);
    const positions: string[] = [];
    let dead = false,
      late = 0,
      rejected = 0;
    const reader = new p.ReaderController(
      host,
      () => {
        if (dead) late++;
      },
      async (location) => {
        if (dead) late++;
        positions.push(location.cfi);
      },
      { localOnly: true },
    );
    const opening = reader.open(bytes);
    try {
      await reader.open(bytes);
    } catch {
      rejected++;
    }
    await opening;
    try {
      await reader.open(bytes);
    } catch {
      rejected++;
    }
    await Promise.all(Array.from({ length: 10 }, () => reader.next()));
    const pending = reader.next();
    dead = true;
    await reader.dispose();
    await pending;
    await reader.dispose();
    const cancelled = new p.ReaderController(
      host,
      () => {
        late++;
      },
      async () => {
        late++;
      },
    );
    const pendingOpen = cancelled.open(bytes);
    await cancelled.dispose();
    await pendingOpen;
    host.remove();
    return {
      count: positions.length,
      unique: new Set(positions).size,
      rejected,
      late,
      engines: p.lifecycle.engines,
      destroyed: p.lifecycle.destroyed,
    };
  });
  expect(result).toEqual({ count: 10, unique: 10, rejected: 2, late: 0, engines: 1, destroyed: 1 });
});
