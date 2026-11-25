import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { CandidatePicker, candidateProviders as providers } from '../CandidatePicker';
import { Button, JoinedAction, JoinedActions } from '../Controls';
import { Icon } from '../Icon';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type BookRef } from '../reading';
import { session } from '../session';
import { LoadingStatus, Skeleton } from '../Skeleton';
import { Dialog } from '../ui';
import styles from '../App.module.css';
import identify from './IdentifyBook.module.css';
import { bookMetadataDraft, encodeBookCover } from './bookMetadataDraft';

type Document = components['schemas']['Document'];
type Match = components['schemas']['MetadataMatch'];
type MatchReference = components['schemas']['MetadataMatchReference'];
type Provider = Match['provider'];
type Draft = ReturnType<typeof bookMetadataDraft>;
type Field = keyof Draft | 'cover';
type Operation = 'suggestions' | 'search' | 'preview' | 'apply';
type Candidate = Match & { work_id: string; url: string; reason?: string; isbn?: string };
type Review = { candidate: Candidate; match: Match; reference: MatchReference; selected: Field[]; expanded: boolean; cover?: Promise<Blob | null> };

const labels: Record<keyof Draft, string> = { title: 'Title', author: 'Author', description: 'Synopsis', isbn10: 'ISBN-10', isbn13: 'ISBN-13' };

function normalizedISBN(query: string): string | undefined {
  const isbn = query.toUpperCase().replace(/[\s-]/g, '');
  return /^(?:[0-9]{13}|[0-9]{9}[0-9X])$/.test(isbn) ? isbn : undefined;
}

function candidateFor(result: Match, isbn?: string): Candidate {
  const encoded = encodeURIComponent(result.id);
  return {
    ...result, work_id: result.id, isbn,
    url: result.provider === 'hardcover' ? `https://hardcover.app/id/book/${encoded}` : `https://openlibrary.org/works/${encoded}`,
    reason: [result.publisher, result.published || result.year].filter(Boolean).join(' · ') || undefined,
  };
}

function fieldsFor(match: Match): (keyof Draft)[] {
  return (Object.keys(labels) as (keyof Draft)[]).filter(key => {
    const value = match[key];
    if (!value?.trim()) return false;
    if (key === 'isbn10') return /^[0-9]{9}[0-9X]$/.test(value);
    if (key === 'isbn13') return /^\d{13}$/.test(value);
    return true;
  });
}

function useCoverImage(source: Review['cover']) {
  const [loaded, setLoaded] = useState<{ source: NonNullable<Review['cover']>; image: { blob: Blob; url: string } | null }>();
  useEffect(() => {
    if (!source) return;
    let active = true;
    let url: string | undefined;
    void source.then(blob => {
      if (!active) return;
      if (blob) url = URL.createObjectURL(blob);
      setLoaded({ source, image: blob && url ? { blob, url } : null });
    });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [source]);
  return loaded?.source === source ? loaded?.image : undefined;
}

function failureMessage(error: unknown, operation: Operation) {
  if (error instanceof ReadingHTTPError && error.problem.code === 'metadata_provider_changed') {
    return 'The configured metadata provider changed. Close and reopen to search the new provider.';
  }
  if (operation === 'apply') return 'Could not save the metadata changes.';
  if (operation === 'preview') return 'Could not load this match’s metadata.';
  return 'Metadata lookup is unavailable. Try again in a moment.';
}

export function IdentifyBook({ document, refId, onClose, onSaved }: {
  document: Document; refId: Extract<BookRef, { kind: 'server' }>; onClose(): void; onSaved(document: Document, cover?: Blob): void;
}) {
  const formId = useId();
  const original = bookMetadataDraft(document);
  const [provider, setProvider] = useState<Provider>();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Candidate[]>([]);
  const [manual, setManual] = useState<Candidate[] | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const suggestedReview = useRef<Review | null>(null);
  const [busy, setBusy] = useState<Operation | null>('suggestions');
  const [failure, setFailure] = useState<{ operation: Operation; message: string; retry: () => void } | null>(null);
  const request = useRef<AbortController | null>(null);
  const coverLifetime = useRef<AbortController | null>(null);
  const covers = useRef(new Map<string, Promise<Blob | null>>());
  const searchInput = useRef<HTMLInputElement>(null);
  const image = useCoverImage(review?.cover);
  const [coverStatus, setCoverStatus] = useState<{ url: string; ready: boolean }>();
  const readyCover = image && coverStatus?.url === image.url && coverStatus.ready ? image : undefined;
  const showCover = !!image && (coverStatus?.url !== image.url || coverStatus.ready);

  async function run<T>(operation: Operation, action: (signal: AbortSignal) => Promise<T>, onSuccess?: (result: T) => void) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(operation); setFailure(null);
    let result: T;
    try { result = await action(controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) setFailure({ operation, message: failureMessage(error, operation), retry: () => void run(operation, action, onSuccess) });
      return;
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
    if (!controller.signal.aborted) onSuccess?.(result);
  }

  async function lookup(q: string, signal: AbortSignal) {
    const isbn = normalizedISBN(q);
    const results = await session.api.lookupMetadata(refId.account, isbn ?? q, signal);
    signal.throwIfAborted();
    if (results[0]) setProvider(results[0].provider);
    return results.map(result => candidateFor(result, isbn));
  }

  function downloadCover(match: Match) {
    const lifetime = coverLifetime.current;
    if (!match.cover_id || !lifetime || lifetime.signal.aborted) return;
    const key = `${match.provider}:${match.cover_id}`;
    const existing = covers.current.get(key);
    if (existing) return existing;
    const load = session.api.metadataCover(refId.account, match.provider, match.cover_id, AbortSignal.any([lifetime.signal, AbortSignal.timeout(12_000)])).catch(() => null);
    covers.current.set(key, load);
    void load.then(blob => { if (!blob && covers.current.get(key) === load) covers.current.delete(key); });
    return load;
  }

  async function loadPreview(candidate: Candidate, signal: AbortSignal) {
    const { provider, work_id, edition_id, isbn } = candidate;
    const detail = await session.api.previewMetadataMatch(refId.account, { provider, work_id, edition_id, isbn }, signal);
    signal.throwIfAborted();
    if (detail.provider !== provider || detail.id !== work_id) throw new Error('Unexpected metadata record');
    const match = { ...detail, author: detail.author || candidate.author, year: detail.year ?? candidate.year };
    const verifiedISBN = isbn && (match.isbn10 === isbn || match.isbn13 === isbn) ? isbn : undefined;
    const reference = { provider, work_id, ...(match.edition_id ? { edition_id: match.edition_id, isbn: verifiedISBN } : {}) };
    const cover = downloadCover(match);
    const selected: Field[] = fieldsFor(match).filter(key => !original[key].trim());
    if (cover && !document.cover_available) selected.push('cover');
    setReview({ candidate, match, reference, selected, expanded: false, cover });
  }

  const loadSuggestions = useEffectEvent(() => {
    void run('suggestions', async signal => {
      const isbn = normalizedISBN(original.isbn13) ?? normalizedISBN(original.isbn10);
      const titleAuthor = `${original.title} ${original.author}`.trim().slice(0, 240);
      let results = isbn ? await lookup(isbn, signal) : [];
      if (!results.length && titleAuthor.length >= 2) results = await lookup(titleAuthor, signal);
      signal.throwIfAborted();
      const preferred = results.find(result => document.matches?.some(link => link.provider === result.provider && link.work_id === result.work_id));
      setSuggestions(results);
      return preferred ?? results[0];
    }, first => { if (first) void run('preview', signal => loadPreview(first, signal)); });
  });

  useEffect(() => {
    const lifetime = new AbortController();
    coverLifetime.current = lifetime;
    void loadSuggestions();
    return () => {
      request.current?.abort(); request.current = null;
      lifetime.abort(); coverLifetime.current = null;
      covers.current.clear();
    };
  }, []);

  function search() {
    const text = query.trim();
    if (text.length < 2 || request.current) return;
    if (manual === null) {
      suggestedReview.current = review;
      setManual([]);
    }
    void run('search', async signal => { setManual(await lookup(text, signal)); });
  }

  function restoreSuggestions() {
    setReview(suggestedReview.current);
    suggestedReview.current = null;
    setManual(null); setQuery(''); setFailure(null);
    searchInput.current?.focus({ preventScroll: true });
  }

  function choose(candidate: Candidate) {
    if (candidate === review?.candidate) return;
    void run('preview', signal => loadPreview(candidate, signal));
  }

  function toggle(field: Field) {
    setReview(value => value && { ...value, selected: value.selected.includes(field) ? value.selected.filter(key => key !== field) : [...value.selected, field] });
  }

  const match = review?.match;
  const knownLink = match && document.matches?.find(link => link.provider === match.provider);
  const replacing = !!knownLink && knownLink.work_id !== match?.id;
  const linked = !!knownLink && !replacing;
  const selected = review?.selected.filter(field => field !== 'cover' || readyCover) ?? [];
  const waitingForCover = !!review?.selected.includes('cover') && image !== null && (image ? coverStatus?.url !== image.url : !!review.cover);
  const canApply = !!review && !waitingForCover && (!linked || selected.length > 0);
  const linkLabel = replacing ? 'Replace Link' : 'Link Book';
  const count = `${selected.length} ${selected.length === 1 ? 'Change' : 'Changes'}`;
  const applyLabel = selected.length ? `${linked ? '' : `${replacing ? 'Replace Link' : 'Link'} and `}Apply ${count}` : linked ? 'Apply Changes' : linkLabel;

  function apply() {
    if (request.current || !review || !canApply) return;
    if (replacing && !window.confirm(`Replace the saved ${providers[review.match.provider].name} link with this match?`)) return;
    void run('apply', async signal => {
      const changes: Partial<Draft> = {};
      for (const field of selected) if (field !== 'cover') changes[field] = review.match[field]?.trim();
      const cover = selected.includes('cover') ? readyCover?.blob : undefined;
      const cover_base64 = cover && await encodeBookCover(cover);
      signal.throwIfAborted();
      const updated = await session.api.editDocument(refId.account, refId.documentId, { ...changes, cover_base64, match: review.reference }, signal);
      if (!signal.aborted) await onSaved(updated, cover);
    });
  }

  function indicator(field: Field) {
    return <span className={styles.matchIndicator} aria-hidden="true">{selected.includes(field) && <Icon name="check" size={12} />}</span>;
  }

  function fieldCard(field: keyof Draft) {
    const value = match?.[field];
    if (!value) return null;
    const label = labels[field];
    const long = field === 'description' && value.length > 220;
    const valueID = `${formId}-${field}`;
    return <div key={field}>
      <button type="button" className={styles.matchCard} aria-label={label} aria-describedby={valueID} aria-pressed={selected.includes(field)} onClick={() => toggle(field)}>
        <span className={styles.matchFieldLabel}>{label}</span>{indicator(field)}
        <span id={valueID} className={styles.matchValue}>{long && !review?.expanded ? `${value.slice(0, 220).trimEnd()}…` : value}</span>
      </button>
      {long && <button type="button" className={styles.matchTextAction} aria-controls={valueID} aria-expanded={!!review?.expanded}
        onClick={() => setReview(current => current && { ...current, expanded: !current.expanded })}>{review?.expanded ? 'Read Less' : 'Read More'}</button>}
    </div>;
  }

  const searchTools = <div className={identify.searchTools}>
    <form role="search" className={styles.lookupSearch} onSubmit={event => { event.preventDefault(); search(); }}>
      <input ref={searchInput} aria-label="Title, Author, or ISBN" placeholder={provider ? `Search ${providers[provider].name}…` : 'Title, author, or ISBN'} type="search"
        enterKeyHint="search" value={query} onChange={event => setQuery(event.currentTarget.value)} minLength={2} maxLength={240} required />
      <button type="submit" className={styles.icon} aria-label="Search" disabled={!!busy || query.trim().length < 2}>
        {busy === 'search' ? <span className={styles.lookupSpinner} aria-hidden="true" /> : <Icon name="search" size={16} />}
      </button>
    </form>
    {manual !== null && <button type="button" className={identify.suggestions} disabled={busy === 'search'} onClick={restoreSuggestions}>
      <Icon name="back" size={14} />Suggested Matches
    </button>}
    {failure?.operation === 'search' && <div className={identify.failure}><p role="alert">{failure.message}</p><Button size="slim" onClick={search} disabled={query.trim().length < 2}>Retry Search</Button></div>}
  </div>;
  const toolbar = <div className={identify.toolbar}>
    <CandidatePicker label="Choose Match" groupLabel="Book Matches" selected={review?.candidate} candidates={busy === 'search' ? [] : manual ?? suggestions}
      disabled={busy === 'suggestions' || busy === 'preview' || busy === 'apply'} placeholder={busy === 'suggestions' ? 'Finding Matches…' : busy === 'preview' ? 'Loading Match…' : 'Choose Match'}
      toolbar={searchTools} emptyMessage={busy === 'search' ? 'Searching…' : failure?.operation === 'search' ? '' : 'No matches. Try another title, author, or ISBN.'} onChoose={choose} provider={provider} />
    <JoinedActions label="Metadata Provider"><JoinedAction disabled aria-label={provider ? `${providers[provider].name} (Configured Provider)` : 'Configured Provider'}
      title={provider ? `Configured Provider: ${providers[provider].name}` : 'The Server Selects the Provider'}>
      {provider ? <img alt="" src={providers[provider].icon} width={17} height={17} /> : <Icon name="book" size={17} />}<Icon name="down" size={12} />
    </JoinedAction></JoinedActions>
  </div>;
  const fields = match ? fieldsFor(match) : [];
  const close = () => { if (busy !== 'apply') onClose(); };
  const previewFailure = failure?.operation === 'search' ? null : failure;

  return <Dialog title="Review Metadata" placement="mobile-sheet" layout="scroll-body" toolbar={toolbar} onClose={close} footer={<>
    <Button type="submit" form={formId} tone="primary" disabled={!!busy || !!previewFailure || !canApply}>{busy === 'apply' ? 'Saving…' : applyLabel}</Button>
    <Button disabled={busy === 'apply'} onClick={close}>Cancel</Button>
  </>}>
    {busy === 'suggestions' || busy === 'preview' ? <section className={styles.matchLoading} aria-label="Match Preview">
      <LoadingStatus>{busy === 'preview' ? 'Loading match preview…' : 'Finding suggested matches…'}</LoadingStatus>
      <div className={styles.matchFields}>
        <div className={styles.matchIdentity} data-cover>
          <Skeleton block className={styles.matchLoadingCover} />
          <div className={styles.matchIdentityText}>
            <div className={styles.matchLoadingField}><Skeleton width="2rem" /><Skeleton width="72%" /></div>
            <div className={styles.matchLoadingField}><Skeleton width="3rem" /><Skeleton width="55%" /></div>
          </div>
        </div>
        <div className={styles.matchLoadingField}><Skeleton width="4rem" /><Skeleton width="95%" /><Skeleton width="68%" /></div>
      </div>
    </section> : previewFailure ? <div className={identify.centeredState}><div className={identify.failure}>
      <p role="alert">{previewFailure.message}</p>
      <Button size="slim" onClick={previewFailure.operation === 'apply' ? apply : previewFailure.retry}>Retry</Button>
      {review && <Button size="slim" onClick={() => setFailure(null)}>Back to Preview</Button>}
    </div></div> : match && review ? <section aria-label="Match Preview">
      <form id={formId} onSubmit={event => { event.preventDefault(); apply(); }}>
        <fieldset aria-label="Suggested Metadata" className={styles.matchFields} disabled={busy === 'apply'}>
          <div className={styles.matchIdentity} data-cover={showCover || undefined}>
            {showCover && image && <button type="button" className={`${styles.matchCard} ${styles.matchCoverCard}`} aria-label="Cover" aria-pressed={selected.includes('cover')} disabled={!readyCover} onClick={() => toggle('cover')}>
              {indicator('cover')}
              <img key={image.url} src={image.url} className={styles.metadataPreview} alt={`Cover for ${match.title}`} onLoad={() => setCoverStatus({ url: image.url, ready: true })} onError={() => setCoverStatus({ url: image.url, ready: false })} />
            </button>}
            <div className={styles.matchIdentityText}>{fields.filter(field => field === 'title' || field === 'author').map(fieldCard)}</div>
          </div>
          {fields.includes('description') ? fieldCard('description') : <p className={styles.lookupHint}>No synopsis available from this source.</p>}
          {fields.some(field => field === 'isbn10' || field === 'isbn13') && <div className={identify.isbn}>{fields.filter(field => field === 'isbn10' || field === 'isbn13').map(fieldCard)}</div>}
          {match.edition_id && <p className={styles.matchEdition}>{[review.reference.isbn ? 'ISBN match' : 'Suggested edition', match.publisher, match.published || match.year, match.edition_id].filter(Boolean).join(' · ')}</p>}
        </fieldset>
      </form>
    </section> : <div className={identify.centeredState}><p className={styles.lookupHint}>Choose a suggested match or search by title, author, or ISBN.</p></div>}
  </Dialog>;
}
