export {};
type LifetimeEvent = Event & { waitUntil(promise: Promise<unknown>): void };
type RequestEvent = Event & { request: Request; respondWith(response: Promise<Response>): void };
const sw = globalThis as unknown as {
  clients: { claim(): Promise<void> };
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'install' | 'activate', listener: (event: LifetimeEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: RequestEvent) => void): void;
};
declare const __SHELL_VERSION__: string;
declare const __SHELL_FILES__: string[];
const name = 'antholume-shell-' + __SHELL_VERSION__;
const files = new Set(__SHELL_FILES__);
const navigation = /^\/(?:|library\/?|(?:books|read)\/server\/?)$/;

sw.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(name);
  await cache.addAll([...files].map(path => new Request(path, { cache: 'reload', credentials: 'omit' })));
})()));
sw.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key !== name && /^antholume-shell-[a-f0-9]{64}$/.test(key)) await caches.delete(key);
  }
  await sw.clients.claim();
})()));
sw.addEventListener('message', event => {
  if (event.data === 'check-shell') event.ports[0]?.postMessage('shell-ready');
});
sw.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (url.origin !== location.origin || request.method !== 'GET') return;
  const navigate = request.mode === 'navigate';
  if (navigate ? !navigation.test(url.pathname) : url.pathname === '/' || !files.has(url.pathname) || url.search !== '') return;
  event.respondWith((async () => {
    const cache = await caches.open(name);
    return await cache.match(navigate ? '/' : url.pathname) ?? fetch(request);
  })());
});
