import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../Controls';
import type { components } from '../api/schema.gen';
import type { BookRef } from '../reading';
import { session } from '../session';
import { Cover } from '../BookPresentation';
import bookStyles from '../BookPresentation.module.css';
import { Dialog, ErrorNotice } from '../ui';
import type { LibraryBook } from '../library';
import styles from '../App.module.css';
import { bookMetadataDraft, encodeBookCover } from './bookMetadataDraft';

export function BookEditor({ book, refId, document, onClose, onSaved }: {
  book: LibraryBook; refId: Extract<BookRef, { kind: 'server' }>; document: components['schemas']['Document']; onClose(): void; onSaved(document: components['schemas']['Document'], cover?: Blob | null): void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState(() => bookMetadataDraft(document));
  const [cover, setCover] = useState<File | null>(null), [remove, setRemove] = useState(false), [preview, setPreview] = useState('');
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const url = cover ? URL.createObjectURL(cover) : '';
    setPreview(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [cover]);
  function setField(key: keyof typeof draft, value: string) { setDraft(old => ({ ...old, [key]: value })); }
  async function save() {
    if (request.current) return;
    const controller = request.current = new AbortController();
    const { signal } = controller;
    setBusy(true); setError(null);
    try {
      const cover_base64 = cover ? await encodeBookCover(cover) : undefined;
      if (signal.aborted) return;
      const updated = await session.api.editDocument(refId.account, refId.documentId, {
        ...draft, title: draft.title.trim(), ...(cover_base64 ? { cover_base64 } : remove ? { remove_cover: true } : {}),
      }, signal);
      if (!signal.aborted) await onSaved(updated, cover ?? (remove ? null : undefined));
    } catch (err) { if (!signal.aborted) setError(err); }
    finally { request.current = null; if (!signal.aborted) setBusy(false); }
  }
  return <Dialog title="Edit book" size="wide" onClose={() => { if (!busy) onClose(); }} footer={<>
    <Button size="slim" form={formId} type="submit" tone="primary" disabled={busy || !draft.title.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
    <Button size="slim" disabled={busy} onClick={onClose}>Cancel</Button>
  </>}>
    <form id={formId} className={styles.form} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className={bookStyles.editorCover}>
        {preview ? <img src={preview} alt="New cover preview" /> : !remove && document.cover_available ? <Cover book={book} /> : <p>No cover</p>}
        <div>
          <label>Cover image<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) { event.currentTarget.value = ''; setError(new Error('Choose a JPEG or PNG up to 2 MiB.')); return; }
            setError(null); setRemove(false); setCover(file);
          }} /></label>
          {(cover || remove) ? <Button size="slim" disabled={busy} onClick={() => { setCover(null); setRemove(false); }}>Keep Original Cover</Button> :
            document.cover_available && <Button size="slim" disabled={busy} onClick={() => setRemove(true)}>Remove Cover</Button>}
        </div>
      </div>
      <label>Title<input required maxLength={512} value={draft.title} onChange={event => setField('title', event.target.value)} /></label>
      <label>Author<input maxLength={512} value={draft.author} onChange={event => setField('author', event.target.value)} /></label>
      <div className={styles.editorISBN}>
        <label>ISBN-10<input pattern="[0-9]{9}[0-9X]" maxLength={10} value={draft.isbn10} onChange={event => setField('isbn10', event.target.value.toUpperCase())} /></label>
        <label>ISBN-13<input inputMode="numeric" pattern="[0-9]{13}" maxLength={13} value={draft.isbn13} onChange={event => setField('isbn13', event.target.value)} /></label>
      </div>
      <label>Synopsis<textarea className={styles.editorSynopsis} rows={5} maxLength={16000} value={draft.description} onChange={event => setField('description', event.target.value)} /></label>
      <ErrorNotice error={error} />
    </form>
  </Dialog>;
}
