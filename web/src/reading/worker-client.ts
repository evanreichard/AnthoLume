export class OfflineShellError extends Error {}

export class WorkerCoordinator {
  private shellFailed = false;
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
        if (worker?.scriptURL === script) {
          try { await registration.update(); }
          catch (error) {
            // Offline Updates - A failed check for a newer script does not invalidate the installed worker.
            if (registration.active?.scriptURL !== script) throw error;
          }
        }
      }
      if (!this.dead && !this.shellFailed && this.error !== null) {
        this.error = null; this.changed();
      }
    } catch {
      if (this.dead || this.error) return;
      this.error = 'Could not update the offline app. You can still read online.'; this.changed();
    }
  }

  async ensureOfflineShell(external: AbortSignal) {
    try {
      external.throwIfAborted();
      if (import.meta.env.DEV) throw new Error('Save to Device is unavailable in hot-reload mode. Stop the hot server and run make dev for offline testing.');
      if (!('serviceWorker' in navigator)) throw new Error('Save to Device requires service workers. Open the app on localhost or HTTPS in a browser that supports them.');
      await this.connect();
      await this.checkShell(external);
      this.shellFailed = false;
      if (this.error) { this.error = null; this.changed(); }
    } catch (error) {
      external.throwIfAborted();
      const message = error instanceof Error ? error.message : 'Could not prepare the offline app.';
      this.shellFailed = true; this.error = message; this.changed();
      throw new OfflineShellError(message);
    }
  }

  private async checkShell(external: AbortSignal) {
    const signal = AbortSignal.any([external, AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = (error?: Error) => {
        signal.removeEventListener('abort', abort);
        channel.port1.close(); channel.port2.close();
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new Error('The offline app did not finish preparing. Close other app tabs, check your connection, then try saving again.'));
      signal.addEventListener('abort', abort, { once: true });
      channel.port1.onmessage = event => { if (event.data === 'shell-ready') finish(); };
      void navigator.serviceWorker.ready.then(registration => {
        if (!signal.aborted) registration.active?.postMessage('check-shell', [channel.port2]);
      }).catch(abort);
    });
  }
  async apply() {
    if (!this.shellFailed) return this.connect();
    try { await this.ensureOfflineShell(new AbortController().signal); }
    catch (error) { if (!(error instanceof OfflineShellError)) throw error; }
  }
  dispose() { this.dead = true; }
}
