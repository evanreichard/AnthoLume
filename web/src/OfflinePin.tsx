import { useEffect, useRef, useState } from 'react';
import { useReading, type BookRef } from './reading';
import { Button } from './Controls';
import { ErrorNotice } from './ui';

import { Icon } from './Icon';
import styles from './OfflineReading.module.css';

export function OfflinePin({ book, pinned, metadata, overlay = false }: { overlay?: boolean; book: Extract<BookRef, { kind: 'server' }>; pinned: boolean; metadata: { title: string | null; author: string | null } }) {
  const reading = useReading();
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function toggle() {
    if (controller.current) return;
    const operation = controller.current = new AbortController();
    setBusy(true); setError(null);
    try { await reading.setPinned(book, !pinned, operation.signal, metadata); }
    catch (failure) { if (!operation.signal.aborted) setError(failure); }
    finally {
      if (!operation.signal.aborted) setBusy(false);
      operation.abort(); controller.current = null;
    }
  }
  if (overlay) return <><button type="button" className={styles.bookmark} aria-busy={busy} disabled={busy || !reading.ready} aria-pressed={pinned} title={pinned ? 'Unpin offline copy' : 'Keep on this device'} aria-label={`${pinned ? 'Unpin offline copy' : 'Keep on this device'}: ${metadata.title ?? 'Untitled'}`} onClick={() => void toggle()}><Icon name="bookmark" size={18} /></button><ErrorNotice error={error} /></>;
  return <><Button disabled={busy || !reading.ready} aria-pressed={pinned} onClick={() => void toggle()}>{busy ? 'Updating offline copy…' : pinned ? 'Unpin offline copy' : 'Keep on this device'}</Button><ErrorNotice error={error} /></>;
}
