import { advanceRetirement, claimRetirement, controlTransaction, getMarker, type Marker } from './control';

type WindowClient = { id: string; url: string; postMessage: (value: unknown) => void; navigate: (url: string) => Promise<WindowClient | null> };
type ExtendEvent = Event & { waitUntil: (promise: Promise<unknown>) => void };
type Message = ExtendEvent & { data: unknown; ports: readonly MessagePort[]; source: WindowClient | null };
type Fetch = ExtendEvent & { request: Request; clientId: string; respondWith: (response: Promise<Response>) => void };
type WorkerHost = {
  __ANTHOLUME_PRECACHE__: { url: string; sha256: string }[]; __ANTHOLUME_BUILD__: string;
  location: Location; clients: { matchAll: (options: { type: 'window'; includeUncontrolled: boolean }) => Promise<WindowClient[]>; claim: () => Promise<void> };
  skipWaiting: () => Promise<void>; addEventListener: (name: string, handler: (event: never) => void) => void;
};
const sw = globalThis as unknown as WorkerHost;
const build = sw.__ANTHOLUME_BUILD__, manifest = sw.__ANTHOLUME_PRECACHE__, cacheName = `antholume-shell-${build}`;
const clients = new Map<string, { reading: boolean; busy: boolean; nonce: string }>();
const probes = new Map<string, { nonce: string; statuses: Map<string, { reading: boolean; busy: boolean }> }>();
const appURL = (url: URL) => url.origin === sw.location.origin && (url.pathname === '/app' || url.pathname.startsWith('/app/') || url.searchParams.get('antholume-retirement') === 'legacy-v1' && url.pathname === '/');
const oldURL = (url: URL) => url.origin === sw.location.origin && ['/', '/reader', '/local'].includes(url.pathname) && !appURL(url);
const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const exact = (value: Record<string, unknown>, fields: string) => Object.keys(value).sort().join(',') === fields;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

sw.addEventListener('install', ((event: ExtendEvent) => event.waitUntil((async () => {
  if (!build || !Array.isArray(manifest) || !manifest.length) throw new Error('Missing complete shell injection');
  const urls = new Set<string>();
  try {
    const cache = await caches.open(cacheName);
    for (const entry of manifest) {
      const url = new URL(entry.url, sw.location.origin);
      if (url.origin !== sw.location.origin || url.search || urls.has(url.href) || !(/^[a-f0-9]{64}$/.test(entry.sha256)) || !(url.pathname === '/app/' || url.pathname === '/assets/app/index.html' || url.pathname.startsWith('/assets/app/assets/'))) throw new Error('Invalid precache manifest');
      urls.add(url.href);
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      const type = (response.headers.get('Content-Type') || '').split(';')[0]!.trim().toLowerCase();
      const expectedType = url.pathname.endsWith('.html') || url.pathname === '/app/' ? type === 'text/html'
        : url.pathname.endsWith('.js') ? ['application/javascript', 'text/javascript', 'application/ecmascript'].includes(type)
        : url.pathname.endsWith('.css') ? type === 'text/css'
        : url.pathname.endsWith('.woff2') ? ['font/woff2', 'application/font-woff2', 'application/octet-stream'].includes(type)
        : url.pathname.endsWith('.json') ? ['application/json', 'application/manifest+json'].includes(type)
        : /\.(?:png|jpe?g|svg|webp|ico)$/.test(url.pathname) ? type.startsWith('image/') : type !== 'text/html' && !!type;
      if (response.status !== 200 || response.redirected || response.type === 'opaque' || !expectedType) throw new Error('Invalid shell response');
      const bytes = await response.arrayBuffer();
      if (await digest(bytes) !== entry.sha256) throw new Error('Shell checksum mismatch');
      await cache.put(url, new Response(bytes, { headers: response.headers }));
    }
    if (![...urls].some(url => url.endsWith('/app/') || url.endsWith('/assets/app/index.html'))) throw new Error('Shell HTML missing');
    await cache.put(new URL('/__antholume_verified__', sw.location.origin), new Response(build));
  } catch (error) { await caches.delete(cacheName); throw error; }
})())) as never);

async function inventory() {
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const marker = await getMarker();
  if (marker?.phase === 'done') return;
  for (const client of windows) {
    if (!oldURL(new URL(client.url))) continue;
    const shouldNavigate = await controlTransaction<boolean>('readwrite', (store, set) => {
      const key = `legacy-client:${client.id}`, r = store.get(key);
      r.onsuccess = () => { if (r.result?.attempted) { set(false); return; } store.put({ key, clientId: client.id, attempted: true }); set(true); };
    });
    if (shouldNavigate) {
      const old = new URL(client.url), params = new URLSearchParams(old.hash.slice(1)), id = params.get('id');
      const target = new URL('/?antholume-retirement=legacy-v1', sw.location.origin);
      if (params.get('type') === 'REMOTE' && id && id.length <= 128) target.searchParams.set('legacyDocument', id);
      await client.navigate(target.href);
    }
  }
}
async function boundedInventory() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([inventory(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Legacy navigation pending; close old tabs and retry')), 5000); })]); }
  finally { clearTimeout(timer); }
}
sw.addEventListener('activate', ((event: ExtendEvent) => event.waitUntil((async () => { await sw.clients.claim(); await boundedInventory().catch(() => undefined); })())) as never);

async function safeActivation() {
  const nonce = crypto.randomUUID(), statuses = new Map<string, { reading: boolean; busy: boolean }>();
  probes.set(nonce, { nonce, statuses });
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of windows) if (appURL(new URL(c.url))) c.postMessage({ type: 'APP_STATUS', nonce, build });
  await new Promise(resolve => setTimeout(resolve, 750)); probes.delete(nonce);
  const unknown = windows.filter(c => appURL(new URL(c.url)) && !statuses.has(c.id));
  if (unknown.length || [...statuses.values()].some(s => s.reading || s.busy)) throw new Error('Update deferred until all readers and durable writes finish');
  await sw.skipWaiting();
}
async function retirementSafe(marker: Marker) {
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Silence Is Not Compatibility - A sleeping legacy document must really navigate/close before cleanup completes.
  if (windows.some(c => oldURL(new URL(c.url)))) throw new Error('Close old reader/local/library tabs to complete retirement');
  const current = await getMarker();
  if (!current || current.fence !== marker.fence || current.owner !== marker.owner || current.build !== build || current.until <= Date.now()) throw new Error('Retirement fence expired');
}
async function message(event: Message) {
  const data = event.data, source = event.source, port = event.ports[0];
  if (!object(data) || !source) return;
  if (data.type === 'APP_STATUS_ACK' && exact(data, 'build,busy,nonce,reading,type') && typeof data.nonce === 'string' && typeof data.reading === 'boolean' && typeof data.busy === 'boolean') {
    probes.get(data.nonce)?.statuses.set(source.id, { reading: data.reading, busy: data.busy }); return;
  }
  if (!port || !appURL(new URL(source.url))) return;
  const reply = (value: object) => port.postMessage({ ...value, nonce: data.nonce, build, protocol: 1, schema: 2, events: 1 });
  try {
    if (typeof data.nonce !== 'string' || data.nonce.length > 128) throw new Error('Missing nonce');
    if (data.type === 'APP_HELLO' && exact(data, 'busy,events,nonce,protocol,reading,schema,type') && data.protocol === 1 && data.schema === 2 && data.events === 1 && typeof data.reading === 'boolean' && typeof data.busy === 'boolean') {
      clients.set(source.id, { reading: data.reading, busy: data.busy, nonce: data.nonce });
      await boundedInventory(); reply({ type: 'APP_HELLO_ACK' }); return;
    }
    if (data.type === 'APP_ACTIVATE' && exact(data, 'nonce,type')) { await safeActivation(); reply({ type: 'APP_ACTIVATE_ACK' }); return; }
    if (!clients.has(source.id)) throw new Error('Handshake required');
    if (data.type === 'APP_RETIRE' && exact(data, 'nonce,owner,type') && typeof data.owner === 'string') {
      const marker = await claimRetirement(data.owner, build);
      if (!marker) throw new Error('Another tab owns retirement; retry shortly');
      if (marker.phase === 'done') { reply({ type: 'APP_RETIRE_ACK', marker }); return; }
      await retirementSafe(marker);
      const next = await advanceRetirement(marker, 'cleaning');
      await caches.delete('OFFLINE_V1');
      reply({ type: 'APP_RETIRE_ACK', marker: next }); return;
    }
    if (data.type === 'APP_READY' && exact(data, 'marker,nonce,type') && object(data.marker)) {
      const marker = data.marker as unknown as Marker;
      await retirementSafe(marker);
      const next = await advanceRetirement(marker, 'done'); reply({ type: 'APP_READY_ACK', marker: next }); return;
    }
    throw new Error('Unsupported worker message');
  } catch (error) { reply({ type: 'APP_ERROR', error: error instanceof Error ? error.message : 'Worker recovery required' }); }
}
sw.addEventListener('message', ((event: Message) => event.waitUntil(message(event))) as never);

sw.addEventListener('fetch', ((event: Fetch) => {
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin) return;
  event.respondWith((async () => {
    if (event.clientId && !clients.has(event.clientId)) {
      const quarantined = await controlTransaction<boolean>('readonly', (store, set) => { const r = store.get(`legacy-client:${event.clientId}`); r.onsuccess = () => set(!!r.result); }).catch(() => true);
      if (quarantined && (event.request.method !== 'GET' || url.pathname.startsWith('/assets/') || ['/local', '/reader'].includes(url.pathname))) return new Response('Legacy client retired. Reopen AnthoLume.', { status: 409 });
    }
    if (event.request.method !== 'GET') return fetch(event.request);
    if (event.request.mode === 'navigate' && ['/local', '/reader'].includes(url.pathname)) return Response.redirect(new URL('/?antholume-retirement=legacy-v1', sw.location.origin).href, 302);
    const cache = await caches.open(cacheName);
    if (manifest.some(e => new URL(e.url, sw.location.origin).href === url.href) && url.pathname.startsWith('/assets/app/')) { const stored = await cache.match(url); if (stored) return stored; }
    const navigation = event.request.mode === 'navigate' && (appURL(url) || url.pathname === '/');
    if (!navigation) return fetch(event.request);
    try { return await fetch(event.request); } catch (error) {
      if (!(await cache.match('/__antholume_verified__'))) throw error;
      const shell = manifest.find(e => e.url === '/app/' || e.url === '/assets/app/index.html');
      const response = shell && await cache.match(shell.url);
      if (!response) throw error;
      // Temporary Mount - Offline installed root launches enter the /app router; online root remains ordinary SSR.
      if (url.pathname === '/' && !appURL(url)) return Response.redirect(new URL('/app/', sw.location.origin).href, 302);
      return response;
    }
  })());
}) as never);
