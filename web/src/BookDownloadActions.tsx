import { useEffect, useRef, useState } from 'react';
import { useReading, type BookRef } from './reading';
import { Button } from './Controls';
import { Dialog, ErrorNotice } from './ui';
import { Icon } from './Icon';
import styles from './OfflineReading.module.css';

type ServerBook = Extract<BookRef, { kind: 'server' }>;
type Metadata = { title: string | null; author: string | null };

export function useBookDownload(book: ServerBook | null) {
  const reading = useReading();
  const controller = useRef<AbortController | null>(null);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(action: (book: ServerBook, signal: AbortSignal) => Promise<void>) {
    if (!book || controller.current || !reading.ready) return;
    const operation = controller.current = new AbortController();
    setBusy(true); setError(null);
    try { await action(book, operation.signal); setConfirm(false); }
    catch (failure) { if (!operation.signal.aborted) setError(failure); }
    finally {
      if (!operation.signal.aborted) setBusy(false);
      operation.abort(); controller.current = null;
    }
  }
  return {
    copy: book ? reading.deviceCopies?.get(book.documentId) : undefined,
    busy,
    disabled: busy || !reading.ready,
    error,
    confirm,
    save: (metadata: Metadata) => void run((ref, signal) => reading.saveToDevice(ref, signal, metadata)),
    askToRemove: () => { setError(null); setConfirm(true); },
    cancel: () => { if (!busy) { setConfirm(false); setError(null); } },
    remove: () => void run((ref, signal) => reading.removeFromDevice(ref, signal)),
  };
}

export function DownloadRemovalDialog({ download }: { download: ReturnType<typeof useBookDownload> }) {
  if (!download.confirm) return null;
  return <Dialog title="Remove this download?" onClose={download.cancel} footer={<>
    <Button disabled={download.busy} onClick={download.cancel}>Cancel</Button>
    <Button tone="primary" disabled={download.busy} onClick={download.remove}>Remove from Device</Button>
  </>}><p>This removes the offline copy for all profiles on this device. Your reading progress and activity are kept.</p><ErrorNotice error={download.error} /></Dialog>;
}

export function BookDownloadActions({ book, metadata, canSave = true }: { book: ServerBook; metadata: Metadata; canSave?: boolean }) {
  const download = useBookDownload(book);
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const details = menu.current;
    const panel = details?.querySelector<HTMLElement>('[data-options]');
    if (!open || !details || !panel) return;
    function place() {
      if (!details || !panel) return;
      const right = details.getBoundingClientRect().right - 4;
      panel.style.setProperty('--shift', `${Math.max(0, 8 + panel.offsetWidth - right)}px`);
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  function closeMenu() {
    if (!menu.current?.open) return;
    menu.current.open = false;
    menu.current.querySelector('summary')?.focus();
  }
  return <>
    <details ref={menu} onToggle={e => setOpen(e.currentTarget.open)} className={styles.bookOptions} name="offline-book-options" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } }}>
      <summary aria-label={`Options for ${metadata.title ?? 'Untitled'}`} title="Book options"><Icon name="more" size={20} /></summary>
      <div data-options>
        {canSave && download.copy !== 'saved' && <button type="button" disabled={download.disabled} onClick={() => { closeMenu(); download.save(metadata); }}><Icon name="download" size={17} />{download.busy ? 'Saving…' : 'Save to Device'}</button>}
        {download.copy && <button type="button" disabled={download.disabled} onClick={() => { closeMenu(); download.askToRemove(); }}><Icon name="minus" size={17} />Remove from Device</button>}
      </div>
    </details>
    {!download.confirm && <ErrorNotice error={download.error} />}
    <DownloadRemovalDialog download={download} />
  </>;
}
