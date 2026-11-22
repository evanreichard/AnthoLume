import { useEffect, useRef, useState } from 'react';
import { useReading, type BookRef } from './reading';
import { Button } from './Controls';
import { Dialog, ErrorNotice } from './ui';
import { Icon } from './Icon';
import styles from './OfflineReading.module.css';

export function BookDownloadActions({ book, metadata, overlay = false, canSave = true }: { overlay?: boolean; book: Extract<BookRef, { kind: 'server' }>; canSave?: boolean; metadata: { title: string | null; author: string | null } }) {
  const reading = useReading();
  const controller = useRef<AbortController | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  useEffect(() => () => controller.current?.abort(), []);
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
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const operation = controller.current = new AbortController();
    setBusy(true); setError(null);
    try { await action(operation.signal); setConfirm(false); }
    catch (failure) { if (!operation.signal.aborted) setError(failure); }
    finally {
      if (!operation.signal.aborted) setBusy(false);
      operation.abort(); controller.current = null;
    }
  }
  const copy = reading.deviceCopies?.get(book.documentId);
  const Action = overlay ? 'button' : Button;
  const actions = <>
    {canSave && copy !== 'saved' && <Action type="button" disabled={busy || !reading.ready} onClick={() => { closeMenu(); void run(signal => reading.saveToDevice(book, signal, metadata)); }}>{overlay && <Icon name="download" size={17} />}{busy ? 'Saving…' : 'Save to Device'}</Action>}
    {copy && <Action type="button" disabled={busy || !reading.ready} onClick={() => { closeMenu(); setError(null); setConfirm(true); }}>{overlay && <Icon name="minus" size={17} />}Remove from Device</Action>}
  </>;
  return <>{overlay ? <>
    <details ref={menu} onToggle={e => setOpen(e.currentTarget.open)} className={styles.bookOptions} name="offline-book-options" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } }}>
      <summary aria-label={`Options for ${metadata.title ?? 'Untitled'}`} title="Book options"><Icon name="more" size={20} /></summary>
      <div data-options>{actions}</div>
    </details></> : actions}
    {!confirm && <ErrorNotice error={error} />}
    {confirm && <Dialog title="Remove this download?" onClose={() => { if (!busy) setConfirm(false); }} footer={<>
      <Button disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button>
      <Button tone="primary" disabled={busy} onClick={() => void run(signal => reading.removeFromDevice(book, signal))}>Remove from Device</Button>
    </>}><p>This removes the offline copy for all profiles on this device. Your reading progress and activity are kept.</p><ErrorNotice error={error} /></Dialog>}
  </>;
}
