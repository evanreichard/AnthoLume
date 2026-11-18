export class WorkerCoordinator {
  ready = true;
  update: 'idle' | 'available' | 'blocked' | 'error' = 'idle';
  error: string | null = null;
  private dead = false;
  private checking?: Promise<void>;

  constructor(private changed: () => void) {}

  async start() { void this.connect(); }

  connect(): Promise<void> {
    if (this.dead || !('serviceWorker' in navigator)) return Promise.resolve();
    return this.checking ??= this.retire().finally(() => { this.checking = undefined; });
  }

  private async retire() {
    try {
      const root = new URL('/', location.href).href;
      const script = new URL('sw.js', root).href;
      const registration = await navigator.serviceWorker.getRegistration(root);
      if (this.dead) return;
      if (registration?.scope === root) {
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (worker?.scriptURL === script) await registration.update();
      }
      if (!this.dead && this.error !== null) {
        this.update = 'idle'; this.error = null; this.changed();
      }
    } catch {
      if (this.dead || this.update === 'error') return;
      this.update = 'error'; this.error = 'Could not check for offline worker retirement. Reading and saving are still available.'; this.changed();
    }
  }

  async apply() { await this.connect(); }
  dispose() { this.dead = true; }
}
