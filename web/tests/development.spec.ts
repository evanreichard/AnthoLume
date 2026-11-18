import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect, epub, importBook, register, root, scratch } from './fixtures';

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Development process shutdown timeout')); }, 8000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  child.kill('SIGTERM');
  await exited;
}

test('loopback Vite serves development routes while proxying the compiled worker shell and exact public Origin', async ({ page, server }) => {
  void server;
  const data = `${scratch}dev-${Date.now()}`;
  await mkdir(`${data}/documents`, { recursive: true });
  await writeFile(`${data}/documents/public.epub`, await epub());
  const origin = 'http://127.0.0.1:5333';
  const backend = spawn(`${scratch}production-router-test`, ['--root', root, '--data', data, '--addr', '127.0.0.1:5334', '--public-origin', origin], { stdio: ['ignore', 'pipe', 'pipe'] });
  const vite = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', '5333', '--strictPort'], { cwd: `${root}web`, env: { ...process.env, ANTHOLUME_BACKEND: 'http://127.0.0.1:5334' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const child of [backend, vite]) {
    child.stdout!.on('data', (value) => { logs = (logs + value).slice(-16000); });
    child.stderr!.on('data', (value) => { logs = (logs + value).slice(-16000); });
  }
  try {
    await expect.poll(async () => {
      if (backend.exitCode !== null || vite.exitCode !== null) throw new Error(`Development process exited: ${logs}`);
      try { return (await fetch(`${origin}/api/v1/session`, { signal: AbortSignal.timeout(1000) })).status; } catch { return 0; }
    }).toBe(200);
    await register(page, origin, `dev-${Date.now()}`);
    await importBook(page, 'Development local original');
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${origin}/sw.js`);
    const bootstrap = await page.request.get(`${origin}/api/v1/session`);
    const session = await bootstrap.json();
    const wrongOrigin = await page.request.post(`${origin}/api/v1/session/logout`, { data: {}, headers: { Origin: 'http://127.0.0.1:5323', 'X-CSRF-Token': session.csrf_token } });
    expect(wrongOrigin.status()).toBe(403);
    await page.goto(`${origin}/app/offline`);
    await expect(page.getByRole('heading', { name: 'Development local original', exact: true })).toBeVisible();
    await page.goto(`${origin}/?antholume-retirement=legacy-v1`);
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  } finally { await stop(vite); await stop(backend); await writeFile(`${scratch}development.log`, logs); }
});
