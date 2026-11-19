type ExtendEvent = Event & { waitUntil: (promise: Promise<unknown>) => void };
type WorkerHost = {
  clients: { claim: () => Promise<void> };
  registration: { unregister: () => Promise<boolean> };
  skipWaiting: () => Promise<void>;
  addEventListener: (type: 'install' | 'activate', listener: (event: ExtendEvent) => void) => void;
};

const sw = globalThis as unknown as WorkerHost;

sw.addEventListener('install', event => event.waitUntil(sw.skipWaiting()));
sw.addEventListener('activate', event => event.waitUntil((async () => {
  try {
    await sw.clients.claim();
    // Preserve Legacy Data - OFFLINE_V1 mixes shell assets and cached books; retire only React's shell-only caches.
    const names = await caches.keys();
    await Promise.allSettled(names.filter(name => /^antholume-shell-[a-f0-9]{64}$/.test(name)).map(name => caches.delete(name)));
  } finally {
    await sw.registration.unregister();
  }
})()));
