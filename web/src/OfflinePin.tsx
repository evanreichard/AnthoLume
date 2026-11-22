import { useEffect, useRef, useState } from 'react';
import { useReading, type BookRef } from './reading';
import { Button } from './Controls';
import { ErrorNotice } from './ui';

export function OfflinePin({ book, pinned, metadata }: { book: Extract<BookRef, { kind: 'server' }>; pinned: boolean; metadata: { title: string | null; author: string | null } }) {
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
  return <><Button disabled={busy || !reading.ready} aria-pressed={pinned} onClick={() => void toggle()}>{busy ? 'Updating offline copy…' : pinned ? 'Unpin offline copy' : 'Keep on this device'}</Button><ErrorNotice error={error} /></>;
}
