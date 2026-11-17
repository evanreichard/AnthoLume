import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ReaderController, palette, type Appearance, type ReaderStatus } from './controller';
import { useReadingContext } from './provider';
import { sameAccount, refKey, type BookRef, type S } from './types';
import { ReaderWakeLock } from './wake-lock';
import { readerFontNames } from './reader-fonts';
import { activityEvent } from './activity';
import styles from './reader.module.css';

const defaults: Appearance = { size: 100, font: 'serif', theme: 'tan' };
export function ReaderScreen({ book, onClose }: { book: BookRef; onClose: () => void }): ReactNode {
  const { runtime, snapshot, access } = useReadingContext();
  const key = refKey(book);
  const host = useRef<HTMLDivElement>(null), controller = useRef<ReaderController | null>(null);
  const [readerState, setReaderState] = useState<{ key: string; value: ReaderStatus }>({ key, value: { state: 'opening', message: 'Opening stored book' } });
  const status: ReaderStatus = readerState.key === key ? readerState.value : { state: 'opening', message: 'Opening stored book' };
  const setStatus = (value: ReaderStatus) => setReaderState({ key, value });
  const [panel, setPanel] = useState<'toc' | 'appearance' | 'hide'>('hide'), [appearance, setAppearance] = useState(defaults);
  const [attempt, setAttempt] = useState(0), [explicitBeginning, setExplicitBeginning] = useState(false);
  const [title, setTitle] = useState<{ key: string; value: string | null } | null>(null);
  const seenStored = useRef<string | null>(null);
  const storedVisible = snapshot.books.some(row => refKey(row.ref) === key);
  if (storedVisible) seenStored.current = key;
  const permitted = book.kind === 'local' || ('account' in access && access.kind !== 'logout' && sameAccount(access.account, book.account) && (seenStored.current !== key || storedVisible));
  const appearanceRef = useRef(appearance); appearanceRef.current = appearance;
  useEffect(() => { setExplicitBeginning(false); }, [key]);
  useEffect(() => {
    if (!runtime || !snapshot.ready || !host.current || !permitted) return;
    let alive = true, resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController(), wake = new ReaderWakeLock();
    runtime.worker.reading++;
    const instance = new ReaderController(host.current, next => { if (alive) setStatus(next); }, async (location, measured) => {
      let activity: S['ActivityEvent'] | undefined;
      if (measured && book.kind === 'server') {
        const device = await runtime.repo.device(book.account);
        activity = activityEvent(book.documentId, device.id, measured);
      }
      await runtime.save(book, { position: location.ko, fraction: location.fraction }, activity);
    }, { localOnly: book.kind === 'local', interact: wake.interact, panel: setPanel,
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
      clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (alive && controller.current === instance) void instance.reflow(appearanceRef.current.size, appearanceRef.current.font, appearanceRef.current.theme); }, 150);
    });
    void (async () => {
      let stored = await runtime.repo.db.books.get(key);
      if (stored?.availability !== 'available' && book.kind === 'server') {
        const document: S['Document'] = { id: book.documentId, title: stored?.title ?? null, author: stored?.author ?? null, series: null, description: null, lang: null, file_available: true, cover_available: false, media_type: 'application/epub+zip', file_size_bytes: null };
        await runtime.download(document, abort.signal);
      }
      const opened = await runtime.repo.open(book); stored = opened.row;
      if (!alive) return;
      setTitle({ key, value: stored.title });
      const pref = (await runtime.repo.db.meta.get('appearance'))?.value as Appearance | undefined;
      const chosen = pref && Object.hasOwn(palette, pref.theme) && readerFontNames.includes(pref.font) && Number.isFinite(pref.size) && pref.size >= 70 && pref.size <= 200 ? pref : defaults;
      appearanceRef.current = chosen; setAppearance(chosen);
      await instance.open(opened.source, explicitBeginning ? undefined : stored.checkpoint.position || undefined, abort.signal, opened.manifest);
      if (!alive) return;
      if (controller.current === instance) await instance.reflow(chosen.size, chosen.font, chosen.theme);
      if (host.current) observer.observe(host.current);
    })().catch(error => { if (alive) setStatus({ state: 'error', message: String(error) }); });
    return () => { alive = false; abort.abort(); observer.disconnect(); clearTimeout(resizeTimer); wake.dispose(); controller.current = null; void instance.dispose().finally(() => { runtime.worker.reading--; void runtime.refresh(); }); };
  }, [runtime, snapshot.ready, key, permitted, attempt, explicitBeginning]);
  const changeAppearance = async (next: Appearance) => {
    setAppearance(next); appearanceRef.current = next;
    await controller.current?.reflow(next.size, next.font, next.theme);
    if (runtime) { runtime.worker.busy++; try { await runtime.repo.db.meta.put({ key: 'appearance', value: next }); } finally { runtime.worker.busy--; } }
  };
  const [background, color] = palette[appearance.theme];
  return <section className={styles.reader} style={{ background, color }} aria-label="Book reader" data-reader-state={status.state} data-reader-metrics={permitted ? JSON.stringify(status.diagnostics) : undefined}>
    <header className={styles.bar}><button onClick={onClose}>Close</button><strong>{permitted ? title?.key === key && title.value || 'Reader' : 'Book hidden'}</strong><button onClick={() => setPanel(panel === 'toc' ? 'hide' : 'toc')}>Contents</button><button onClick={() => setPanel(panel === 'appearance' ? 'hide' : 'appearance')}>Appearance</button></header>
    <div ref={host} className={styles.viewport} hidden={!permitted || readerState.key !== key} />
    {(!permitted || status.state !== 'ready') && <div className={styles.message} role={status.state === 'error' ? 'alert' : 'status'}>
      <p>{!permitted ? 'Sign in to this account to open its books.' : status.message}</p>
      {permitted && status.state === 'error' && <><button onClick={() => setAttempt(n => n + 1)}>Retry original position</button><button onClick={() => { setExplicitBeginning(true); setAttempt(n => n + 1); }}>Open beginning without changing saved position</button><p>Only a subsequent intentional navigation can save a new position.</p></>}
    </div>}
    {permitted && panel !== 'hide' && <aside className={styles.panel} aria-label={panel === 'toc' ? 'Contents' : 'Appearance'}><button onClick={() => setPanel('hide')}>Done</button>{panel === 'toc' ? <nav>{status.toc?.map((item, i) => <button key={`${item.href}:${i}`} onClick={() => { void controller.current?.toc(item.href); setPanel('hide'); }}>{item.label}</button>)}</nav> : <>
      <label>Theme <select value={appearance.theme} onChange={event => void changeAppearance({ ...appearance, theme: event.target.value as Appearance['theme'] })}>{Object.keys(palette).map(theme => <option key={theme}>{theme}</option>)}</select></label>
      <label>Font <select value={appearance.font} onChange={event => void changeAppearance({ ...appearance, font: event.target.value })}>{readerFontNames.map(font => <option key={font}>{font}</option>)}</select></label>
      <label>Size <input type="range" min="70" max="200" value={appearance.size} onChange={event => void changeAppearance({ ...appearance, size: Number(event.target.value) })} /></label>
    </>}</aside>}
    <footer className={styles.bar}><button aria-label="Previous page" disabled={!permitted} onClick={() => void controller.current?.previous()}>←</button><span>{!permitted ? 'Book hidden' : status.location ? `${status.location.page} / ${status.location.pages} · ${Math.round(status.location.fraction * 100)}%` : status.message}</span><button aria-label="Next page" disabled={!permitted} onClick={() => void controller.current?.next()}>→</button></footer>
  </section>;
}
