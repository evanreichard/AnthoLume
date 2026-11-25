import type { BrowserContext, CDPSession, Page } from '@playwright/test';

type Target = { kind: 'source' | 'staging' | 'release'; sampling: boolean };
type Heap = { usedSize: number; backingStorageSize?: number };
type Reply = { result: { value: string } };
export class WorkerMemoryProbe {
  readonly peaks: Record<string, { heap: number; backing: number; samples: number }> = {};
  private cdp!: CDPSession;
  private targets = new Map<string, Target>();
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private sequence = 0;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private context: BrowserContext,
    private page: Page,
  ) {}
  private command<T>(sessionId: string, method: string, params = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Worker observation deadline'));
      }, 2000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      void this.cdp
        .send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
        .catch(reject);
    });
  }
  async start() {
    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on('Target.receivedMessageFromTarget', (event) => {
      const message = JSON.parse(event.message);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error('Worker CDP request failed'));
          else pending.resolve(message.result);
        }
      } else if (message.method === 'Debugger.paused')
        void (async () => {
          const target = this.targets.get(event.sessionId);
          if (target) await this.sample(event.sessionId, target);
          await this.command(event.sessionId, 'Debugger.resume').catch(() => undefined);
        })();
    });
    this.cdp.on('Target.detachedFromTarget', (event) => this.targets.delete(event.sessionId));
    this.cdp.on('Target.attachedToTarget', (event) => {
      const target: Target = {
        kind: event.targetInfo.url.includes('buffer-release')
          ? 'release'
          : event.targetInfo.url.includes('staging.worker')
            ? 'staging'
            : 'source',
        sampling: false,
      };
      this.targets.set(event.sessionId, target);
      void (async () => {
        try {
          await this.command(event.sessionId, 'Runtime.enable');
          await this.command(event.sessionId, 'Debugger.enable');
          // Terminal Snapshot - Brief debugger pauses observe backing before parent termination; no collection is requested.
          await this.command(event.sessionId, 'Runtime.evaluate', {
            expression: `addEventListener('message',e=>{if(e.data?.operation)globalThis.__workerOperation=e.data.operation});const originalPost=globalThis.postMessage;globalThis.postMessage=function(...args){if(args[0]?.stats){debugger;}return Reflect.apply(originalPost,this,args);};`,
          });
        } catch {
        } finally {
          await this.command(event.sessionId, 'Runtime.runIfWaitingForDebugger').catch(() => undefined);
        }
      })();
    });
    await this.cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
      filter: [{ type: 'worker', exclude: false }],
    });
    this.timer = setInterval(() => {
      for (const [id, target] of this.targets) void this.sample(id, target);
    }, 100);
  }
  private async sample(id: string, target: Target) {
    if (target.sampling) return;
    target.sampling = true;
    try {
      const [heap, state] = await Promise.all([
        this.command<Heap>(id, 'Runtime.getHeapUsage'),
        this.command<Reply>(id, 'Runtime.evaluate', {
          expression: 'globalThis.__workerOperation || "starting"',
          returnByValue: true,
        }),
      ]);
      const key = target.kind === 'source' ? state.result.value : target.kind,
        peak = (this.peaks[key] ||= { heap: 0, backing: 0, samples: 0 });
      peak.heap = Math.max(peak.heap, heap.usedSize);
      peak.backing = Math.max(peak.backing, heap.backingStorageSize || 0);
      peak.samples++;
    } catch {
    } finally {
      target.sampling = false;
    }
  }
  async stop() {
    clearInterval(this.timer);
    await Promise.all([...this.targets.keys()].map((id) => this.command(id, 'Debugger.resume').catch(() => undefined)));
    await this.cdp
      .send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: false })
      .catch(() => undefined);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Worker observer closed'));
    }
    this.pending.clear();
    await this.cdp.detach();
  }
}
