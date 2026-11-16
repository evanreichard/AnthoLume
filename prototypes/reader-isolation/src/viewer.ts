import { Book } from 'epubjs';
import { toCFI, elementFromKO, koFromElement } from '../../reader-storage/src/codec';
import { partialMD5, fullMD5 } from '../../reader-storage/src/identity';
import { validCommand } from './bridge';

const nonce = document.querySelector<HTMLElement>('#session')!.dataset.nonce!;
const parentOrigin = document.querySelector<HTMLElement>('#session')!.dataset.parent!;
const evidence: any = { errors: [], chapters: [], engineAttempted: false, render: 'pending', codec: [], acceptedCommands: 0 };
(window as any).evidence = evidence;
window.addEventListener('error', event => { evidence.errors.push(event.message); });
window.addEventListener('unhandledrejection', event => { evidence.errors.push(String(event.reason)); });
const send = (value: Record<string, unknown>) => parent.postMessage({ ...value, nonce }, '*');
const denied = (action: () => unknown) => { try { action(); return false; } catch { return true; } };
send({ type: 'boot', origin: self.origin, parentDOM: !denied(() => parent.document.body), storage: !denied(() => localStorage.length), cookie: !denied(() => document.cookie) });
let book: Book | undefined;
let opening = false;
let tail = Promise.resolve();
const chapterCSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data: blob:; font-src data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
async function codec(path: string) {
  if (!book) return;
  const result = await toCFI(book, path);
  evidence.codec.push(result);
  send({ type: 'codec', path, ok: result.ok, cfi: result.ok ? result.cfi : '' });
}
async function open(bytes: ArrayBuffer) {
  if (opening) return;
  opening = true;
  send({ type: 'identity', partial: partialMD5(bytes), full: fullMD5(bytes), bytes: bytes.byteLength });
  book = new Book({ replacements: 'base64', requestMethod: (() => Promise.reject(new Error('No network request method'))) as any });
  try {
    await book.open(bytes, 'binary');
    await book.ready;
    book.spine.hooks.content.register((doc: Document) => {
      const meta = doc.createElement('meta');
      meta.setAttribute('http-equiv', 'Content-Security-Policy'); meta.setAttribute('content', chapterCSP);
      doc.head.prepend(meta);
      evidence.chapters.push({ body: doc.body.outerHTML, cspFirst: doc.head.firstElementChild === meta });
    });
    await codec('/body/DocFragment[1]/body');
    const first = book.spine.get(0) as any;
    const root = await first.load(book.load.bind(book));
    const target = root.ownerDocument.getElementById('target');
    if (target) {
      const path = koFromElement(0, target);
      evidence.roundTrip = { path, same: elementFromKO(root.ownerDocument, path) === target };
    }
    const report = (outcome: string) => {
      if (evidence.render !== 'pending') return;
      evidence.render = outcome;
      send({ type: 'render', outcome });
    };
    const observer = new MutationObserver(() => {
      for (const frame of document.querySelectorAll<HTMLIFrameElement>('#viewer iframe')) {
        if (frame.dataset.watched) continue;
        frame.dataset.watched = 'yes';
        frame.addEventListener('load', () => {
          evidence.frameSandbox = frame.sandbox.value;
          evidence.childDocument = frame.contentDocument !== null;
          report(frame.contentDocument ? 'unexpected-dom-access' : 'passive-frame-dom-unavailable');
        }, { once: true });
      }
    });
    observer.observe(document.querySelector('#viewer')!, { childList: true, subtree: true });
    evidence.engineAttempted = true;
    const rendition = book.renderTo(document.querySelector('#viewer')!, { width: 860, height: 560, spread: 'none', allowScriptedContent: false, method: 'srcdoc' } as any);
    rendition.hooks.content.register((contents: { document: Document }) => {
      const element = contents.document.getElementById('target');
      if (element) {
        const path = koFromElement(0, element);
        evidence.renderedCodec = { path, same: elementFromKO(contents.document, path) === element };
      }
    });
    // A Hung Engine Is Evidence - Never replace the sandbox flags to get a successful display.
    void rendition.display().catch(error => { evidence.errors.push(String(error)); });
  } catch (error) {
    evidence.errors.push(String(error));
    evidence.render = 'open-rejected';
    send({ type: 'render', outcome: 'open-rejected' });
  }
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== parentOrigin || !validCommand(event.data, nonce)) return;
  evidence.acceptedCommands++;
  tail = tail.then(async () => {
    if (event.data.type === 'open') await open(event.data.bytes);
    else await codec(event.data.path);
  }).catch(error => evidence.errors.push(String(error)));
});
