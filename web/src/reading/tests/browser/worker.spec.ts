import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.readingTest);
});

test('source constructor and transfer failures release slots; subsequent actual source work succeeds', async ({
  page,
}) => {
  test.setTimeout(15000);
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      native = Worker,
      source = p.blobSource(new Blob(['not a ZIP'])),
      errors: string[] = [];
    let terminated = 0;
    try {
      window.Worker = new Proxy(native, {
        construct() {
          throw new DOMException('Worker creation denied', 'SecurityError');
        },
      });
      for (let i = 0; i < 3; i++)
        try {
          await p.sourceTask(source, 'index');
        } catch (error) {
          errors.push((error as Error).name);
        }
      const afterConstructor = p.sourceScheduler.active;
      window.Worker = new Proxy(native, {
        construct(target, args) {
          const worker = Reflect.construct(target, args) as Worker,
            terminate = worker.terminate.bind(worker);
          worker.terminate = () => {
            terminated++;
            terminate();
          };
          worker.postMessage = () => {
            throw new DOMException('Transfer rejected', 'DataCloneError');
          };
          return worker;
        },
      });
      for (let i = 0; i < 3; i++)
        try {
          await p.sourceTask(source, 'index');
        } catch (error) {
          errors.push((error as Error).name);
        }
      return {
        errors,
        afterConstructor,
        afterTransfer: p.sourceScheduler.active,
        queued: p.sourceScheduler.queued,
        terminated,
      };
    } finally {
      window.Worker = native;
    }
  });
  expect(result.afterConstructor).toBe(0);
  expect(result.afterTransfer).toBe(0);
  expect(result.queued).toBe(0);
  expect(result.terminated).toBe(3);
  expect(result.errors).toEqual([
    'SecurityError',
    'SecurityError',
    'SecurityError',
    'DataCloneError',
    'DataCloneError',
    'DataCloneError',
  ]);
  const count = await page.evaluate(async () => {
    const p = window.readingTest,
      blob = await (await fetch('/fixtures/synthetic.epub')).blob();
    return (await p.sourceTask<import('../../source').ZipIndex>(p.blobSource(blob), 'index')).entries.length;
  });
  expect(count).toBeGreaterThan(3);
});

test('the parent terminates a busy worker at its no-progress deadline and releases the slot', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.route('**/source.worker.ts*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `self.onmessage = () => { new BroadcastChannel('deadline-test').postMessage('busy'); for (;;) {} };`,
    }),
  );
  const closed = page.waitForEvent('worker').then((worker) => worker.waitForEvent('close'));
  const task = await page.evaluateHandle(() => {
    const p = window.readingTest,
      channel = new BroadcastChannel('deadline-test');
    const busy = new Promise<void>((resolve) => {
      channel.onmessage = () => {
        channel.close();
        resolve();
      };
    });
    const outcome = p.sourceTask(p.blobSource(new Blob(['x'])), 'index').then(() => 'completed', String);
    return { busy, outcome };
  });
  await task.evaluate((t) => t.busy);
  await page.clock.fastForward(9999);
  expect(await page.evaluate(() => window.readingTest.sourceScheduler.active)).toBe(1);
  await page.clock.fastForward(1);
  expect(await task.evaluate((t) => t.outcome)).toContain('No progress while indexing the EPUB');
  await closed;
  expect(await page.evaluate(() => ({ ...window.readingTest.sourceScheduler }))).toMatchObject({
    active: 0,
    queued: 0,
  });
});

test('bounded source queue rejects overflow and abort physically terminates busy and queued work', async ({ page }) => {
  let spawned = 0,
    closed = 0;
  page.on('worker', (worker) => {
    spawned++;
    worker.on('close', () => {
      closed++;
    });
  });
  await page.route('**/source.worker.ts*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `self.onmessage = () => { new BroadcastChannel('queue-test').postMessage('busy'); for (;;) {} };`,
    }),
  );
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      controller = new AbortController(),
      source = p.blobSource(new Blob(['x']));
    const channel = new BroadcastChannel('queue-test');
    const bothBusy = new Promise<void>((resolve) => {
      let busy = 0;
      channel.onmessage = () => {
        if (++busy === 2) resolve();
      };
    });
    const tasks = Array.from({ length: 20 }, () => p.sourceTask(source, 'index', undefined, controller.signal)),
      settled = Promise.allSettled(tasks);
    const queued = p.sourceScheduler.queued;
    await bothBusy;
    channel.close();
    controller.abort();
    const outcomes = await settled;
    return {
      queued,
      aborts: outcomes.filter((o) => o.status === 'rejected' && o.reason.name === 'AbortError').length,
      overflow: outcomes.filter((o) => o.status === 'rejected' && String(o.reason).includes('queue budget')).length,
      scheduler: { ...p.sourceScheduler },
    };
  });
  expect(result).toMatchObject({ queued: 16, aborts: 18, overflow: 2 });
  expect(result.scheduler.active).toBe(0);
  expect(result.scheduler.queued).toBe(0);
  expect(result.scheduler.peak).toBe(2);
  expect(spawned).toBe(2);
  await expect.poll(() => closed).toBe(2);
});

test('NAV and chapter read failures settle the pinned engine and retain checkpoints without publication', async ({
  page,
}) => {
  test.setTimeout(15000);
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      repo = new p.Repository(new p.ReadingDB(`engine-failure-${crypto.randomUUID()}`)),
      ref = { kind: 'local' as const, localId: 'retained' },
      file = await (await fetch('/fixtures/synthetic.epub')).blob();
    await repo.install(ref, file, null, null, null);
    const rows = [];
    for (const kind of ['navigation', 'chapter']) {
      const opened = await repo.open(ref),
        name = kind === 'navigation' ? opened.manifest.navigation[0]! : opened.manifest.spine[0]!;
      opened.manifest.index.entries.find((e) => e.name === name)!.digest = '0'.repeat(64);
      const host = document.createElement('div');
      document.body.appendChild(host);
      let state = '',
        message = '',
        publications = 0;
      const reader = new p.ReaderController(
        host,
        (value) => {
          state = value.state;
          message = value.message;
        },
        async () => {
          publications++;
        },
      );
      await reader.open(opened.source, undefined, undefined, opened.manifest);
      await reader.dispose();
      host.remove();
      rows.push({ kind, state, message, publications });
    }
    const output = {
      rows,
      events: await repo.db.events.count(),
      checkpoint: (await repo.db.books.toArray())[0]!.checkpoint,
      workers: p.sourceScheduler.active,
      engines: p.lifecycle.engines,
      destroyed: p.lifecycle.destroyed,
    };
    await repo.db.delete();
    return output;
  });
  expect(result.rows).toHaveLength(2);
  for (const row of result.rows) {
    expect(row.state).toBe('error');
    expect(row.message).toContain('integrity');
    expect(row.publications).toBe(0);
  }
  expect(result.events).toBe(0);
  expect(result.checkpoint).toEqual({ position: null, fraction: null });
  expect(result.workers).toBe(0);
  expect(result.engines).toBe(result.destroyed);
});

test('controller disposal cancels its own live hash worker even without an external AbortSignal', async ({ page }) => {
  test.setTimeout(15000);
  await page.route('**/source.worker.ts*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () => { for (;;) {} };' }),
  );
  const workerEvent = page.waitForEvent('worker');
  await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reader = new window.readingTest.ReaderController(
      host,
      () => {},
      async () => {},
    );
    Object.assign(window, { disposalReader: reader, disposalOpen: reader.open(new Blob(['x'])) });
  });
  const worker = await workerEvent,
    closed = new Promise<void>((resolve) => worker.once('close', () => resolve()));
  await page.evaluate(async () => {
    const w = window as unknown as {
      disposalReader: import('../../controller').ReaderController;
      disposalOpen: Promise<void>;
    };
    await w.disposalReader.dispose();
    await w.disposalOpen;
  });
  await closed;
  expect(await page.evaluate(() => window.readingTest.sourceScheduler.active)).toBe(0);
});

test('raw worker IDB transaction abort cleans original staging and leaves durable events untouched', async ({
  page,
}) => {
  await page.route('**/staging.worker.ts*', async (route) => {
    const response = await route.fetch(),
      original = await response.text();
    await route.fulfill({
      response,
      body: `const originalPut = IDBObjectStore.prototype.put; let stagedPuts=0; IDBObjectStore.prototype.put=function(...args){const request=originalPut.apply(this,args);if(this.name==='sourceChunks'&&++stagedPuts===2)this.transaction.abort();return request;};\n${original}`,
    });
  });
  const result = await page.evaluate(async () => {
    const p = window.readingTest,
      repo = new p.Repository(new p.ReadingDB(`raw-abort-${crypto.randomUUID()}`));
    await repo.db.events.add({
      id: 'pending-before-io',
      key: 'original-key',
      scope: 'original-account',
      created: 1,
      kind: 'activity',
      payload: {
        event_id: 'pending-before-io',
        document_id: 'original-server',
        device_id: 'original-device',
        start_time: '2026-01-01T00:00:00Z',
        duration: 30,
        start_fraction: 0.1,
        end_fraction: 0.2,
      },
    });
    let rejected = false;
    try {
      await repo.stageStream({ kind: 'local', localId: 'failure' }, new Blob([new Uint8Array(800000)]).stream());
    } catch {
      rejected = true;
    }
    const output = {
      rejected,
      sources: await repo.db.sources.count(),
      chunks: await repo.db.sourceChunks.count(),
      books: await repo.db.books.count(),
      pending: (await repo.pending()).map((e) => e.id),
      writers: p.stagingWorkers.active,
    };
    await repo.db.delete();
    return output;
  });
  expect(result).toEqual({
    rejected: true,
    sources: 0,
    chunks: 0,
    books: 0,
    pending: ['pending-before-io'],
    writers: 0,
  });
});
