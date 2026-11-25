import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MatcherBook, MatcherCandidate, MatcherProvider } from '../api/bookMatcher';
import { session } from '../session';
import { BookInfo, CandidatePicker, ProviderPill, candidateProviders as providers } from '../CandidatePicker';
import { Button, Card } from '../Controls';
import { Icon, type IconName } from '../Icon';
import { ReadingHTTPError, type Account } from '../reading';
import { SkeletonRows } from '../Skeleton';
import { useSnackbar } from '../Snackbar';
import { adminMetadataOptions } from './AdminMetadata';
import app from '../App.module.css';
import styles from './AdminBookMatcher.module.css';

const pageSize = 10;
const cacheKey = (provider: MatcherProvider, book: MatcherBook) => JSON.stringify([provider, book.id, book.title, book.author, book.isbn]);
type Match = NonNullable<MatcherBook['match']>;
type Lookup = { kind: 'searching' | 'error' } | { kind: 'ready'; candidates: MatcherCandidate[] };
type WriteError = { message: string; retry: () => void };
type CandidateCache = Map<string, MatcherCandidate[]>;

type PageControls = {
  account: Account; provider: MatcherProvider; page: number; cache: CandidateCache;
  onPageChange: (next: number) => void; onRefresh: () => void;
};

export function AdminBookMatcher({ account }: { account: Account }) {
  const config = useQuery(adminMetadataOptions(account));
  const [override, setProvider] = useState<MatcherProvider>();
  const provider = config.data && (override === 'hardcover' && !config.data.hardcover_available ? config.data.effective : override ?? config.data.effective);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const cache = useRef<CandidateCache>(new Map());
  const heading = useRef<HTMLHeadingElement>(null);

  function turn(next: number) {
    setPage(next);
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
  }

  return <Card density="compact" className={styles.card} aria-labelledby="book-matcher-heading">
    <header className={styles.heading}>
      <h2 id="book-matcher-heading" ref={heading} tabIndex={-1}>Book Matcher</h2>
      <select aria-label="Provider" value={provider ?? ''} disabled={!provider} onChange={event => {
        setProvider(event.currentTarget.value === 'hardcover' ? 'hardcover' : 'openlibrary');
        event.currentTarget.blur();
        heading.current?.focus({ preventScroll: true });
      }}>
        {!provider && <option value="">Select provider</option>}
        <option value="openlibrary">Open Library</option>
        <option value="hardcover" disabled={!config.data?.hardcover_available}>
          {config.isPending || config.data?.hardcover_available ? 'Hardcover' : 'Hardcover (Not Configured)'}
        </option>
      </select>
    </header>
    {config.isError && !config.data && <div className={styles.feedback}>
      <span role="status">Could not check provider availability.</span>
      <Button size="slim" onClick={() => void config.refetch()}>Retry</Button>
    </div>}
    {provider && <MatcherPage key={`${provider}:${page}:${revision}`} account={account} provider={provider} page={page} cache={cache.current}
      onPageChange={turn} onRefresh={() => setRevision(value => value + 1)} />}
  </Card>;
}

function MatcherPage({ account, provider, page, cache, onPageChange, onRefresh }: PageControls) {
  const request = useRef<AbortController | null>(null);
  const writes = useRef(new Set<string>());
  const lookupRequests = useRef(new Map<string, symbol>());
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [writeErrors, setWriteErrors] = useState<Partial<Record<string, WriteError>>>({});
  const [data, setData] = useState<Awaited<ReturnType<typeof session.api.matcherPage>>>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [lookups, setLookups] = useState<Partial<Record<string, Lookup>>>({});
  const client = useQueryClient();
  const { show } = useSnackbar();
  const rowFocus = useRef<string | null>(null);
  const table = useRef<HTMLTableElement>(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    return () => controller.abort();
  }, []);

  const search = useCallback(async (books: MatcherBook[], signal: AbortSignal) => {
    if (signal.aborted || !books.length) return;
    const remaining = new Map(books.map(book => [book.id, book]));
    const token = Symbol();
    for (const id of remaining.keys()) lookupRequests.current.set(id, token);
    const initial = Object.fromEntries(books.map(book => [book.id, { kind: 'searching' } as const]));
    setLookups(current => ({ ...current, ...initial }));
    try {
      await session.api.matcherLookups(account, provider, [...remaining.keys()], signal, result => {
        if (signal.aborted) return;
        const book = remaining.get(result.document_id);
        if (!book) return;
        remaining.delete(book.id);
        if (lookupRequests.current.get(book.id) !== token) return;
        lookupRequests.current.delete(book.id);
        if ('match' in result) {
          setData(current => current && { ...current, items: current.items.map(item => item.id === book.id ? { ...item, match: result.match } : item) });
          return;
        }
        if ('candidates' in result) {
          cache.set(cacheKey(provider, book), result.candidates);
          setLookups(current => ({ ...current, [book.id]: { kind: 'ready', candidates: result.candidates } }));
        } else {
          setLookups(current => ({ ...current, [book.id]: { kind: 'error' } }));
        }
      });
    } catch {
      // An interrupted response leaves unfinished rows retryable, not unmatched.
    } finally {
      if (!signal.aborted && remaining.size) {
        const failures = Object.fromEntries([...remaining.keys()].filter(id => lookupRequests.current.get(id) === token).map(id => {
          lookupRequests.current.delete(id);
          return [id, { kind: 'error' } as const];
        }));
        setLookups(current => ({ ...current, ...failures }));
      }
    }
  }, [account, cache, provider]);

  useEffect(() => {
    const signal = request.current!.signal;
    void session.api.matcherPage(account, provider, page, signal).then(result => {
      if (signal.aborted) return;
      const needLookup: MatcherBook[] = [];
      const saved: Record<string, Lookup> = Object.create(null);
      for (const book of result.items) {
        if (book.match) continue;
        const candidates = cache.get(cacheKey(provider, book));
        if (candidates) saved[book.id] = { kind: 'ready', candidates };
        else needLookup.push(book);
      }
      setLookups(saved);
      setData(result);
      void search(needLookup, signal);
    }).catch(() => { if (!signal.aborted) setLoadFailed(true); });
  }, [account, cache, page, provider, search]);

  useLayoutEffect(() => {
    if (rowFocus.current == null) return;
    const row = Array.from(table.current?.rows ?? []).find(row => row.dataset.bookId === rowFocus.current);
    row?.querySelector<HTMLElement>('[data-match-value]')?.focus({ preventScroll: true });
    rowFocus.current = null;
  }, [data]);

  async function changeLink(book: MatcherBook, match: Match, remove = false, undo = false) {
    const signal = request.current!.signal;
    if (signal.aborted || writes.current.has(book.id)) return;
    writes.current.add(book.id);
    setSaving(new Set(writes.current));
    setWriteErrors(current => ({ ...current, [book.id]: undefined }));
    try {
      if (remove) await session.api.deleteMatcherLink(account, book.id, provider, match.work_id);
      else await session.api.putMatcherLink(account, book.id, provider, match.work_id);
      void client.invalidateQueries({ queryKey: ['document', { kind: 'server', account, documentId: book.id }] });
      if (signal.aborted) return;
      rowFocus.current = book.id;
      lookupRequests.current.delete(book.id);
      if (remove) cache.delete(cacheKey(provider, book));
      setLookups(current => ({ ...current, [book.id]: undefined }));
      setData(current => current && { ...current, items: current.items.map(item => item.id === book.id ? { ...item, match: remove ? undefined : match } : item) });
      const name = providers[provider].name;
      show(remove
        ? { message: `Unlinked ${book.title} from ${name}.`, action: { label: 'Undo', onClick: () => void changeLink(book, match, false, true) } }
        : { message: `Linked ${book.title} to ${name}.` });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ReadingHTTPError && error.status === 409) {
        setWriteErrors(current => ({ ...current, [book.id]: { message: 'The match changed.', retry: onRefresh } }));
      } else {
        setWriteErrors(current => ({ ...current, [book.id]: {
          message: undo ? 'Could Not Restore Link' : remove ? 'Could Not Unlink' : 'Could Not Link',
          retry: () => void changeLink(book, match, remove, undo),
        } }));
      }
    } finally {
      writes.current.delete(book.id);
      if (!signal.aborted) setSaving(new Set(writes.current));
    }
  }

  function lookup(book: MatcherBook) {
    const signal = request.current?.signal;
    if (signal && !writes.current.has(book.id) && !lookupRequests.current.has(book.id)) void search([book], signal);
  }

  return <>
    {loadFailed && <div className={styles.feedback}><span role="alert">Could not load this page of books.</span>
      <Button size="slim" onClick={onRefresh}>Retry</Button>
      {page > 1 && <Button size="slim" onClick={() => onPageChange(page - 1)}>Previous Page</Button>}
    </div>}
    {!data && !loadFailed && <div className={styles.feedback}><SkeletonRows label="Loading Books" count={3} secondary /></div>}
    {data && <>
      {data.items.length === 0 ? <p className={styles.empty}>No books on this page.</p> : <table ref={table} className={styles.table} aria-label={`${providers[provider].name} associations`}>
        <thead><tr><th scope="col">Book</th><th scope="col">Provider ID</th><th scope="col" className={styles.action}><span className={app.srOnly}>Action</span></th></tr></thead>
        <tbody>{data.items.map(book => {
          const result = Object.hasOwn(lookups, book.id) ? lookups[book.id] : undefined;
          const best = result?.kind === 'ready' ? result.candidates[0] : undefined;
          const busy = saving.has(book.id);
          const match = book.match;
          const failure = Object.hasOwn(writeErrors, book.id) ? writeErrors[book.id] : undefined;
          const save = (candidate: MatcherCandidate) => void changeLink(book, candidate);
          return <tr key={book.id} data-book-id={book.id}>
            <th scope="row"><BookInfo book={book} isbn={book.isbn} /></th>
            <td className={styles.value}>
              {match ? <ProviderPill provider={provider} match={match} matchValue />
                : result?.kind === 'ready' ? (best ? <CandidatePicker label={`Choose Match: ${book.title}`} groupLabel={`Matches for ${book.title}`}
                    candidates={result.candidates} selected={best} provider={provider} disabled={busy} onChoose={save} />
                  : <span className={styles.noMatch}>No Match</span>)
                : result?.kind === 'searching' ? <span className={styles.status} role="status"><span className={styles.spinner} aria-hidden="true" />Searching…</span>
                : <button type="button" className={styles.trigger} data-match-value disabled={busy} onClick={() => lookup(book)}
                    aria-label={`${result?.kind === 'error' ? 'Retry Lookup' : 'Unmatched'}: ${book.title}`}>
                    {result?.kind === 'error' ? <><Icon name="refresh" size={14} />Retry Lookup</> : 'Unmatched'}
                  </button>}
              {failure && <div className={styles.writeError}><span role="status">{failure.message}</span>
                <button type="button" onClick={failure.retry} aria-label={`Retry Link Change: ${book.title}`}>Retry</button></div>}
            </td>
            <td className={styles.action}>
              {match ? <RoundButton icon="close" label={`Unlink ${book.title} from ${providers[provider].name}`} disabled={busy} onClick={() => void changeLink(book, match, true)} />
                : best && <RoundButton emphasized icon="check" label={`Confirm Match for ${book.title}`} disabled={busy} onClick={() => save(best)} />}
            </td>
          </tr>;
        })}</tbody>
      </table>}
      <nav className={styles.pager} aria-label="Book Pages">
        <RoundButton icon="back" label="Previous Page" disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
        <span role="status">{data.items.length ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + data.items.length} of ${data.total}` : `${data.total} ${data.total === 1 ? 'Book' : 'Books'}`}</span>
        <RoundButton icon="forward" label="Next Page" disabled={page * pageSize >= data.total} onClick={() => onPageChange(page + 1)} />
      </nav>
    </>}
  </>;
}

function RoundButton({ label, icon, disabled, emphasized, onClick }: { label: string; icon: IconName; disabled: boolean; emphasized?: boolean; onClick: () => void }) {
  return <button type="button" className={styles.roundButton} aria-label={label} title={label} disabled={disabled} onClick={onClick} data-emphasized={emphasized}>
    <span><Icon name={icon} size={16} /></span>
  </button>;
}
