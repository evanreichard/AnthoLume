import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

type FixtureServer = { origin: string; key: string };

export const test = base.extend<{}, { fixtureServer: FixtureServer }>({
  fixtureServer: [async ({}, use) => {
    const scratch = fileURLToPath(new URL('../../../_scratch/m2/integration/', import.meta.url));
    const child = spawn(`${scratch}fixture-server`, [
      '--addr', '127.0.0.1:0', '--assets', `${scratch}dist`, '--data', `${scratch}databases`,
      '--epub', '../reader-storage/public/fixtures/synthetic.epub',
    ], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-4000); });
    const lines = createInterface({ input: child.stdout });
    try {
      const server = await new Promise<FixtureServer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Go fixture startup timeout: ${stderr}`)), 10_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Go fixture exited ${code}: ${stderr}`)); });
        lines.once('line', text => {
          clearTimeout(timer);
          try {
            const value: unknown = JSON.parse(text);
            if (typeof value !== 'object' || value === null || !('origin' in value) || typeof value.origin !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin) || !('key' in value) || typeof value.key !== 'string' || !/^[a-f0-9]{64}$/.test(value.key)) throw new Error('Bad fixture handshake');
            resolve({ origin: value.origin, key: value.key });
          } catch (error) { reject(error); }
        });
      });
      await use(server);
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Go fixture did not shut down')); }, 8_000);
          child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Go fixture teardown exit ${code}: ${stderr}`)); });
        });
        child.kill('SIGTERM');
        await stopped;
      } else if (child.exitCode !== 0) {
        throw new Error(`Go fixture unexpected exit ${child.exitCode}: ${stderr}`);
      }
    }
  }, { scope: 'worker' }],
});
export { expect };

test.beforeEach(async ({ page, fixtureServer }) => {
  const reset = await fetch(`${fixtureServer.origin}/__fixture/reset`, {
    method: 'POST', headers: { 'X-Fixture-Key': fixtureServer.key, Origin: fixtureServer.origin },
  });
  expect(reset.status).toBe(200);
  await page.goto(fixtureServer.origin);
  await page.waitForFunction(() => !!window.integration);
});
