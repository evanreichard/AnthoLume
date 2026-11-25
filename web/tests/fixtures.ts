import { test as base, expect, type Page } from '@playwright/test';
import type { components } from '../src/api/schema.gen';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export async function epub(title = 'Local public book'): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:381c001a-5672-4664-8fed-4b7d601fd8cf</dc:identifier><dc:title>${title}</dc:title><dc:creator>Public Author</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
  zip.file('OEBPS/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Public chapter</a></li></ol></nav></body></html>');
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Public chapter</title></head><body><h1>Public chapter</h1>${Array.from({ length: 70 }, (_, i) => `<p>Paragraph ${i + 1}. A small public story for automated reading. Along the river the trees moved slowly in the wind. Readers kept their place and returned to their books, turning one page at a time. ${'The light fell across the open pages. '.repeat(12)}</p>`).join('')}</body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

type Server = { origin: string; data: string; stop: () => Promise<void>; start: () => Promise<void> };
export const test = base.extend<{ server: Server; dataDir: string }, { serverBinary: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires object destructuring even for fixtures without dependencies.
  dataDir: async ({}, provide) => {
    const dir = await mkdtemp(join(tmpdir(), 'antholume-browser-'));
    try { await provide(dir); } finally { await rm(dir, { recursive: true, force: true }); }
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires object destructuring even for fixtures without dependencies.
  serverBinary: [async ({}, provide) => {
    const go = process.env.GO_BINARY || 'go';
    const dir = await mkdtemp(join(tmpdir(), 'antholume-router-'));
    const binary = join(dir, 'server');
    try {
      execFileSync(go, ['build', '-mod=readonly', '-o', binary, './web/tests/server'], { cwd: root, env: { ...process.env, GOTOOLCHAIN: 'local' }, timeout: 180_000, stdio: 'pipe' });
      await provide(binary);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 240_000 }],
  server: async ({ serverBinary, dataDir: data }, provide, testInfo) => {
    await mkdir(`${data}/documents`);
    await mkdir(`${data}/covers`);
    await writeFile(`${data}/documents/public.epub`, await epub('Server public book'));
    await writeFile(`${data}/covers/public.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8LsAAAAASUVORK5CYII=', 'base64'));
    let child: ReturnType<typeof spawn> | null = null;
    let logs = '';
    const addr = `127.0.0.1:${process.env.ANTHOLUME_TEST_PORT ?? 5323}`;
    const origin = `http://${addr}`;
    async function start() {
      if (child) return;
      child = spawn(serverBinary, ['--root', root, '--data', data, '--addr', addr], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let startup = '';
      child.stdout!.on('data', (value) => { startup += String(value); logs = (logs + value).slice(-50000); });
      child.stderr!.on('data', (value) => { logs = (logs + value).slice(-50000); });
      let ready = false;
      for (let n = 0; n < 200; n++) {
        if (child.exitCode !== null) throw new Error(`Production router exited ${child.exitCode}: ${logs}`);
        try { if (startup.includes(`"origin":"${origin}"`)) { const response = await fetch(`${origin}/api/v1/session`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } } catch { /* Startup polling uses the actual public bootstrap. */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error(`Production router startup timeout: ${logs}`);
    }
    async function stop() {
      const current = child;
      if (!current) return;
      child = null;
      const exited = new Promise<void>((resolve, reject) => {
        if (current.exitCode !== null || current.signalCode !== null) return reject(new Error(`Test server already exited: ${current.exitCode ?? current.signalCode}\n${logs}`));
        const timer = setTimeout(() => { current.kill('SIGKILL'); reject(new Error(`Test server shutdown timeout\n${logs}`)); }, 8000);
        current.once('close', (code, signal) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`Test server exit ${code ?? signal}\n${logs}`));
        });
      });
      current.kill('SIGTERM');
      await exited;
    }
    try {
      await start();
      await provide({ origin, data, stop, start });
    } finally {
      try { await stop(); } finally { await writeFile(testInfo.outputPath('server.log'), logs); }
    }
  },
});
export { expect };
type Lookup = components['schemas']['BookMatcherLookupRequest'];
export type LookupOutcome = Omit<components['schemas']['BookMatcherOutcome'], 'document_id'>;
export function mockMatcherLookup(page: Page, lookup: (id: string, body: Lookup) => LookupOutcome | Promise<LookupOutcome>) {
  return page.route('**/api/v1/metadata/lookups', async route => {
    expect(route.request().method()).toBe('POST');
    const body: Lookup = route.request().postDataJSON();
    const rows = await Promise.all(body.document_ids.map(async document_id => ({ document_id, ...await lookup(document_id, body) })));
    await route.fulfill({ contentType: 'application/x-ndjson', body: rows.map(row => JSON.stringify(row) + '\n').join('') });
  });
}
export async function register(page: import('@playwright/test').Page, origin: string, username: string) {
  await page.goto(`${origin}/register`);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-public-password');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toBeVisible();
}
export async function signIn(page: import('@playwright/test').Page, origin: string, username: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-public-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
}
