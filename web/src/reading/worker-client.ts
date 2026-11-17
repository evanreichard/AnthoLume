import { cleanLegacyKeys, validMarker, type Marker } from './control';

type WorkerReply = { type: string; nonce: string; build: string; protocol: number; schema: number; events: number; marker?: Marker; error?: string };
export class WorkerCoordinator {
  ready = false;
  update: 'idle' | 'available' | 'blocked' | 'error' = 'idle';
  error: string | null = null;
  reading = 0;
  busy = 0;
  private registration?: ServiceWorkerRegistration;
  private dead = false;
  private retry?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private owner = crypto.randomUUID();
  private onMessage = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown>;
    if (!data || data.type !== 'APP_STATUS' || typeof data.nonce !== 'string' || typeof data.build !== 'string' || !(event.source instanceof ServiceWorker)) return;
    event.source.postMessage({ type: 'APP_STATUS_ACK', nonce: data.nonce, build: data.build, reading: this.reading > 0, busy: this.busy > 0 });
  };
  private onController = () => { if (!this.dead) void this.connect().catch(error => this.fail(error)); };
  constructor(private changed: () => void) {}
  private fail(error: unknown) { this.ready = false; this.update = 'error'; this.error = String(error); this.changed(); if (!this.dead && ++this.failures <= 5) { clearTimeout(this.retry); this.retry = setTimeout(() => { void this.connect().catch(next => this.fail(next)); }, Math.min(10000, 1000 * 2 ** this.failures)); } }
  private request(worker: ServiceWorker, payload: object, timeout = 10000): Promise<WorkerReply> {
    return new Promise((resolve, reject) => {
      const nonce = crypto.randomUUID(), channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Worker handshake timed out; close old tabs and retry')); }, timeout);
      channel.port1.onmessage = event => {
        const data = event.data as WorkerReply;
        clearTimeout(timer); channel.port1.close();
        const keys = data && Object.keys(data).sort().join(',');
        const expected = data?.type === 'APP_ERROR' ? 'build,error,events,nonce,protocol,schema,type' : data?.marker ? 'build,events,marker,nonce,protocol,schema,type' : 'build,events,nonce,protocol,schema,type';
        if (!data || keys !== expected || data.nonce !== nonce || typeof data.build !== 'string' || !data.build || data.protocol !== 1 || data.schema !== 2 || data.events !== 1) { reject(new Error('Incompatible worker reply; recovery required')); return; }
        if (data.type === 'APP_ERROR') { reject(new Error(typeof data.error === 'string' ? data.error : 'Invalid worker error')); return; }
        if (data.marker && !validMarker(data.marker)) { reject(new Error('Invalid worker control marker')); return; }
        resolve(data);
      };
      worker.postMessage({ ...payload, nonce }, [channel.port2]);
    });
  }
  async start() {
    if (!('serviceWorker' in navigator)) { this.fail('Service workers are required for qualified offline storage'); return; }
    navigator.serviceWorker.addEventListener('message', this.onMessage);
    navigator.serviceWorker.addEventListener('controllerchange', this.onController);
    try {
      const registration = this.registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (this.dead) return;
      registration.addEventListener('updatefound', this.updateFound);
      await registration.update().catch(() => undefined);
      if (registration.waiting) { this.update = 'available'; this.changed(); }
      if (!navigator.serviceWorker.controller) {
        await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Worker activation timed out')), 10000))]);
        if (!navigator.serviceWorker.controller) await new Promise<void>((resolve, reject) => {
          const listener = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', listener); resolve(); };
          const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', listener); reject(new Error('Worker control unavailable')); }, 10000);
          navigator.serviceWorker.addEventListener('controllerchange', listener, { once: true });
        });
      }
      await this.connect();
    } catch (error) {
      // A Legacy Controller Cannot Handshake - Only its waiting replacement can authorize the one-time cutover.
      if (this.registration?.waiting) {
        try { await this.request(this.registration.waiting, { type: 'APP_ACTIVATE' }); await new Promise(resolve => setTimeout(resolve, 100)); await this.connect(); return; } catch (next) { this.fail(next); return; }
      }
      this.fail(error);
    }
  }
  private updateFound = () => {
    const installing = this.registration?.installing;
    installing?.addEventListener('statechange', () => { if (!this.dead && installing.state === 'installed' && this.registration?.waiting) { this.update = 'available'; this.changed(); } });
  };
  private connecting?: Promise<void>;
  connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.handshake().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async handshake() {
    const controller = navigator.serviceWorker.controller;
    if (!controller || this.dead) throw new Error('No compatible controlling worker');
    const hello = await this.request(controller, { type: 'APP_HELLO', protocol: 1, schema: 2, events: 1, reading: this.reading > 0, busy: this.busy > 0 });
    if (hello.type !== 'APP_HELLO_ACK' || controller !== navigator.serviceWorker.controller || this.dead) throw new Error('Controller changed during handshake');
    const retired = await this.request(controller, { type: 'APP_RETIRE', owner: this.owner });
    if (retired.type !== 'APP_RETIRE_ACK' || !retired.marker || retired.build !== hello.build) throw new Error('Retirement marker missing');
    if (retired.marker.phase !== 'done') {
      await cleanLegacyKeys();
      localStorage.removeItem('readerSettings');
      if (localStorage.getItem('readerSettings') !== null) throw new Error('Legacy preferences could not be removed');
      const done = await this.request(controller, { type: 'APP_READY', marker: retired.marker });
      if (done.type !== 'APP_READY_ACK' || done.marker?.phase !== 'done' || done.build !== hello.build) throw new Error('Retirement incomplete');
    }
    if (this.dead || controller !== navigator.serviceWorker.controller) return;
    this.ready = true; this.error = null; this.failures = 0; clearTimeout(this.retry);
    this.update = this.registration?.waiting ? 'available' : 'idle';
    if (location.search.includes('antholume-retirement=legacy-v1')) { const url = new URL(location.href); url.searchParams.delete('antholume-retirement'); history.replaceState(null, '', url); }
    this.changed();
  }
  async apply() {
    if (this.reading || this.busy) { this.update = 'blocked'; this.changed(); return; }
    if (!this.registration?.waiting) { await this.registration?.update().catch(() => undefined); await this.connect(); return; }
    const waiting = this.registration.waiting;
    try {
      const reply = await this.request(waiting, { type: 'APP_ACTIVATE' });
      if (reply.type !== 'APP_ACTIVATE_ACK') throw new Error('Activation not acknowledged');
      const key = `antholume:retirement-reload:legacy-v1:${reply.build}`;
      if (sessionStorage.getItem(key)) throw new Error('Automatic reload already attempted; reopen app manually');
      sessionStorage.setItem(key, '1'); location.reload();
    } catch (error) { this.update = 'blocked'; this.error = String(error); this.changed(); }
  }
  dispose() { this.dead = true; clearTimeout(this.retry); this.registration?.removeEventListener('updatefound', this.updateFound); if ('serviceWorker' in navigator) { navigator.serviceWorker.removeEventListener('message', this.onMessage); navigator.serviceWorker.removeEventListener('controllerchange', this.onController); } }
}
