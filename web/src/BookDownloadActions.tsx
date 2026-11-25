import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OfflineShellError, useReading, type BookRef } from './reading';
import { Button } from './Controls';
import { Dialog, ErrorNotice } from './ui';
import { Icon } from './Icon';
import { bookKey } from './library';
import { useSnackbar } from './Snackbar';
import styles from './OfflineReading.module.css';

type ServerBook = Extract<BookRef, { kind: 'server' }>;
type Metadata = { title: string | null; author: string | null };
type DownloadAction = { kind: 'save'; metadata: Metadata } | { kind: 'remove' };

export function useBookDownload(book: ServerBook | null, canSave: boolean) {
  const reading = useReading();
  const key = book ? bookKey(book) : null;
  const copy = book ? reading.deviceCopies?.get(book.documentId) : undefined;
  const confirmation = useSnackbar(key ?? undefined);
  const retryNotice = useSnackbar(JSON.stringify([key, copy, canSave, reading.ready]));
  const controller = useRef<AbortController | null>(null);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [removalError, setRemovalError] = useState<unknown>(null);
  useLayoutEffect(() => {
    setConfirm(false); setBusy(false); setRemovalError(null);
    return () => { controller.current?.abort(); controller.current = null; };
  }, [key]);
  async function run(action: DownloadAction) {
    if (!book || controller.current || !reading.ready || (action.kind === 'save' && (!canSave || copy === 'saved'))) return;
    const operation = controller.current = new AbortController();
    const { signal } = operation;
    retryNotice.dismiss(); confirmation.dismiss(); setBusy(true); setRemovalError(null);
    try {
      if (action.kind === 'save') {
        await reading.saveToDevice(book, signal, action.metadata);
        if (!signal.aborted) confirmation.show({ message: 'Saved to device', icon: 'check' });
      } else await reading.removeFromDevice(book, signal);
      if (!signal.aborted) setConfirm(false);
    } catch (failure) {
      if (signal.aborted) return;
      if (action.kind === 'remove') setRemovalError(failure);
      else retryNotice.show({
        message: failure instanceof OfflineShellError ? `Couldn’t save for offline reading. ${failure.message}` : 'Couldn’t save for offline reading.',
        tone: 'error',
        action: { label: 'Retry', onClick: () => void run(action) },
      });
    } finally {
      if (controller.current === operation) { controller.current = null; setBusy(false); }
      operation.abort();
    }
  }
  return {
    copy,
    busy,
    disabled: busy || !reading.ready,
    removalError,
    confirm,
    save: ({ title, author }: Metadata) => void run({ kind: 'save', metadata: { title, author } }),
    askToRemove: () => { retryNotice.dismiss(); confirmation.dismiss(); setRemovalError(null); setConfirm(true); },
    cancel: () => { if (!busy) { setConfirm(false); setRemovalError(null); } },
    remove: () => void run({ kind: 'remove' }),
  };
}

export function DownloadRemovalDialog({ download }: { download: ReturnType<typeof useBookDownload> }) {
  if (!download.confirm) return null;
  return <Dialog title="Remove this download?" dismissDisabled={download.busy} onClose={download.cancel} footer={<>
    <Button disabled={download.busy} onClick={download.cancel}>Cancel</Button>
    <Button tone="primary" disabled={download.busy} onClick={download.remove}>Remove from Device</Button>
  </>}><p>This removes the offline copy for all profiles on this device. Your reading progress and activity are kept.</p><ErrorNotice error={download.removalError} /></Dialog>;
}

export function BookDownloadActions({ book, metadata, canSave = true }: { book: ServerBook; metadata: Metadata; canSave?: boolean }) {
  const download = useBookDownload(book, canSave);
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
      <summary aria-label={`Options for ${metadata.title ?? 'Untitled'}`} title="Book Options"><Icon name="more" size={20} /></summary>
      <div data-options>
        {canSave && download.copy !== 'saved' && <button type="button" disabled={download.disabled} onClick={() => { closeMenu(); download.save(metadata); }}><Icon name="download" size={17} />{download.busy ? 'Saving…' : 'Save to Device'}</button>}
        {download.copy && <button type="button" disabled={download.disabled} onClick={() => { closeMenu(); download.askToRemove(); }}><Icon name="minus" size={17} />Remove from Device</button>}
      </div>
    </details>
    <DownloadRemovalDialog download={download} />
  </>;
}
