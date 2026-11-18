import { Button } from '../Controls';
import { useEffect, useId, useRef, useState } from 'react';
import type { components } from '../api/schema.gen';
import type { BookRef } from '../reading';
import { session } from '../session';
import { Cover, Dialog, ErrorNotice } from '../ui';
import type { LibraryBook } from '../library';
import styles from '../App.module.css';
import { Icon } from '../Icon';

type Document = components['schemas']['Document'];
type Match = components['schemas']['MetadataMatch'];
type ServerBook = Extract<BookRef, { kind: 'server' }>;

const metadataCoverURL = (id: number) => `/api/v1/metadata/covers/${id}`;

function MatchCover({ id, className, alt, onLoad }: { id: number; className: string; alt: string; onLoad?: () => void }) {
  const [missing, setMissing] = useState(false);
  return missing ? null : <img src={metadataCoverURL(id)} className={className} alt={alt} onLoad={onLoad} onError={() => setMissing(true)} />;
}

export function BookEditor({ book, refId, document, onClose, onSaved }: {
  book: LibraryBook; refId: ServerBook; document: Document; onClose(): void; onSaved(): void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState({ title: document.title ?? '', author: document.author ?? '', description: document.description ?? '', isbn10: document.isbn10 ?? '', isbn13: document.isbn13 ?? '' });
  const [cover, setCover] = useState<File | null>(null), [remove, setRemove] = useState(false), [preview, setPreview] = useState('');
  const [lookup, setLookup] = useState(false), [selected, setSelected] = useState<Match | null>(null);
  const [q, setQ] = useState((draft.isbn13 || draft.isbn10 || [draft.title, draft.author].filter(Boolean).join(' ')).slice(0, 240));
  const [loadedCover, setLoadedCover] = useState<number | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const lookupHeading = useRef<HTMLDivElement>(null);
  const matchHeading = useRef<HTMLHeadingElement>(null);
  const lookupButton = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const target = lookup ? selected ? matchHeading.current : lookupHeading.current : returning.current ? lookupButton.current : null;
    if (!target) return;
    returning.current = lookup;
    target.closest('dialog')?.scrollTo(0, 0);
    target.focus({ preventScroll: true });
  }, [lookup, selected]);
  useEffect(() => {
    const url = cover ? URL.createObjectURL(cover) : '';
    setPreview(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [cover]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null);
    try { await action(controller.signal); }
    catch (err) { if (!controller.signal.aborted) setError(err); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function useMatch(match: Match) {
    setDraft(old => ({ ...old, title: match.title, author: match.author || old.author, isbn10: match.isbn10 ?? old.isbn10, isbn13: match.isbn13 ?? old.isbn13 }));
    closeLookup();
  }
  function closeLookup() {
    setSelected(null); setLookup(false); setError(null);
  }
  function setField(key: keyof typeof draft, value: string) { setDraft(old => ({ ...old, [key]: value })); }

  return <Dialog
    title={lookup ? 'Identify Book' : 'Edit book'}
    size={lookup ? 'default' : 'wide'}
    placement={lookup ? 'mobile-sheet' : 'center'}
    onClose={() => { if (!busy) { if (lookup) closeLookup(); else onClose(); } }}
    footer={!lookup ? <>
      <Button size="slim" form={formId} type="submit" tone="primary" disabled={busy || !draft.title.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
      <Button size="slim" ref={lookupButton} disabled={busy} onClick={() => { setError(null); setLookup(true); }}>Identify</Button>
      <Button size="slim" disabled={busy} onClick={onClose}>Cancel</Button>
    </> : null}
  >
    {lookup ? <>
      {!selected && <div ref={lookupHeading} tabIndex={-1} className={styles.lookupIntro}>
        <form className={styles.lookupSearch} onSubmit={e => { e.preventDefault(); setMatches(null); void run(async signal => {
        try { setMatches(await session.api.lookupMetadata(refId.account, q.trim(), signal)); }
        catch (err) { if (err instanceof Error && 'status' in err && err.status === 503) throw new Error('Open Library is unavailable. Try again or edit the book manually.'); throw err; }
        }); }}>
          <input aria-label="Title, author, or ISBN" placeholder="Title, author, or ISBN" type="search" value={q} onChange={e => setQ(e.target.value)} minLength={2} maxLength={240} required />
          <button className={styles.icon} aria-label="Search Open Library" disabled={busy || q.trim().length < 2}><Icon name="search" size={19} /></button>
        </form>
        <p className={styles.lookupHint}>Search Open Library by title, author, or ISBN.</p>
      </div>}
      <ErrorNotice error={error} />
      {busy && <p role="status">{selected ? 'Loading cover…' : 'Searching Open Library…'}</p>}
      {matches && !matches.length && <p role="status">No matches. Try a different title or ISBN.</p>}
      {selected ? <section aria-label="Match preview">
        <button className={styles.lookupBack} disabled={busy} onClick={() => { setSelected(null); setLoadedCover(null); setError(null); }}><Icon name="back" size={16} />Back to results</button>
        <div className={styles.matchPreview}>
        {selected.cover_id && <MatchCover key={selected.cover_id} id={selected.cover_id} className={styles.metadataPreview} alt={`Cover for ${selected.title}`} onLoad={() => setLoadedCover(selected.cover_id!)} />}
          <div>
            <h3 ref={matchHeading} tabIndex={-1}>{selected.title}</h3>
            <p>{[selected.author, selected.year].filter(Boolean).join(' · ')}</p>
            {(selected.isbn13 || selected.isbn10) && <p>ISBN: {selected.isbn13 || selected.isbn10}</p>}
          </div>
        </div>
        {selected.description && <p className={styles.lookupHint}>Excerpt: {selected.description}</p>}
        <div className={styles.actions}>
          <Button tone="primary" disabled={busy} onClick={() => useMatch(selected)}>Use this match</Button>
          {selected.cover_id && loadedCover === selected.cover_id && <Button disabled={busy} onClick={() => void run(async signal => {
            const response = await fetch(metadataCoverURL(selected.cover_id!), { signal, cache: 'no-store' });
            if (!response.ok || response.headers.get('Content-Type') !== 'image/jpeg') throw new Error('This cover is unavailable. You can still choose a file.');
            const image = await response.blob();
            if (signal.aborted) return;
            setCover(new File([image], 'open-library.jpg', { type: 'image/jpeg' }));
            setRemove(false); closeLookup();
          })}>Use this cover</Button>}
        </div>
      </section> : matches?.length ? <ul className={styles.metadataResults}>{matches.map(match => <li key={match.id}><button onClick={() => { setLoadedCover(null); setSelected(match); }}>
        {match.cover_id && <MatchCover id={match.cover_id} className={styles.metadataThumb} alt="" />}
        <div><strong>{match.title}</strong><span>{[match.author, match.year].filter(Boolean).join(' · ')}</span></div>
      </button></li>)}</ul> : null}
      {!selected && <button className={styles.lookupBack} disabled={busy} onClick={closeLookup}><Icon name="back" size={16} />Back to editor</button>}
    </> : <form id={formId} className={styles.form} onSubmit={e => {
      e.preventDefault();
      void run(async signal => {
        const bytes = cover ? new Uint8Array(await cover.arrayBuffer()) : null;
        const chunks: string[] = [];
        if (bytes) for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        await session.api.editDocument(refId.account, refId.documentId, {
          ...draft, title: draft.title.trim(), ...(bytes ? { cover_base64: btoa(chunks.join('')) } : remove ? { remove_cover: true } : {}),
        }, signal);
        if (!signal.aborted) onSaved();
      });
    }}>
      <div className={styles.editorCover}>
        {preview ? <img src={preview} alt="New cover preview" /> : !remove && document.cover_available ? <Cover book={book} /> : <p>No cover</p>}
        <div>
          <label>Cover image<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e => {
            const file = e.currentTarget.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) { e.currentTarget.value = ''; setError(new Error('Choose a JPEG or PNG up to 2 MiB.')); return; }
            setError(null); setRemove(false); setCover(file);
          }} /></label>
          {(cover || remove) ? <Button size="slim" disabled={busy} onClick={() => { setCover(null); setRemove(false); }}>Keep original cover</Button> :
            document.cover_available && <Button size="slim" disabled={busy} onClick={() => setRemove(true)}>Remove cover</Button>}
        </div>
      </div>
      <label>Title<input required maxLength={512} value={draft.title} onChange={e => setField('title', e.target.value)} /></label>
      <label>Author<input maxLength={512} value={draft.author} onChange={e => setField('author', e.target.value)} /></label>
      <div className={styles.editorISBN}>
        <label>ISBN-10<input pattern="[0-9]{9}[0-9X]" maxLength={10} value={draft.isbn10} onChange={e => setField('isbn10', e.target.value.toUpperCase())} /></label>
        <label>ISBN-13<input inputMode="numeric" pattern="[0-9]{13}" maxLength={13} value={draft.isbn13} onChange={e => setField('isbn13', e.target.value)} /></label>
      </div>
      <label>Synopsis<textarea className={styles.editorSynopsis} rows={5} maxLength={16000} value={draft.description} onChange={e => setField('description', e.target.value)} /></label>
      <ErrorNotice error={error} />
    </form>}
  </Dialog>;
}
