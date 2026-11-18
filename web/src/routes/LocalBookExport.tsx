import { useState } from 'react';
import { Link } from 'react-router';
import { useReading, type BookRef } from '../reading';
import { ErrorNotice, PageHeader } from '../ui';
import styles from '../App.module.css';

export function LocalBookExport() {
  const reading = useReading();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const books = reading.books.flatMap(book => book.ref.kind === 'local' ? [{ ...book, ref: book.ref }] : []);
  async function save(ref: Extract<BookRef, { kind: 'local' }>, title: string) {
    setBusy(ref.localId); setError(null);
    try {
      const blob = await reading.exportLocal(ref);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 160)}.epub`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) { setError(failure); }
    finally { setBusy(null); }
  }
  return <main className={styles.main}>
    <PageHeader title="Export local books" actions={<Link to="/library">Library</Link>} />
    <p>Local-only reading has been retired. Save the original EPUBs from this browser, then add them to the shared Library if you want to read them here.</p>
    <ErrorNotice error={error || reading.error} />
    {reading.ready ? books.length ? <ul>{books.map(({ ref, title }) => <li key={ref.localId}>
      <button disabled={busy !== null} onClick={() => void save(ref, title || 'Untitled')}>Export {title || 'Untitled'}</button>
    </li>)}</ul> : <p>No local books found in this browser.</p> : <p role="status">Checking this browser for local books…</p>}
  </main>;
}
