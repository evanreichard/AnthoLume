export class ReaderWakeLock {
  private sentinel?: WakeLockSentinel;
  private dead = false;
  private until = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private requesting = false;
  private visibility = () => {
    if (document.visibilityState === 'visible' && Date.now() < this.until) void this.acquire();
    else void this.release();
  };
  constructor() {
    document.addEventListener('visibilitychange', this.visibility);
  }
  interact = () => {
    this.until = Date.now() + 600000;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.release();
    }, 600000);
    void this.acquire();
  };
  private async acquire() {
    if (this.dead || this.requesting || this.sentinel || !navigator.wakeLock || document.visibilityState !== 'visible')
      return;
    this.requesting = true;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (this.dead || Date.now() >= this.until || document.visibilityState !== 'visible') await sentinel.release();
      else {
        this.sentinel = sentinel;
        sentinel.addEventListener(
          'release',
          () => {
            if (this.sentinel === sentinel) this.sentinel = undefined;
          },
          { once: true },
        );
      }
    } catch {
      /* Native Support - A denied screen lock does not change reading or introduce media playback. */
    } finally {
      this.requesting = false;
    }
  }
  private async release() {
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    await sentinel?.release().catch(() => undefined);
  }
  dispose() {
    this.dead = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.visibility);
    void this.release();
  }
}
