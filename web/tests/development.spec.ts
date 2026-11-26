import { spawn, type ChildProcess } from 'node:child_process';
import { Console } from 'node:console';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { createLogger, createServer, type ViteDevServer } from 'vite';
import { test, expect, epub, register, root } from './fixtures';

async function stop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Development process shutdown timeout'));
    }, 8000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  child.kill('SIGTERM');
  await exited;
}

test('loopback Vite serves development routes while proxying APIs and enforcing the exact public Origin', async ({
  page,
  serverBinary,
  dataDir: data,
}, testInfo) => {
  await mkdir(`${data}/documents`, { recursive: true });
  await writeFile(`${data}/documents/public.epub`, await epub());
  const host = '127.0.0.1';
  const backendTarget = new URL(`http://${host}:0`);
  let vite: ViteDevServer | undefined;
  let backend: ChildProcess | undefined;
  let logs = '';
  const log = (value: unknown) => {
    logs = (logs + String(value)).slice(-16000);
  };
  const logStream = new Writable({
    write(chunk, _encoding, done) {
      log(chunk);
      done();
    },
  });
  try {
    vite = await createServer({
      root: `${root}web`,
      cacheDir: `${data}/vite-cache`,
      customLogger: createLogger('info', { console: new Console(logStream), allowClearScreen: false }),
      server: { host, port: 0 },
      plugins: [
        {
          name: 'development-test-proxy-target',
          configResolved({ server }) {
            for (const options of Object.values(server.proxy ?? {})) {
              if (typeof options !== 'string') options.target = backendTarget;
            }
          },
        },
      ],
    });
    const httpServer = vite.httpServer!;
    // Bind Directly - Vite's listen(0) releases its probe port before rebinding.
    const listening = once(httpServer, 'listening');
    httpServer.listen(0, host);
    await listening;
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port');
    const origin = `http://${host}:${address.port}`;

    const child = spawn(
      serverBinary,
      ['--root', root, '--data', data, '--addr', `${host}:0`, '--public-origin', origin],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    backend = child;
    let startup = '';
    child.stdout.on('data', (value) => {
      startup += String(value);
      log(value);
    });
    child.stderr.on('data', log);
    child.on('error', log);
    await expect
      .poll(async () => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null)
          throw new Error(`Development backend failed: ${logs}`);
        const announcedOrigin = /^{"origin":"(http:\/\/127\.0\.0\.1:\d+)"}$/m.exec(startup)?.[1];
        if (!announcedOrigin) return 0;
        backendTarget.port = new URL(announcedOrigin).port;
        try {
          return (await fetch(`${origin}/api/v1/session`, { signal: AbortSignal.timeout(1000) })).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await register(page, origin, `dev-${Date.now()}`);
    for (const [rel, path] of [
      ['manifest', '/manifest.json'],
      ['apple-touch-icon', '/assets/icons/apple-touch-icon.png'],
      ['icon', '/assets/icons/mark.svg'],
    ]) {
      await expect(page.locator(`link[rel="${rel}"]`)).toHaveAttribute('href', path);
      expect((await page.request.get(`${origin}${path}`)).status()).toBe(200);
    }
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration())).toBeUndefined();
    const bootstrap = await page.request.get(`${origin}/api/v1/session`);
    const session = await bootstrap.json();
    const wrongOrigin = await page.request.post(`${origin}/api/v1/session/logout`, {
      data: {},
      headers: { Origin: backendTarget.origin, 'X-CSRF-Token': session.csrf_token },
    });
    expect(wrongOrigin.status()).toBe(403);
    expect((await page.request.get(`${origin}/app/library`, { maxRedirects: 0 })).status()).toBe(404);
    await page.goto(`${origin}/?antholume-retirement=legacy-v1`);
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  } finally {
    try {
      await Promise.all([vite?.close(), backend && stop(backend)]);
    } finally {
      await writeFile(testInfo.outputPath('development.log'), logs);
    }
  }
});
