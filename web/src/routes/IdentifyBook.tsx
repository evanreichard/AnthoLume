import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../Controls';
import { Icon } from '../Icon';
import type { components } from '../api/schema.gen';
import type { BookRef } from '../reading';
import { session } from '../session';
import { LoadingStatus, Skeleton } from '../Skeleton';
import { Dialog, ErrorNotice } from '../ui';
import styles from '../App.module.css';
import { bookMetadataDraft, encodeBookCover } from './bookMetadataDraft';

type Match = components['schemas']['MetadataMatch'];
type Draft = ReturnType<typeof bookMetadataDraft>;
type Field = keyof Draft | 'cover';
const labels: Record<keyof Draft, string> = { title: 'Title', author: 'Author', description: 'Synopsis', isbn10: 'ISBN-10', isbn13: 'ISBN-13' };
const coverURL = (id: number) => `/api/v1/metadata/covers/${id}`;

function availableFields(match: Match) {
  return (Object.keys(labels) as (keyof Draft)[]).filter(key => {
    const value = match[key];
    if (!value?.trim()) return false;
    if (key === 'isbn10') return /^[0-9]{9}[0-9X]$/.test(value);
    if (key === 'isbn13') return /^\d{13}$/.test(value);
    return true;
  });
}

function ResultCover({ id }: { id?: number }) {
  const [missing, setMissing] = useState(false);
  return <span className={styles.metadataResultCover} aria-hidden="true">
    {id && !missing ? <img src={coverURL(id)} alt="" loading="lazy" onError={() => setMissing(true)} /> : <Icon name="book" size={16} />}
  </span>;
}

export function IdentifyBook({ document, refId, onClose, onSaved }: {
  document: components['schemas']['Document']; refId: Extract<BookRef, { kind: 'server' }>; onClose(): void; onSaved(): void;
}) {
  const formId = useId();
  const original = bookMetadataDraft(document);
  const [query, setQuery] = useState(() => (original.isbn13 || original.isbn10 || [original.title, original.author].filter(Boolean).join(' ')).slice(0, 240));
  const [isbn, setISBN] = useState<string>();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [selected, setSelected] = useState<Field[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [cover, setCover] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [busy, setBusy] = useState<'search' | 'preview' | 'apply' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null);
  const previewLoading = busy === 'preview';
  const showPreview = previewLoading || !!match;
  const loadingSection = useRef<HTMLElement>(null);
  const heading = useRef<HTMLFieldSetElement>(null);
  const resultButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnTo = useRef<string | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const target = previewLoading ? loadingSection.current : match ? heading.current : returnTo.current ? resultButtons.current.get(returnTo.current) : null;
    target?.focus();
  }, [match, previewLoading]);

  async function run(operation: NonNullable<typeof busy>, action: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(operation); setError(null);
    try { await action(controller.signal); }
    catch (err) { if (!controller.signal.aborted) setError(err instanceof Error && 'status' in err && err.status === 503 ? new Error('Metadata lookup is unavailable. Try again in a moment.') : err); }
    finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setBusy(null);
      }
    }
  }

  function preview(result: Match) {
    returnTo.current = result.id;
    void run('preview', async signal => {
      const detail = await session.api.previewMetadataMatch(refId.account, { work_id: result.id, edition_id: result.edition_id, isbn }, signal);
      if (signal.aborted) return;
      const proposed = { ...detail, author: result.author, year: result.year };
      setExpanded(false);
      setCover('loading');
      setSelected(availableFields(proposed).filter(key => !original[key].trim()));
      setMatch(proposed);
    });
  }
  function choose(field: Field, checked: boolean) {
    setSelected(fields => checked ? fields.includes(field) ? fields : [...fields, field] : fields.filter(key => key !== field));
  }
  function toggle(field: Field) {
    setSelected(fields => fields.includes(field) ? fields.filter(key => key !== field) : [...fields, field]);
  }
  function apply() {
    if (!match || !selected.length || !validTitle || awaitingDefaultCover) return;
    void run('apply', async signal => {
      const next = bookMetadataDraft(document);
      for (const field of selected) if (field !== 'cover') next[field] = match[field] ?? '';
      let cover_base64: string | undefined;
      if (selected.includes('cover') && match.cover_id && cover === 'ready') {
        const response = await session.api.metadataCover(refId.account, match.cover_id, signal);
        if (!response.ok || response.headers.get('Content-Type') !== 'image/jpeg') throw new Error('This cover is unavailable. Try again or deselect “Edition Cover”.');
        const image = await response.blob();
        if (image.size > 2 * 1024 * 1024) throw new Error('This cover is larger than 2 MiB. Deselect “Edition Cover” to apply the other fields.');
        cover_base64 = await encodeBookCover(image);
      }
      if (signal.aborted) return;
      await session.api.editDocument(refId.account, refId.documentId, { ...next, title: next.title.trim(), ...(cover_base64 ? { cover_base64 } : {}) }, signal);
      if (!signal.aborted) onSaved();
    });
  }

  const fields = match ? availableFields(match) : [];
  const validTitle = (selected.includes('title') ? match?.title : original.title)?.trim();
  function indicator(field: Field) {
    return <span className={styles.matchIndicator} aria-hidden="true">{selected.includes(field) && <Icon name="check" size={12} />}</span>;
  }
  function fieldCard(field: keyof Draft) {
    const label = labels[field], value = match![field]!;
    const long = field === 'description' && value.length > 220;
    const valueID = `${formId}-${field}`;
    return <div key={field}>
      <button type="button" className={styles.matchCard} aria-label={label} aria-describedby={valueID} aria-pressed={selected.includes(field)} onClick={() => toggle(field)}>
        <span className={styles.matchFieldLabel}>{label}</span>{indicator(field)}
        <span id={valueID} className={styles.matchValue}>{long && !expanded ? `${value.slice(0, 220).trimEnd()}…` : value}</span>
      </button>
      {long && <button type="button" className={styles.matchTextAction} aria-controls={valueID} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Read Less' : 'Read More'}</button>}
    </div>;
  }
  const identityFields = fields.filter(field => field === 'title' || field === 'author');
  const showCover = !!match?.cover_id && cover !== 'missing';
  const awaitingDefaultCover = showCover && !document.cover_available && cover === 'loading';
  function backToResults() {
    if (previewLoading) {
      request.current?.abort();
      request.current = null;
      setBusy(null);
    }
    setMatch(null);
    setError(null);
  }
  const close = () => { if (busy !== 'apply') onClose(); };
  return <Dialog title="Identify Book" placement="mobile-sheet" layout={showPreview ? 'scroll-body' : 'content'} onClose={close}
    titleLeading={showPreview && <button type="button" className={styles.icon} aria-label="Back to Results" disabled={busy === 'apply'} onClick={backToResults}><Icon name="back" size={18} /></button>}
    footer={showPreview ? <>
    <Button type="submit" form={formId} tone="primary" disabled={!!busy || !selected.length || !validTitle || awaitingDefaultCover}>{busy === 'apply' ? 'Applying…' : match && selected.length ? `Apply ${selected.length} ${selected.length === 1 ? 'Change' : 'Changes'}` : 'Apply Changes'}</Button>
    <Button disabled={busy === 'apply'} onClick={onClose}>Cancel</Button>
  </> : undefined}>
    {previewLoading ? <section ref={loadingSection} tabIndex={-1} aria-label="Match preview" className={styles.matchLoading}>
      <LoadingStatus>Loading match preview…</LoadingStatus>
      <div className={styles.matchFields}>
        <div className={styles.matchIdentity} data-cover>
          <Skeleton block className={styles.matchLoadingCover} />
          <div className={styles.matchIdentityText}>
            <div className={styles.matchLoadingField}><Skeleton width="2rem" /><Skeleton width="72%" /></div>
            <div className={styles.matchLoadingField}><Skeleton width="3rem" /><Skeleton width="55%" /></div>
          </div>
        </div>
        <div className={styles.matchLoadingField}><Skeleton width="4rem" /><Skeleton width="95%" /><Skeleton width="68%" /></div>
        <div className={styles.matchLoadingField}><Skeleton width="3.25rem" /><Skeleton width="7rem" /></div>
      </div>
    </section> : !match ? <>
      <form className={styles.lookupSearch} onSubmit={event => {
        event.preventDefault(); setMatches(null);
        void run('search', async signal => {
          const normalized = query.toUpperCase().replace(/[\s-]/g, '');
          const results = await session.api.lookupMetadata(refId.account, query.trim(), signal);
          if (!signal.aborted) { setMatches(results); setISBN(/^(?:[0-9]{13}|[0-9]{9}[0-9X])$/.test(normalized) ? normalized : undefined); }
        });
      }}>
        <input aria-label="Title, author, or ISBN" placeholder="Title, author, or ISBN" type="search" value={query} onChange={event => setQuery(event.target.value)} minLength={2} maxLength={240} required />
        <button className={styles.icon} aria-label="Search" disabled={!!busy || query.trim().length < 2}>
          {busy === 'search' ? <span className={styles.lookupSpinner} aria-hidden="true" /> : <Icon name="search" size={19} />}
        </button>
      </form>
      <ErrorNotice error={error} />
      <span role="status" className={styles.srOnly}>{busy === 'search' ? 'Searching…' : ''}</span>
      {matches && !matches.length && <p role="status">No matches. Try a different title or ISBN.</p>}
      {!!matches?.length && <div className={styles.metadataResultsSection}><ul className={styles.metadataResults}>{matches.map(item => <li key={item.id}><button ref={button => { if (button) resultButtons.current.set(item.id, button); else resultButtons.current.delete(item.id); }} disabled={!!busy} onClick={() => preview(item)}>
        <ResultCover key={item.cover_id} id={item.cover_id} />
        <div className={styles.metadataResultText}><strong title={item.title}>{item.title}</strong><span>{[item.author, item.year].filter(Boolean).join(' · ')}</span></div>
      </button></li>)}</ul></div>}
    </> : <section aria-label="Match preview">
      {!match.edition_id && <p className={styles.lookupHint}>No edition verified. Search by ISBN to find a specific edition.</p>}
      {!match.description && <p className={styles.lookupHint}>No synopsis available from Open Library.</p>}
      {match.cover_id && cover === 'missing' && <p className={styles.lookupHint}>The edition cover is unavailable.</p>}
      <form id={formId} className={styles.form} onSubmit={event => { event.preventDefault(); apply(); }}>
        <fieldset ref={heading} tabIndex={-1} aria-label="Suggested metadata" className={styles.matchFields} disabled={busy === 'apply'}>
          <div className={styles.matchIdentity} data-cover={showCover || undefined}>
            {showCover && <button type="button" className={`${styles.matchCard} ${styles.matchCoverCard}`} aria-label="Edition Cover" aria-pressed={selected.includes('cover')} disabled={cover !== 'ready'} onClick={() => toggle('cover')}>
              {indicator('cover')}
              <img src={coverURL(match.cover_id!)} className={styles.metadataPreview} alt={`Cover for ${match.title}`} onLoad={() => { setCover('ready'); if (awaitingDefaultCover) choose('cover', true); }} onError={() => { setCover('missing'); choose('cover', false); }} />
            </button>}
            <div className={styles.matchIdentityText}>{identityFields.map(fieldCard)}</div>
          </div>
          {fields.filter(field => field !== 'title' && field !== 'author').map(fieldCard)}
          {match.edition_id && <p className={styles.matchEdition}>{[isbn ? 'ISBN match' : 'Suggested edition', match.publisher, match.published || match.year, match.edition_id].filter(Boolean).join(' · ')}</p>}
        </fieldset>
      </form>
      <ErrorNotice error={error} />
    </section>}
  </Dialog>;
}
