import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ReaderController, palette, type Appearance, type ReaderStatus } from './controller';
import { useReadingContext } from './provider';
import { sameAccount, refKey, type BookRef, type S } from './types';
import { ReaderWakeLock } from './wake-lock';
import { readerFontLabel, readerFontNames } from './reader-fonts';
import { activityEvent } from './activity';
import styles from './reader.module.css';
import { Icon } from '../Icon';
import { Button } from '../Controls';
import { Dialog } from '../ui';
import { GestureLayer, useParentGestures } from './GestureLayer';

const defaults: Appearance = { size: 100, font: 'serif', theme: 'tan' };
type ChromeAction = 'show' | 'toggle' | 'focus' | 'hide';
const chromeIdleMs = 4000;
const themeNames: Record<Appearance['theme'], string> = { light: 'Light', tan: 'Paper', blue: 'Mist', gray: 'Slate', black: 'Night' };
const minTextSize = 50, maxTextSize = 200;
const clampSize = (size: number) => Math.max(minTextSize, Math.min(maxTextSize, Math.round(size)));

function resumeLabel(source: string, progress: number | null, savedAt?: string) {
  return `${source}${progress == null ? '' : ` · ${Math.round(progress * 100)}%`}${savedAt ? ` · ${new Date(savedAt).toLocaleDateString()}` : ''}`;
}

function Chevron({ right = false }: { right?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={right ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'} /></svg>;
}
function PageEdge({ next, turn }: { next: boolean; turn: (forward: boolean) => void }) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const handled = useRef(false);
  return <button type="button" className={`${styles.pageEdge} ${next ? styles.edgeRight : styles.edgeLeft}`} aria-label={next ? 'Next page at edge' : 'Previous page at edge'}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      handled.current = false;
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerUp={event => {
      const down = start.current;
      if (down?.id !== event.pointerId) return;
      start.current = null;
      const dx = event.clientX - down.x, dy = event.clientY - down.y;
      handled.current = Math.max(Math.abs(dx), Math.abs(dy)) > 12;
      if (Math.abs(dx) >= 35 && Math.abs(dx) > Math.abs(dy)) turn(dx < 0);
    }}
    onPointerCancel={() => { start.current = null; handled.current = true; }}
    onClick={event => { if (!handled.current || event.detail === 0) turn(next); }}>
    <Chevron right={next} />
  </button>;
}

export function ReaderScreen({ book, onClose }: { book: BookRef; onClose: () => void }): ReactNode {
  const { runtime, snapshot, access } = useReadingContext();
  const key = refKey(book);
  const parentGestures = useParentGestures();
  const [selecting, setSelecting] = useState(false);
  const host = useRef<HTMLDivElement>(null), controller = useRef<ReaderController | null>(null);
  const [readerState, setReaderState] = useState<{ key: string; value: ReaderStatus }>({ key, value: { state: 'opening', message: 'Getting the reader ready…' } });
  const status: ReaderStatus = readerState.key === key ? readerState.value : { state: 'opening', message: 'Getting the reader ready…' };
  const setStatus = (value: ReaderStatus) => setReaderState({ key, value });
  const [panel, setPanel] = useState<'toc' | 'appearance' | 'hide'>('hide'), [storedAppearance, setAppearance] = useState<Appearance>();
  const appearance = storedAppearance ?? defaults;
  const [chrome, setChrome] = useState({ visible: false, activity: 0 });
  const [hovering, setHovering] = useState(false), [showHint, setShowHint] = useState(false);
  const [hasOpened, setHasOpened] = useState(false), [showLoading, setShowLoading] = useState(false);
  const top = useRef<HTMLElement>(null), bottom = useRef<HTMLElement>(null);
  const keyboardReveal = useRef<HTMLButtonElement>(null), focusControls = useRef(false);
  const appearanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draggingSize = useRef(false);
  const pinchBase = useRef<number | null>(null), pinchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pinchSize, setPinchSize] = useState<number | null>(null);
  const pendingAppearance = useRef<Appearance | null>(null);
  const applyingAppearance = useRef<ReaderController | null>(null);
  const [attempt, setAttempt] = useState(0), [explicitBeginning, setExplicitBeginning] = useState(false);
  const [resumeChoice, setResumeChoice] = useState<{ key: string; device: string; server: string; choose: (device: boolean) => void } | null>(null);
  const permitted = book.kind === 'local' || (access.kind === 'authenticated' && sameAccount(access.account, book.account));
  const appearanceRef = useRef(appearance), appliedAppearance = useRef(defaults);
  function refreshChrome() { setChrome(current => ({ ...current, activity: current.activity + 1 })); }
  function reveal(action: ChromeAction) {
    if (action === 'hide' || action === 'toggle') closePanel();
    if (action === 'hide') {
      setHovering(false);
      if (keyboardReveal.current?.parentElement?.contains(document.activeElement) && document.activeElement?.matches(':focus-visible')) keyboardReveal.current.focus();
    }
    if (action === 'focus' || action === 'hide') focusControls.current = action === 'focus';
    setChrome(current => ({ visible: action === 'toggle' ? !current.visible : action !== 'hide', activity: current.activity + 1 }));
    setShowHint(false);
  }
  useEffect(() => {
    if (!chrome.visible || !focusControls.current) return;
    const frame = requestAnimationFrame(() => {
      focusControls.current = false;
      top.current?.querySelector('button')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [chrome]);
  useEffect(() => {
    if (!chrome.visible || panel !== 'hide' || hovering) return;
    const timer = setTimeout(() => {
      if (top.current?.querySelector(':focus-visible') || bottom.current?.querySelector(':focus-visible')) return;
      setChrome(current => ({ ...current, visible: false }));
    }, chromeIdleMs);
    return () => clearTimeout(timer);
  }, [chrome, panel, hovering]);
  useEffect(() => {
    setShowHint(false);
    if (!hasOpened || !permitted) return;
    const hintKey = 'antholume.reader-controls-hint';
    try {
      if (localStorage.getItem(hintKey)) return;
      localStorage.setItem(hintKey, 'seen');
    } catch { /* The hint still works without storage. */ }
    setShowHint(true);
    const timer = setTimeout(() => setShowHint(false), chromeIdleMs);
    return () => clearTimeout(timer);
  }, [hasOpened, permitted]);
  useEffect(() => { setExplicitBeginning(false); setChrome({ visible: false, activity: 0 }); setHovering(false); setSelecting(false); }, [key]);
  useEffect(() => {
    setShowLoading(false);
    if (hasOpened || status.state !== 'opening' || !permitted) return;
    const timer = setTimeout(() => setShowLoading(true), 450);
    return () => clearTimeout(timer);
  }, [hasOpened, status.state, permitted, key]);
  useEffect(() => {
    if (!runtime || !snapshot.ready || !host.current || !permitted || parentGestures === undefined) return;
    let alive = true, resizeTimer: ReturnType<typeof setTimeout> | undefined;
    setHasOpened(false);
    setStatus({ state: 'opening', message: 'Reading your preferences…' });
    const abort = new AbortController(), wake = new ReaderWakeLock();
    const prepareDeadline = () => setTimeout(() => {
      abort.abort();
      if (alive) setStatus({ state: 'error', message: 'The book took too long to prepare. Check your connection and retry.' });
    }, 90_000);
    let deadline = prepareDeadline(), ready = false;
    const instance = new ReaderController(host.current, next => {
      if (!alive) return;
      if (next.state === 'ready') { ready = true; setHasOpened(true); }
      setStatus(next);
    }, async (location, measured) => {
      let activity: S['ActivityEvent'] | undefined;
      if (measured && book.kind === 'server') {
        const device = await runtime.repo.device(book.account);
        activity = activityEvent(book.documentId, device.id, measured);
      }
      await runtime.save(book, { position: location.ko, fraction: location.fraction }, activity);
    }, { localOnly: book.kind === 'local', parentGestures, interact: wake.interact, chrome: reveal, resizeText: resizeFromPinch,
      cycleTheme: () => { const themes = Object.keys(palette) as Appearance['theme'][]; void changeAppearance({ ...appearanceRef.current, theme: themes[(themes.indexOf(appearanceRef.current.theme) + 1) % themes.length]! }); },
      credit: async measured => {
        if (book.kind !== 'server') return;
        const device = await runtime.repo.device(book.account);
        await runtime.credit(book, activityEvent(book.documentId, device.id, measured), measured);
      },
    });
    controller.current = instance;
    let dimensions: { width: number; height: number } | undefined;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect; if (!rect) return;
      const previous = dimensions; dimensions = { width: rect.width, height: rect.height };
      if (!previous || Math.abs(previous.width - rect.width) < 1 && Math.abs(previous.height - rect.height) < 1) return;
      clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (alive && controller.current === instance) { const current = appliedAppearance.current; void instance.reflow(current.size, current.font, current.theme); } }, 150);
    });
    void (async () => {
      const pref = (await runtime.repo.db.meta.get('appearance'))?.value as Appearance | undefined;
      if (!alive) return;
      const chosen = pref && Object.hasOwn(palette, pref.theme) && readerFontNames.includes(pref.font) && Number.isFinite(pref.size) && pref.size >= minTextSize && pref.size <= maxTextSize ? pref : defaults;
      appliedAppearance.current = chosen; appearanceRef.current = chosen; setAppearance(chosen);
      const reportStage = (message: string) => { if (alive && !abort.signal.aborted) setStatus({ state: 'opening', message }); };
      if (book.kind === 'local') reportStage('Opening stored copy…');
      const opened = book.kind === 'server' ? await runtime.openServerBook(book, abort.signal, reportStage) : await runtime.repo.open(book);
      if (!alive) return;
      const { checkpoint, resumeCandidate, lastReadAt } = opened.row;
      let position = explicitBeginning ? null : checkpoint.position;
      if (!explicitBeginning && resumeCandidate && resumeCandidate.position !== checkpoint.position) {
        clearTimeout(deadline);
        const useDevice = await new Promise<boolean>((resolve, reject) => {
          const cancelled = () => reject(abort.signal.reason);
          abort.signal.addEventListener('abort', cancelled, { once: true });
          setResumeChoice({ key, device: resumeLabel('This device', resumeCandidate.fraction, resumeCandidate.savedAt), server: resumeLabel('Server', checkpoint.fraction, lastReadAt), choose: device => {
            abort.signal.removeEventListener('abort', cancelled);
            setResumeChoice(null);
            resolve(device);
          } });
        });
        abort.signal.throwIfAborted();
        if (useDevice) position = resumeCandidate.position;
        deadline = prepareDeadline();
      }
      await instance.open(opened.source, position ?? undefined, abort.signal, opened.manifest, chosen);
      if (!alive || !ready || abort.signal.aborted) return;
      if (!explicitBeginning && resumeCandidate) await runtime.repo.clearResumeCandidate(book, resumeCandidate);
      if (alive && host.current) observer.observe(host.current);
    })().catch(error => {
      if (alive && !abort.signal.aborted) setStatus({ state: 'error', message: String(error) });
    }).finally(() => clearTimeout(deadline));
    return () => {
      alive = false; clearTimeout(deadline); abort.abort(); setResumeChoice(null); observer.disconnect(); clearTimeout(resizeTimer); wake.dispose();
      clearTimeout(appearanceTimer.current); appearanceTimer.current = undefined;
      clearTimeout(pinchTimer.current); pinchBase.current = null;
      pendingAppearance.current = null; draggingSize.current = false; controller.current = null;
      void instance.dispose();
    };
  }, [runtime, snapshot.ready, key, permitted, attempt, explicitBeginning, parentGestures]);
  async function applyAppearance() {
    clearTimeout(appearanceTimer.current); appearanceTimer.current = undefined;
    const instance = controller.current;
    if (!runtime || !instance || applyingAppearance.current === instance) return;
    applyingAppearance.current = instance;
    try {
      while (controller.current === instance && pendingAppearance.current && !draggingSize.current && appearanceTimer.current === undefined) {
        const next = pendingAppearance.current;
        pendingAppearance.current = null;
        appliedAppearance.current = next;
        await runtime.repo.db.meta.put({ key: 'appearance', value: next });
        await instance.reflow(next.size, next.font, next.theme);
      }
    } catch {
      if (controller.current === instance) setStatus({ state: 'error', message: 'Could not apply reading preferences. Please try again.' });
    } finally {
      if (applyingAppearance.current === instance) applyingAppearance.current = null;
    }
  }
  function changeAppearance(next: Appearance, debounce = false) {
    setAppearance(next); appearanceRef.current = next; pendingAppearance.current = next;
    clearTimeout(appearanceTimer.current); appearanceTimer.current = undefined;
    if (draggingSize.current) return;
    if (debounce) appearanceTimer.current = setTimeout(() => void applyAppearance(), 150);
    else void applyAppearance();
  }
  function resizeFromPinch(scale: number, finished: boolean) {
    if (finished && pinchBase.current === null) return;
    const base = pinchBase.current ??= appearanceRef.current.size;
    const size = Math.abs(scale - 1) < .04 ? base : clampSize(base * scale);
    clearTimeout(pinchTimer.current);
    setPinchSize(size);
    if (finished) {
      pinchBase.current = null;
      if (size !== appearanceRef.current.size) changeAppearance({ ...appearanceRef.current, size });
      pinchTimer.current = setTimeout(() => setPinchSize(null), 850);
    }
  }
  const setTextSize = (size: number) => changeAppearance({ ...appearanceRef.current, size: clampSize(size) });
  function finishSize() {
    draggingSize.current = false;
    void applyAppearance();
  }
  function closePanel() {
    setPanel('hide');
    if (draggingSize.current || pendingAppearance.current) finishSize();
  }
  const [background, color] = palette[appearance.theme];
  useLayoutEffect(() => {
    if (!permitted || !storedAppearance) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previous = meta?.content;
    const surfaces = [document.documentElement, document.body];
    const backgrounds = surfaces.map(element => element.style.backgroundColor);
    // Safari Chrome - Keep the document fallback and older theme-color behavior in sync with the edge paint.
    if (meta) meta.content = background;
    surfaces.forEach(element => { element.style.backgroundColor = background; });
    return () => {
      if (meta && previous !== undefined) meta.content = previous;
      surfaces.forEach((element, i) => { element.style.backgroundColor = backgrounds[i]!; });
    };
  }, [background, permitted, !!storedAppearance]);
  const location = status.location;
  const currentChapter = status.toc?.find(item => item.href.split('#')[0] === location?.chapter.split('#')[0]);
  const canTurn = permitted && status.state === 'ready';
  const download = snapshot.downloads.find(item => refKey(item.ref) === key);
  const loadingMessage = !snapshot.ready ? 'Starting reader storage…' : status.message;
  const storageError = !hasOpened && !snapshot.ready ? snapshot.error : null;
  const chromeVisible = chrome.visible || panel !== 'hide';
  const chromeEvents = {
    onPointerEnter: (event: React.PointerEvent) => { if (event.pointerType === 'mouse') setHovering(true); },
    onPointerLeave: (event: React.PointerEvent) => { if (event.pointerType === 'mouse') setHovering(false); },
    onPointerDown: refreshChrome,
    onFocus: refreshChrome,
    onBlur: refreshChrome,
  };
  const turn = (forward: boolean) => {
    if (canTurn) void (forward ? controller.current?.next() : controller.current?.previous());
  };
  return <section className={styles.reader} style={{ visibility: !storedAppearance && !showLoading && status.state === 'opening' && !storageError ? 'hidden' : undefined, background, color, colorScheme: appearance.theme === 'gray' || appearance.theme === 'black' ? 'dark' : 'light', '--reader-paper': background } as CSSProperties} aria-label="Book reader" data-reader-state={status.state} data-reader-metrics={permitted ? JSON.stringify(status.diagnostics) : undefined}>
    {hasOpened && permitted && status.state !== 'error' && <button ref={keyboardReveal} type="button" className={`${styles.srOnly} ${styles.keyboardReveal}`} aria-keyshortcuts="C" onClick={() => reveal('focus')}>Show reader controls</button>}
    <header ref={top} inert={!chromeVisible && permitted && status.state !== 'error' && hasOpened} className={`${styles.bar} ${styles.top}`}>
      <button {...chromeEvents} className={styles.glass} onClick={onClose}><Chevron /><span>Library</span></button>
      <div className={styles.tools} role="group" aria-label="Reading tools">
        {permitted && status.canGoBack && <button {...chromeEvents} className={styles.glass} disabled={status.state !== 'ready'} aria-label="Back to previous spot" title="Back to previous spot" onClick={() => { closePanel(); reveal('show'); void controller.current?.back(); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 14-5-5 5-5M4 9h10a5 5 0 0 1 0 10h-2" /></svg><span>Back</span></button>}
        <button {...chromeEvents} className={styles.glass} disabled={!hasOpened} aria-label="Contents" aria-controls={panel === 'toc' ? 'reader-panel' : undefined} aria-expanded={panel === 'toc'} onClick={() => panel === 'toc' ? closePanel() : setPanel('toc')}><Icon name="contents" /><span>Contents</span></button>
      </div>
    </header>
    <div ref={host} className={styles.viewport} hidden={!permitted || readerState.key !== key} />
    {permitted && resumeChoice?.key === key && <Dialog title="Conflicting Positions" onClose={onClose} footer={<>
      <Button size="slim" onClick={() => resumeChoice.choose(true)}>{resumeChoice.device}</Button>
      <Button size="slim" tone="primary" onClick={() => resumeChoice.choose(false)}>{resumeChoice.server}</Button>
    </>}><p>Where would you like to resume? Choosing a position won’t overwrite progress on the server.</p></Dialog>}
    {permitted && <><span aria-hidden="true" className={`${styles.edgePaint} ${styles.edgePaintTop}`} /><span aria-hidden="true" className={`${styles.edgePaint} ${styles.edgePaintBottom}`} /></>}
    {canTurn && panel === 'hide' && !parentGestures && <><PageEdge next={false} turn={turn} /><PageEdge next turn={turn} /></>}
    {hasOpened && permitted && status.state !== 'error' && parentGestures && !selecting && <GestureLayer className={styles.gestureLayer}
      resize={(scale, finished) => { if (canTurn && panel === 'hide' || finished) resizeFromPinch(scale, finished); }}
      turn={turn} showControls={() => reveal('show')} tap={(x, y, zone) => {
        if (panel !== 'hide') { reveal('hide'); return; }
        if (!canTurn || controller.current?.tapLinkAt(x, y)) return;
        if (zone < .2 || zone > .8) turn(zone > .8);
        else reveal('toggle');
      }} />}
    {pinchSize !== null && permitted && <output className={`${styles.pinchHud} ${styles.glass}`} aria-label="Text size">Aa <strong>{pinchSize}%</strong></output>}
    {selecting && permitted && <button className={`${styles.doneSelecting} ${styles.glass}`} onClick={() => { setSelecting(false); reveal('show'); }}>Done</button>}
    {showHint && !chromeVisible && canTurn && <p className={`${styles.hint} ${styles.glass}`} role="status"><span className={styles.touchHint}>Tap the center for controls</span><span className={styles.mouseHint}>Move to the center or press C for controls</span></p>}
    {permitted && <span className={styles.srOnly} role="status">{status.state === 'opening' && !storageError ? loadingMessage : ''}</span>}
    {showLoading && permitted && !hasOpened && status.state === 'opening' && !storageError && <div className={styles.loading}><span aria-hidden="true">{loadingMessage}</span>{download && !download.preparing && <><progress aria-label="EPUB download progress" max={download.totalBytes || undefined} value={download.totalBytes ? Math.min(download.receivedBytes, download.totalBytes) : undefined} /><small>{(download.receivedBytes / 1048576).toFixed(1)} MiB{download.totalBytes ? ` / ${(download.totalBytes / 1048576).toFixed(1)} MiB · ${Math.floor(Math.min(1, download.receivedBytes / download.totalBytes) * 100)}%` : ''}</small></>}</div>}
    {permitted && storageError && <div className={styles.message} role="alert"><p>Could not start reader storage. {storageError}</p><button onClick={() => window.location.reload()}>Reload reader</button></div>}
    {(!permitted || status.state === 'error') && <div className={styles.message} role="alert">
      <p>{!permitted ? 'Sign in to this account to open its books.' : status.message}</p>
      {permitted && <><button onClick={() => setAttempt(n => n + 1)}>Retry original position</button><button onClick={() => { setExplicitBeginning(true); setAttempt(n => n + 1); }}>Open beginning without changing saved position</button><p>Only a subsequent intentional navigation can save a new position.</p></>}
    </div>}
    {permitted && panel !== 'hide' && <aside id="reader-panel" className={`${styles.panel} ${panel === 'appearance' ? styles.progressPanel : ''}`} aria-labelledby="reader-panel-title">
      <div className={styles.panelHeader}>
        <h2 id="reader-panel-title">{panel === 'toc' ? 'Contents' : 'Appearance'}</h2>
        <button onClick={(event) => { if (event.currentTarget.matches(':focus-visible')) (panel === 'toc' ? top : bottom).current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus(); closePanel(); }}>Done</button>
      </div>
      {panel === 'toc' ? <>
        {status.toc?.length ? <nav aria-label="Chapters"><ol className={styles.chapterList}>{status.toc.map((item, i) => {
          const current = item === currentChapter;
          return <li key={`${item.href}:${i}`}><button aria-current={current ? 'location' : undefined} onClick={() => { closePanel(); reveal('show'); void controller.current?.toc(item.href); }}><span>{item.label}</span><Chevron right /></button></li>;
        })}</ol></nav> : <p className={styles.panelNote}>This book doesn’t have a table of contents.</p>}
      </> : <div className={styles.appearanceOptions}>
        <div className={styles.size}>
          <label htmlFor="reader-text-size">Text size</label><output htmlFor="reader-text-size">{appearance.size}%</output>
          <div className={styles.sizeControls}>
            <button aria-label="Decrease text size" disabled={appearance.size <= minTextSize} onClick={() => setTextSize(appearance.size - 10)}>A−</button>
            <input id="reader-text-size" type="range" min={minTextSize} max={maxTextSize} value={appearance.size} aria-valuetext={`${appearance.size}%`} onPointerDown={() => { draggingSize.current = true; clearTimeout(appearanceTimer.current); appearanceTimer.current = undefined; }} onPointerUp={finishSize} onPointerCancel={finishSize} onBlur={finishSize} onChange={event => changeAppearance({ ...appearanceRef.current, size: Number(event.target.value) }, true)} />
            <button aria-label="Increase text size" disabled={appearance.size >= maxTextSize} onClick={() => setTextSize(appearance.size + 10)}>A+</button>
          </div>
        </div>
        <label className={styles.fontRow}>Font <select value={appearance.font} onChange={event => changeAppearance({ ...appearanceRef.current, font: event.target.value })}>{readerFontNames.map(font => <option key={font} value={font}>{readerFontLabel(font)}</option>)}</select></label>
        <fieldset className={styles.themeField}>
          <legend>Theme</legend>
          <div className={styles.themes}>{(Object.keys(palette) as Appearance['theme'][]).map(theme => {
            const [paper, ink] = palette[theme];
            return <button key={theme} aria-pressed={appearance.theme === theme} onClick={() => changeAppearance({ ...appearanceRef.current, theme })}>
              <span style={{ background: paper, color: ink }}>Aa</span>{themeNames[theme]}
            </button>;
          })}</div>
        </fieldset>
        {parentGestures && <button className={styles.selectAction} onClick={() => { setSelecting(true); reveal('hide'); }}>Select Text</button>}
      </div>}
    </aside>}
    <footer ref={bottom} {...chromeEvents} inert={selecting || !chromeVisible || !hasOpened || !permitted || status.state === 'error'} className={`${styles.bar} ${styles.bottom} ${styles.glass}`}>
      <button aria-label="Previous page" disabled={!permitted || status.state !== 'ready'} onClick={() => turn(false)}><Chevron /></button>
      <button aria-label="Reading progress and appearance" aria-controls={panel === 'appearance' ? 'reader-panel' : undefined} aria-expanded={panel === 'appearance'} onClick={() => panel === 'appearance' ? closePanel() : setPanel('appearance')}>
        <span>{location ? `${location.page} / ${location.pages} · ${Math.round(location.fraction * 100)}%` : ''}</span><svg className={styles.expandIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
      </button>
      <button aria-label="Next page" disabled={!permitted || status.state !== 'ready'} onClick={() => turn(true)}><Chevron right /></button>
    </footer>
  </section>;
}
