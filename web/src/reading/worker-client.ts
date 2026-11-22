export class WorkerCoordinator {
  update: 'idle' | 'error' = 'idle';
  error: string | null = null;
  private dead = false;
  private checking?: Promise<void>;

  constructor(private changed: () => void) {}

  async start() { void this.connect(); }

  connect(): Promise<void> {
    if (this.dead || !('serviceWorker' in navigator)) return Promise.resolve();
    return this.checking ??= this.register().finally(() => { this.checking = undefined; });
  }

  private async register() {
    try {
      const root = new URL('/', location.href).href;
      const script = new URL('sw.js', root).href;
      const registration = await navigator.serviceWorker.getRegistration(root);
      if (this.dead) return;
      if (!registration && !import.meta.env.DEV) {
        await navigator.serviceWorker.register(script, { scope: '/', updateViaCache: 'none' });
      } else if (registration?.scope === root && navigator.onLine) {
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (worker?.scriptURL === script) await registration.update();
      }
      if (!this.dead && this.error !== null) {
        this.update = 'idle'; this.error = null; this.changed();
      }
    } catch {
      if (this.dead || this.update === 'error') return;
      this.update = 'error'; this.error = 'Offline startup could not be prepared. Reading and saving are still available.'; this.changed();
    }
  }

  async ensureOfflineShell(external: AbortSignal) {
    if (!('serviceWorker' in navigator)) throw new Error('Offline startup needs a secure connection and service worker support.');
    await this.connect();
    const signal = AbortSignal.any([external, AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = (error?: Error) => {
        signal.removeEventListener('abort', abort);
        channel.port1.close(); channel.port2.close();
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new Error('Offline startup is not ready. Reconnect, close other app tabs and retry.'));
      signal.addEventListener('abort', abort, { once: true });
      channel.port1.onmessage = event => { if (event.data === 'shell-ready') finish(); };
      void navigator.serviceWorker.ready.then(registration => {
        if (!signal.aborted) registration.active?.postMessage('check-shell', [channel.port2]);
      }).catch(abort);
    });
  }
  async apply() { await this.connect(); }
  dispose() { this.dead = true; }
}
