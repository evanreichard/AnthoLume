import { useEffect, useRef, useState } from 'react';
import { useReading, type BookRef } from './reading';
import { Button } from './Controls';
import { Dialog, ErrorNotice } from './ui';
import { Icon } from './Icon';
import styles from './OfflineReading.module.css';

export function OfflinePin({ book, pinned, metadata, overlay = false }: { overlay?: boolean; book: Extract<BookRef, { kind: 'server' }>; pinned: boolean; metadata: { title: string | null; author: string | null } }) {
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
  function choose() {
    closeMenu(); setError(null);
    if (pinned) setConfirm(true); else void save(true);
  }
  const label = busy ? 'Updating offline copy…' : pinned ? 'Stop keeping on this device' : 'Keep on this device';
  return <>{overlay ? <>
    {pinned && <span className={styles.keptBadge} role="img" aria-label="Kept on this device" title="Kept on this device"><Icon name="kept" size={16} /></span>}
    <details ref={menu} className={styles.bookOptions} name="offline-book-options" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } }}>
      <summary aria-label={`Options for ${metadata.title ?? 'Untitled'}`} title="Book options"><Icon name="more" size={20} /></summary>
      <div><button onClick={choose} disabled={busy || !reading.ready}>{label}</button></div>
    </details></> : <Button disabled={busy || !reading.ready} onClick={choose}>{label}</Button>}
    {!confirm && <ErrorNotice error={error} />}
    {confirm && <Dialog title="Stop keeping this book?" onClose={() => { if (!busy) setConfirm(false); }} footer={<>
      <Button disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button>
      <Button tone="primary" disabled={busy} onClick={() => void save(false)}>Stop keeping</Button>
    </>}><p>Its offline copy may be cleared. Your reading progress is kept.</p><ErrorNotice error={error} /></Dialog>}
  </>;
}
