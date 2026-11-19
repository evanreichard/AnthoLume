import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer as createListener, isIPv4 } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('./', import.meta.url));
const repo = resolve(web, '..');

function port(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > 65535) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}

function tailnetIP() {
  try {
    const ip = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/)[0];
    return isIPv4(ip) && ip !== '127.0.0.1' ? ip : null;
  } catch { return null; }
}

const uuidFallback = `if (!crypto.randomUUID) crypto.randomUUID = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
};`;

async function run() {
  const root = join(repo, 'data/dev');
  const restore = process.env.RESTORE;
  const existing = await stat(root).catch(() => null);
  if (restore && existing) throw new Error('dev state already exists; run make clean-dev before restoring');
  if (!restore && !(await stat(join(root, 'antholume.db')).catch(() => null))?.size) {
    throw new Error('No existing database at data/dev/antholume.db. Run make dev RESTORE=/path/to/backup.zip (use make clean-dev first if the dev directory already exists).');
  }
  const ip = tailnetIP();
  const vitePort = port('DEV_PORT', 5323);
  const goPort = port('DEV_GO_PORT', 5324);
  if (vitePort === goPort) throw new Error('DEV_PORT and DEV_GO_PORT must differ.');
  const local = `127.0.0.1:${vitePort}`;
  const tailnet = ip ? `${ip}:${vitePort}` : null;
  const target = `http://127.0.0.1:${goPort}`;
  process.env.ANTHOLUME_BACKEND = target;

  let vite, extra, backend, buildDir, cleaning;
  const sockets = new Set();
  const clean = () => cleaning ??= (async () => {
    const closed = extra?.listening ? new Promise(resolve => extra.close(resolve)) : null;
    for (const socket of sockets) socket.destroy();
    if (backend?.pid && backend.exitCode === null && backend.signalCode === null) {
      const done = new Promise(resolve => backend.once('exit', resolve));
      backend.kill('SIGTERM');
      await done;
    }
    await closed;
    if (buildDir) await rm(buildDir, { recursive: true, force: true });
  })();

  let stop;
  const stopped = new Promise(resolve => { stop = resolve; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const { createServer } = await import('vite');
    vite = await createServer({
      root: web, configFile: join(web, 'vite.config.ts'),
      server: { host: '127.0.0.1', port: vitePort, strictPort: true },
      plugins: [{
        name: 'antholume-local-development',
        closeServer: clean,
        configureServer(server) {
          for (const options of Object.values(server.config.server.proxy)) {
            options.configure = proxy => proxy.on('proxyReq', (out, req) => {
              const host = req.headers.host;
              if ((host === local || host === tailnet) && req.headers.origin === `http://${host}`) out.setHeader('Origin', target);
              else if (req.headers.origin) out.removeHeader('Origin');
            });
          }
        },
        transformIndexHtml() {
          if (tailnet) return [{ tag: 'script', injectTo: 'head-prepend', children: uuidFallback }];
        },
      }],
    });
    await vite.listen();
    if (ip) {
      // Share Vite's HTTP and WebSocket handlers without binding every interface.
      extra = createListener(socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        vite.httpServer.emit('connection', socket);
      });
      await new Promise((resolve, reject) => {
        extra.once('error', reject);
        extra.listen(vitePort, ip, resolve);
      });
    }

    buildDir = await mkdtemp(join(tmpdir(), 'antholume-dev-'));
    const binary = join(buildDir, 'backend');
    execFileSync('go', ['build', '-o', binary, './tools/dev'], { cwd: repo, stdio: 'inherit' });
    backend = spawn(binary, [String(goPort)], { cwd: repo, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, GIN_MODE: 'release' } });
    const output = createInterface({ input: backend.stdout });
    const ready = new Promise(resolve => output.once('line', resolve));
    const exited = new Promise(resolve => {
      backend.once('error', error => resolve(`Go backend could not start: ${error.message}`));
      backend.once('exit', (code, signal) => resolve(`Go backend exited (${signal || code})`));
    });
    const result = await Promise.race([stopped, exited, ready]);
    if (result === undefined) return;
    if (result !== 'ready') throw new Error(result);
    for (const address of [local, tailnet].filter(Boolean)) {
      const res = await fetch(`http://${address}/api/v1/session`, { signal: AbortSignal.timeout(3000) });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`Session endpoint at ${address} returned HTTP ${res.status}.`);
      console.log(`Dev: http://${address}/login`);
    }
    if (!tailnet) console.log('No Tailscale IPv4 address; listening on loopback only.');
    console.log('Database: data/dev/antholume.db\nSession endpoint ready. Ctrl-C stops both servers.');
    const failure = await Promise.race([stopped, exited]);
    if (failure) throw new Error(failure);
  } finally {
    await clean();
    await vite?.close();
  }
}

run().catch(error => { console.error(`dev: ${error.message}`); process.exitCode = 1; });
