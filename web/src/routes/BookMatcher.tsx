import { useEffectEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import { matcherLink, type MatcherBook, type MatcherCandidate, type MatcherLink, type MatcherPage, type MatcherProvider } from '../api/bookMatcher';
import { sameAccount } from '../api/client';
import { matcherReturn } from '../library';
import { session, useSession } from '../session';
import { BookInfo, CandidatePicker, ProviderPill, candidateProviders as providers } from '../CandidatePicker';
import { BackPill, Button, Card } from '../Controls';
import { Icon, type IconName } from '../Icon';
import { ReadingHTTPError, type Account } from '../reading';
import { SkeletonRows } from '../Skeleton';
import { useSnackbar } from '../Snackbar';
import { PageHeader } from '../ui';
import app from '../App.module.css';
import styles from './BookMatcher.module.css';

const pageSize = 10;
const cacheKey = (provider: MatcherProvider, book: MatcherBook) => JSON.stringify([provider, book.id, book.title, book.author, book.isbn13, book.isbn10]);
const writeKey = (provider: MatcherProvider, id: string) => JSON.stringify([provider, id]);
const linkFor = (book: MatcherBook, provider: MatcherProvider) => book.matches.find(match => match.provider === provider);
type Write = (book: MatcherBook, provider: MatcherProvider, match: MatcherLink, remove?: boolean, undo?: boolean) => Promise<boolean>;
type Lookup = { version: number } & ({ kind: 'searching' | 'error' } | { kind: 'ready'; candidates: MatcherCandidate[] });
type WriteError = { message: string; retry: () => void };
type CandidateCache = Map<string, MatcherCandidate[]>;

type PageControls = {
  account: Account; provider: MatcherProvider; data: MatcherPage; cache: CandidateCache;
  onPageChange: (next: number) => void;
  write: Write; busy: ReadonlySet<string>; errors: ReadonlyMap<string, WriteError>;
  writeVersions: Map<string, number>;
  recordLink: (id: string, provider: MatcherProvider, workID: string | null) => void;
};

export function BookMatcher() {
  const { access } = useSession();
  const location = useLocation();
  if (access.kind !== 'authenticated' && access.kind !== 'offline') return null;
  const back = matcherReturn(location.state?.returnTo, access.account);
  const library = back?.search ? `/library?${back.search}` : '/library';
  const state = back ? { returnTo: back, focusLibrary: true } : { focusLibrary: true };
  if (access.kind === 'offline') return <Navigate to={library} state={state} replace />;
  return <>
    <PageHeader leading={<BackPill to={library} state={state}>Library</BackPill>} />
    <Matcher key={JSON.stringify(access.account)} account={access.account} />
  </>;
}

function Matcher({ account }: { account: Account }) {
  const config = useQuery({ queryKey: ['metadata-providers', account], queryFn: ({ signal }) => session.api.metadataProviders(account, signal) });
  const [override, setProvider] = useState<MatcherProvider>();
  const provider = config.data && (override === 'hardcover' && !config.data.hardcover_available ? config.data.effective : override ?? config.data.effective);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const cache = useRef<CandidateCache>(new Map());
  const writeVersions = useRef(new Map<string, number>());
  const writes = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, WriteError>>(new Map());
  const heading = useRef<HTMLHeadingElement>(null);
  const client = useQueryClient();
  const { show } = useSnackbar(JSON.stringify(account));
  const pagePrefix = ['documents', account, 'matcher'] as const;
  const documents = useQuery({ queryKey: [...pagePrefix, page], queryFn: ({ signal }) => session.api.matcherPage(account, page, signal) });
  const viewed = useRef({ page, provider });
  useLayoutEffect(() => { viewed.current = { page, provider }; }, [page, provider]);

  function recordLink(id: string, source: MatcherProvider, workID: string | null) {
    client.setQueriesData<MatcherPage>({ queryKey: pagePrefix }, old => old && {
      ...old, items: old.items.map(book => book.id !== id ? book : { ...book,
        matches: [...book.matches.filter(match => match.provider !== source), ...(workID === null ? [] : [{ provider: source, work_id: workID }])],
      }),
    });
  }

  async function write(book: MatcherBook, source: MatcherProvider, match: MatcherLink, remove = false, undo = false) {
    const key = writeKey(source, book.id);
    if (writes.current.has(key)) return false;
    const currentAccount = () => {
      const access = session.getSnapshot().access;
      return access.kind === 'authenticated' && sameAccount(access.account, account);
    };
    if (!currentAccount()) return false;
    writes.current.add(key);
    setBusy(new Set(writes.current));
    setErrors(current => { const next = new Map(current); next.delete(key); return next; });
    try {
      if (remove) await session.api.deleteMatcherLink(account, book.id, source, match.work_id);
      else await session.api.putMatcherLink(account, book.id, source, match.work_id);
      if (!currentAccount()) return false;
      await client.cancelQueries({ queryKey: pagePrefix, predicate: query => (query.state.data as MatcherPage | undefined)?.items.some(item => item.id === book.id) ?? false });
      if (!currentAccount()) return false;
      writeVersions.current.set(key, (writeVersions.current.get(key) ?? 0) + 1);
      if (remove) cache.current.delete(cacheKey(source, book));
      recordLink(book.id, source, remove ? null : match.work_id);
      void client.invalidateQueries({ queryKey: ['document', { kind: 'server', account, documentId: book.id }] });
      const name = providers[source].name;
      show(remove
        ? { message: `Unlinked ${book.title} from ${name}.`, action: { label: 'Undo', onClick: () => void write(book, source, match, false, true) } }
        : { message: `Linked ${book.title} to ${name}.` });
      return true;
    } catch (error) {
      if (!currentAccount()) return false;
      const conflict = error instanceof ReadingHTTPError && error.status === 409;
      const message = conflict ? 'The match changed.' : undo ? 'Could Not Restore Link' : remove ? 'Could Not Unlink' : 'Could Not Link';
      const retry = conflict ? () => {
        setErrors(current => { const next = new Map(current); next.delete(key); return next; });
        cache.current.delete(cacheKey(source, book));
        void client.invalidateQueries({ queryKey: pagePrefix }).then(() => setRevision(value => value + 1));
      } : () => void write(book, source, match, remove, undo);
      setErrors(current => new Map(current).set(key, { message, retry }));
      if (undo || viewed.current.provider !== source || viewed.current.page !== page) show({ message, tone: 'error', action: { label: 'Retry', onClick: retry } });
      return false;
    } finally {
      writes.current.delete(key);
      if (currentAccount()) setBusy(new Set(writes.current));
    }
  }

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
    {documents.isError && !documents.data && <div className={styles.feedback}><span role="alert">Could not load this page of books.</span>
      <Button size="slim" onClick={() => void documents.refetch()}>Retry</Button>
      {page > 1 && <Button size="slim" onClick={() => turn(page - 1)}>Previous Page</Button>}
    </div>}
    {documents.isPending && <div className={styles.feedback}><SkeletonRows label="Loading Books" count={3} secondary /></div>}
    {provider && documents.data && <Page key={`${provider}:${page}:${revision}`} account={account} provider={provider} data={documents.data} cache={cache.current}
      onPageChange={turn} write={write} busy={busy} errors={errors} writeVersions={writeVersions.current} recordLink={recordLink} />}
  </Card>;
}

function Page({ account, provider, data, cache, onPageChange, write, busy: saving, errors, writeVersions, recordLink }: PageControls) {
  const page = data.page;
  const request = useRef<AbortController | null>(null);
  const lookupRequests = useRef(new Set<string>());
  const [lookups, setLookups] = useState<ReadonlyMap<string, Lookup>>(new Map());
  const [rowFocus, setRowFocus] = useState<string | null>(null);
  const version = (id: string) => writeVersions.get(writeKey(provider, id)) ?? 0;
  const store = (key: string, result: Lookup) => setLookups(current => new Map(current).set(key, result));
  const table = useRef<HTMLTableElement>(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    return () => controller.abort();
  }, []);

  async function search(books: MatcherBook[], signal: AbortSignal) {
    if (signal.aborted || !books.length) return;
    const remaining = new Map(books.map(book => [book.id, { book, version: version(book.id) }]));
    for (const [id, lookup] of remaining) {
      lookupRequests.current.add(id);
      store(cacheKey(provider, lookup.book), { kind: 'searching', version: lookup.version });
    }
    try {
      await session.api.matcherLookups(account, provider, [...remaining.keys()], signal, result => {
        if (signal.aborted) return;
        const lookup = remaining.get(result.document_id);
        if (!lookup) return;
        const { book, version: started } = lookup;
        remaining.delete(book.id);
        lookupRequests.current.delete(book.id);
        if (started !== version(book.id)) return;
        const key = cacheKey(provider, book);
        if ('match' in result) recordLink(book.id, provider, result.match.work_id);
        else if ('candidates' in result) {
          cache.set(key, result.candidates);
          store(key, { kind: 'ready', candidates: result.candidates, version: started });
        } else store(key, { kind: 'error', version: started });
      });
    } catch {
      // An interrupted response leaves unfinished rows retryable, not unmatched.
    } finally {
      if (!signal.aborted) for (const [id, lookup] of remaining) {
        lookupRequests.current.delete(id);
        if (lookup.version === version(id)) store(cacheKey(provider, lookup.book), { kind: 'error', version: lookup.version });
      }
    }
  }

  const searchPage = useEffectEvent(() => {
    const signal = request.current!.signal;
    lookupRequests.current.clear();
    const needLookup: MatcherBook[] = [];
    for (const book of data.items) {
      if (linkFor(book, provider) || saving.has(writeKey(provider, book.id))) continue;
      const key = cacheKey(provider, book), candidates = cache.get(key);
      if (candidates) store(key, { kind: 'ready', candidates, version: version(book.id) });
      else needLookup.push(book);
    }
    void search(needLookup, signal);
  });
  useEffect(() => { searchPage(); }, []);

  useLayoutEffect(() => {
    if (rowFocus == null) return;
    const row = Array.from(table.current?.rows ?? []).find(row => row.dataset.bookId === rowFocus);
    row?.querySelector<HTMLElement>('[data-match-value]')?.focus({ preventScroll: true });
    setRowFocus(null);
  }, [rowFocus]);

  async function changeLink(book: MatcherBook, match: MatcherLink, remove = false) {
    const signal = request.current!.signal;
    if (!signal.aborted && await write(book, provider, match, remove) && !signal.aborted) setRowFocus(book.id);
  }

  function lookup(book: MatcherBook) {
    const signal = request.current?.signal;
    if (signal && !saving.has(writeKey(provider, book.id)) && !lookupRequests.current.has(book.id)) void search([book], signal);
  }

  return <>
      {data.items.length === 0 ? <p className={styles.empty}>No books on this page.</p> : <table ref={table} className={styles.table} aria-label={`${providers[provider].name} associations`}>
        <thead><tr><th scope="col">Book</th><th scope="col">Provider ID</th><th scope="col" className={styles.action}><span className={app.srOnly}>Action</span></th></tr></thead>
        <tbody>{data.items.map(book => {
          const lookupState = lookups.get(cacheKey(provider, book));
          const result = lookupState?.version === version(book.id) ? lookupState : undefined;
          const best = result?.kind === 'ready' ? result.candidates[0] : undefined;
          const key = writeKey(provider, book.id);
          const busy = saving.has(key);
          const reference = linkFor(book, provider);
          const match = reference && matcherLink(provider, reference.work_id);
          const failure = errors.get(key);
          const save = (candidate: MatcherCandidate) => void changeLink(book, candidate);
          return <tr key={book.id} data-book-id={book.id}>
            <th scope="row"><BookInfo book={{ title: book.title ?? '', author: book.author ?? '' }} isbn={book.isbn13 || book.isbn10 || undefined} /></th>
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
  </>;
}

function RoundButton({ label, icon, disabled, emphasized, onClick }: { label: string; icon: IconName; disabled: boolean; emphasized?: boolean; onClick: () => void }) {
  return <button type="button" className={styles.roundButton} aria-label={label} title={label} disabled={disabled} onClick={onClick} data-emphasized={emphasized}>
    <span><Icon name={icon} size={16} /></span>
  </button>;
}
