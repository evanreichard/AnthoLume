import { trustedObservation } from './bridge';

export const lifecycle = { created: 0, disposed: 0, listeners: 0, frames: 0, accepted: 0, ignored: 0 };
export class IsolatedReader {
  readonly frame = document.createElement('iframe');
  readonly nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  private dead = false;
  private opened = false;
  private resolveBoot!: () => void;
  readonly boot = new Promise<void>(resolve => { this.resolveBoot = resolve; });
  private onMessage = (event: MessageEvent) => {
    if (this.dead) return;
    if (!trustedObservation(event, this.frame.contentWindow, this.nonce)) { lifecycle.ignored++; return; }
    lifecycle.accepted++;
    if (event.data.type === 'boot') this.resolveBoot();
    this.observe(event.data);
  };
  constructor(host: HTMLElement, bundle: string, private observe: (value: unknown) => void) {
    lifecycle.created++; lifecycle.listeners++; lifecycle.frames++;
    this.frame.dataset.viewer = 'opaque';
    this.frame.title = 'Isolated trusted EPUB viewer';
    this.frame.sandbox.value = 'allow-scripts';
    this.frame.style.cssText = 'width:900px;height:650px;border:1px solid';
    this.frame.referrerPolicy = 'no-referrer';
    // Bundled IIFE - A hash authorizes this trusted script, never book scripts or opaque-origin module fetches.
    this.frame.srcdoc = '<!doctype html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-' + BUNDLE_HASH + '\'; style-src \'unsafe-inline\' data: blob:; img-src blob: data:; font-src blob: data:; frame-src about: blob: data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"></head><body><div id="viewer" style="height:600px"></div><i id="session" data-nonce="' + this.nonce + '" data-parent="' + location.origin + '"></i><script>' + bundle.replace(/<\/script/gi, '<\\/script') + '</script></body>';
    window.addEventListener('message', this.onMessage);
    host.append(this.frame);
  }
  async open(bytes: ArrayBuffer) {
    if (this.dead || this.opened) throw new Error('single-use viewer');
    this.opened = true;
    await this.boot;
    if (this.dead) return;
    const copy = bytes.slice(0);
    this.frame.contentWindow!.postMessage({ type: 'open', nonce: this.nonce, bytes: copy }, '*', [copy]);
  }
  codec(path: string) {
    if (!this.dead) this.frame.contentWindow!.postMessage({ type: 'codec', nonce: this.nonce, path }, '*');
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.resolveBoot();
    window.removeEventListener('message', this.onMessage);
    this.frame.remove();
    lifecycle.disposed++; lifecycle.listeners--; lifecycle.frames--;
  }
}
declare const BUNDLE_HASH: string;
