import { useEffect, useRef, useState } from 'react';
import { useReading, type BookRef } from './reading';
import { Button } from './Controls';
import { Dialog, ErrorNotice } from './ui';
import { Icon } from './Icon';
import styles from './OfflineReading.module.css';

export function OfflinePin({ book, metadata, overlay = false, canSave = true }: { overlay?: boolean; book: Extract<BookRef, { kind: 'server' }>; canSave?: boolean; metadata: { title: string | null; author: string | null } }) {
  const reading = useReading();
  const controller = useRef<AbortController | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function closeMenu() {
    if (!menu.current?.open) return;
    menu.current.open = false;
    menu.current.querySelector('summary')?.focus();
  }
  async function save(keep: boolean) {
    if (controller.current) return;
    const operation = controller.current = new AbortController();
    setBusy(true); setError(null);
    try { await reading.setPinned(book, keep, operation.signal, metadata); setConfirm(false); }
    catch (failure) { if (!operation.signal.aborted) setError(failure); }
    finally {
      if (!operation.signal.aborted) setBusy(false);
      operation.abort(); controller.current = null;
    }
  }
  const copy = reading.deviceCopies?.get(book.documentId);
  const actions = <>
    {canSave && copy !== 'saved' && <Button disabled={busy || !reading.ready} onClick={() => { closeMenu(); void save(true); }}>{busy ? 'Saving…' : 'Save to Device'}</Button>}
    {copy && <Button disabled={busy || !reading.ready} onClick={() => { closeMenu(); setError(null); setConfirm(true); }}>Remove from Device</Button>}
  </>;
  return <>{overlay ? <>
    <details ref={menu} className={styles.bookOptions} name="offline-book-options" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } }}>
      <summary aria-label={`Options for ${metadata.title ?? 'Untitled'}`} title="Book options"><Icon name="more" size={20} /></summary>
      <div>{actions}</div>
    </details></> : actions}
    {!confirm && <ErrorNotice error={error} />}
    {confirm && <Dialog title="Remove this download?" onClose={() => { if (!busy) setConfirm(false); }} footer={<>
      <Button disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button>
      <Button tone="primary" disabled={busy} onClick={() => void save(false)}>Remove from Device</Button>
    </>}><p>This removes the offline copy for all profiles on this device. Your reading progress and activity are kept.</p><ErrorNotice error={error} /></Dialog>}
  </>;
}
