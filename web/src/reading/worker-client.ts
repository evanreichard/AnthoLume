export class OfflineShellError extends Error {}

export class WorkerCoordinator {
  error: string | null = null;
  private dead = false;
  private checking?: Promise<void>;

  constructor(private changed: () => void) {}

  async start() { void this.connect(); }

  connect(): Promise<void> {
    if (this.dead || !('serviceWorker' in navigator)) return Promise.resolve();
    return this.prepareRegistration().catch(() => {
      if (this.dead || this.error) return;
      this.error = 'Could not update the offline app. You can still read online.'; this.changed();
    });
  }

  private prepareRegistration() {
    return this.checking ??= this.register().finally(() => { this.checking = undefined; });
  }

  private async register() {
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
    if (!this.dead && this.error !== null) {
      this.error = null; this.changed();
    }
  }

  async ensureOfflineShell(external: AbortSignal) {
    try {
      external.throwIfAborted();
      if (import.meta.env.DEV) throw new Error('Save to Device is unavailable in hot-reload mode. Stop the hot server and run make dev for offline testing.');
      if (!('serviceWorker' in navigator)) throw new Error('Save to Device requires service workers. Open the app on localhost or HTTPS in a browser that supports them.');
      try { await this.prepareRegistration(); }
      catch { throw new Error('Could not prepare the offline app. Check your connection and try again.'); }
      await this.checkShell(external);
    } catch (error) {
      external.throwIfAborted();
      const message = error instanceof Error ? error.message : 'Could not prepare the offline app.';
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
      channel.port1.onmessage = event => {
        if (event.data === 'shell-ready') finish();
        else if (event.data === 'shell-incomplete') finish(new Error('The offline app is incomplete. Reconnect and try saving again.'));
      };
      void navigator.serviceWorker.ready.then(registration => {
        if (!signal.aborted) registration.active?.postMessage('verify-shell', [channel.port2]);
      }).catch(abort);
    });
  }
  dispose() { this.dead = true; }
}
