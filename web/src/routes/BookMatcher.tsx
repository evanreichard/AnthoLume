import { useEffectEvent, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import {
  matcherLink,
  type MatcherBook,
  type MatcherCandidate,
  type MatcherLink,
  type MatcherMetadataMode,
  type MatcherPage,
  type MatcherProvider,
} from '../api/bookMatcher';
import { matcherReturn, parseSort, type LibrarySort } from '../library';
import { BookSortControl } from '../BookSortControl';
import { invalidateBook } from '../catalogQueries';
import { metadataProviderOptions } from '../metadataProviders';
import { session, useSession } from '../session';
import { BookInfo, CandidatePicker, ProviderPill, candidateProviders as providers } from '../CandidatePicker';
import { BackPill, Button, Card, CircleAction, Pager } from '../Controls';
import { Icon } from '../Icon';
import { readCover, ReadingHTTPError, sameAccount, useReading, type Account } from '../reading';
import { SkeletonRows } from '../Skeleton';
import { useSnackbar } from '../Snackbar';
import { PageHeader } from '../ui';
import app from '../App.module.css';
import styles from './BookMatcher.module.css';
import { MatcherLinkControls } from './MatcherLinkControls';

const pageSize = 10;
const metadataKey = (book: MatcherBook) => JSON.stringify([book.title, book.author, book.isbn13, book.isbn10]);
const rowKey = (provider: MatcherProvider, id: string) => JSON.stringify([provider, id]);
const linkFor = (book: MatcherBook, provider: MatcherProvider) =>
  book.matches.find((match) => match.provider === provider);
type LinkAction =
  | { kind: 'confirm'; match: MatcherCandidate; mode: MatcherMetadataMode }
  | { kind: 'unlink' | 'undo'; match: MatcherLink };
type Write = (book: MatcherBook, provider: MatcherProvider, action: LinkAction) => Promise<boolean>;
type Lookup = { metadata: string } & (
  { kind: 'searching' | 'error'; signal: AbortSignal } | { kind: 'ready'; candidates: MatcherCandidate[] }
);
type WriteError = { message: string; retry: () => void };

type PageControls = {
  account: Account;
  provider: MatcherProvider;
  data: MatcherPage;
  mode: MatcherMetadataMode;
  lookups: ReadonlyMap<string, Lookup>;
  readLookup: (key: string) => Lookup | undefined;
  storeLookup: (key: string, value?: Lookup) => void;
  onPageChange: (next: number) => void;
  write: Write;
  busy: ReadonlySet<string>;
  errors: ReadonlyMap<string, WriteError>;
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
  return (
    <Matcher
      key={JSON.stringify(access.account)}
      account={access.account}
      back={
        <BackPill to={library} state={state}>
          Library
        </BackPill>
      }
    />
  );
}

function Matcher({ account, back }: { account: Account; back: ReactNode }) {
  const config = useQuery(metadataProviderOptions(account));
  const reading = useReading();
  const [mode, setMode] = useState<MatcherMetadataMode>('link_only');
  const [override, setProvider] = useState<MatcherProvider>();
  const provider =
    config.data &&
    (override === 'hardcover' && !config.data.hardcover_available
      ? config.data.effective
      : (override ?? config.data.effective));
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(() => parseSort(null));
  const [revision, setRevision] = useState(0);
  const [lookups, setLookups] = useState<ReadonlyMap<string, Lookup>>(() => new Map());
  const latestLookups = useRef(lookups);
  const writes = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, WriteError>>(new Map());
  const heading = useRef<HTMLHeadingElement>(null);
  const client = useQueryClient();
  const { show } = useSnackbar(JSON.stringify(account));
  const pagePrefix = ['documents', account, 'matcher'] as const;
  const documents = useQuery({
    queryKey: [...pagePrefix, sort, page],
    queryFn: ({ signal }) => session.api.matcherPage(account, page, sort, signal),
  });
  const viewed = useRef({ page, provider, sort });
  useLayoutEffect(() => {
    viewed.current = { page, provider, sort };
  }, [page, provider, sort]);

  function storeLookup(key: string, value?: Lookup) {
    if (latestLookups.current.get(key) === value) return;
    const next = new Map(latestLookups.current);
    if (value) next.set(key, value);
    else next.delete(key);
    latestLookups.current = next;
    setLookups(next);
  }

  function recordLink(id: string, source: MatcherProvider, workID: string | null) {
    storeLookup(rowKey(source, id));
    client.setQueriesData<MatcherPage>(
      { queryKey: pagePrefix },
      (old) =>
        old && {
          ...old,
          items: old.items.map((book) =>
            book.id !== id
              ? book
              : {
                  ...book,
                  matches: [
                    ...book.matches.filter((match) => match.provider !== source),
                    ...(workID === null ? [] : [{ provider: source, work_id: workID }]),
                  ],
                },
          ),
        },
    );
  }

  async function write(book: MatcherBook, source: MatcherProvider, action: LinkAction) {
    const { kind, match } = action;
    const key = rowKey(source, book.id);
    if (writes.current.has(book.id)) return false;
    const currentAccount = () => {
      const access = session.getSnapshot().access;
      return access.kind === 'authenticated' && sameAccount(access.account, account);
    };
    if (!currentAccount()) return false;
    writes.current.add(book.id);
    setBusy(new Set(writes.current));
    setErrors((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    try {
      const result =
        kind === 'unlink'
          ? await session.api.deleteMatcherLink(account, book.id, source, match.work_id)
          : await session.api.putMatcherLink(
              account,
              book.id,
              source,
              match,
              kind === 'confirm' ? action.mode : 'link_only',
            );
      const changed = result?.changed_fields ?? [];
      const metadataChanged = changed.length > 0;
      if (!currentAccount()) return false;
      await client.cancelQueries({
        queryKey: pagePrefix,
        predicate: (query) =>
          metadataChanged ||
          ((query.state.data as MatcherPage | undefined)?.items.some((item) => item.id === book.id) ??
            query.state.fetchStatus === 'fetching'),
      });
      if (!currentAccount()) return false;
      recordLink(book.id, source, kind === 'unlink' ? null : match.work_id);
      const ref = { kind: 'server', account, documentId: book.id } as const;
      if (metadataChanged) {
        void invalidateBook(client, ref);
      } else {
        // Cold Pages - An interrupted first load has no cached links to patch.
        void client.refetchQueries({
          queryKey: pagePrefix,
          type: 'active',
          predicate: (query) => query.state.status === 'pending',
        });
        void client.invalidateQueries({ queryKey: ['document', ref] });
      }
      const name = providers[source].name;
      const linked = `Linked ${book.title} to ${name}`;
      const summary = !result
        ? ''
        : !metadataChanged
          ? ' · No metadata changes'
          : ` · ${changed.length} ${changed.length === 1 ? 'field' : 'fields'} ${kind === 'confirm' && action.mode === 'fill_missing' ? 'filled' : 'updated'}`;
      show(
        kind === 'unlink'
          ? {
              message: `Unlinked ${book.title} from ${name}.`,
              action: { label: 'Undo', onClick: () => void write(book, source, { kind: 'undo', match }) },
            }
          : { message: `${linked}${summary}.` },
      );
      if (
        changed.some((field) => field === 'title' || field === 'author' || field === 'cover') &&
        reading.books.some(
          (stored) =>
            stored.ref.kind === 'server' &&
            stored.ref.documentId === book.id &&
            sameAccount(stored.ref.account, account),
        )
      ) {
        try {
          const signal = AbortSignal.timeout(8000);
          const [document, cover] = await Promise.all([
            session.api.document(account, book.id, signal),
            changed.includes('cover')
              ? session.api.bridge
                  .fetchCover(account, book.id, signal)
                  .then((response) => readCover(response, signal))
                  .catch(() => undefined)
              : undefined,
          ]);
          if (currentAccount())
            await reading.updateDownloadMetadata(ref, { title: document.title, author: document.author }, cover);
        } catch {
          // Local Copy - A cache refresh failure does not undo the committed server change.
        }
      }
      return currentAccount();
    } catch (error) {
      if (!currentAccount()) return false;
      const conflict = error instanceof ReadingHTTPError && error.problem.code === 'book_match_changed';
      if (kind === 'confirm' && !conflict) {
        show({ message: `Could not link ${book.title}. Use the checkmark to try again.`, tone: 'error' });
        return false;
      }
      const message = conflict ? 'The match changed.' : kind === 'undo' ? 'Could Not Restore Link' : 'Could Not Unlink';
      const retry = conflict
        ? () => {
            setErrors((current) => {
              const next = new Map(current);
              next.delete(key);
              return next;
            });
            storeLookup(key);
            void client.invalidateQueries({ queryKey: pagePrefix }).then(() => setRevision((value) => value + 1));
          }
        : () => void write(book, source, action);
      setErrors((current) => new Map(current).set(key, { message, retry }));
      if (
        kind === 'undo' ||
        viewed.current.provider !== source ||
        viewed.current.page !== page ||
        viewed.current.sort !== sort
      )
        show({ message, tone: 'error', action: { label: 'Retry', onClick: retry } });
      return false;
    } finally {
      writes.current.delete(book.id);
      if (currentAccount()) setBusy(new Set(writes.current));
    }
  }

  function turn(next: number) {
    setPage(next);
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'nearest' });
  }

  function changeSort(next: LibrarySort) {
    if (next === sort) return;
    setSort(next);
    setPage(1);
  }

  return (
    <>
      <PageHeader leading={back} actions={<BookSortControl sort={sort} onChange={changeSort} />} />
      <Card density="compact" className={styles.card} aria-labelledby="book-matcher-heading">
        <header className={styles.heading}>
          <h2 id="book-matcher-heading" ref={heading} tabIndex={-1}>
            Book Matcher
          </h2>
          <MatcherLinkControls
            provider={provider}
            hardcoverAvailable={!!config.data?.hardcover_available}
            onProviderChange={setProvider}
            mode={mode}
            onModeChange={setMode}
          />
        </header>
        {config.isError && !config.data && (
          <div className={styles.feedback}>
            <span role="status">Could not check provider availability.</span>
            <Button size="slim" onClick={() => void config.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {documents.isError && !documents.data && (
          <div className={styles.feedback}>
            <span role="alert">Could not load this page of books.</span>
            <Button size="slim" onClick={() => void documents.refetch()}>
              Retry
            </Button>
            {page > 1 && (
              <Button size="slim" onClick={() => turn(page - 1)}>
                Previous Page
              </Button>
            )}
          </div>
        )}
        {documents.isPending && (
          <div className={styles.feedback}>
            <SkeletonRows label="Loading Books" count={3} secondary />
          </div>
        )}
        {provider && documents.data && (
          <Page
            key={`${provider}:${sort}:${page}:${revision}`}
            account={account}
            provider={provider}
            data={documents.data}
            mode={mode}
            lookups={lookups}
            readLookup={(key) => latestLookups.current.get(key)}
            storeLookup={storeLookup}
            onPageChange={turn}
            write={write}
            busy={busy}
            errors={errors}
            recordLink={recordLink}
          />
        )}
      </Card>
    </>
  );
}

function Page({
  account,
  provider,
  data,
  mode,
  lookups,
  readLookup,
  storeLookup,
  onPageChange,
  write,
  busy: saving,
  errors,
  recordLink,
}: PageControls) {
  const page = data.page;
  const pageMetadata = JSON.stringify(data.items.map((book) => [book.id, metadataKey(book)]));
  const request = useRef<AbortController | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ bookId: string } | null>(null);
  const [selections, setSelections] = useState<ReadonlyMap<string, string>>(() => new Map());
  const table = useRef<HTMLTableElement>(null);

  useLayoutEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    return () => controller.abort();
  }, []);

  async function search(books: MatcherBook[], signal: AbortSignal) {
    if (signal.aborted || !books.length) return;
    const remaining = new Map<string, Lookup>();
    for (const book of books) {
      const key = rowKey(provider, book.id);
      const lookup: Lookup = { kind: 'searching', signal, metadata: metadataKey(book) };
      remaining.set(book.id, lookup);
      storeLookup(key, lookup);
    }
    try {
      await session.api.matcherLookups(account, provider, [...remaining.keys()], signal, (result) => {
        if (signal.aborted) return;
        const lookup = remaining.get(result.document_id);
        if (!lookup) return;
        remaining.delete(result.document_id);
        const key = rowKey(provider, result.document_id);
        if (readLookup(key) !== lookup) return;
        if ('match' in result) recordLink(result.document_id, provider, result.match.work_id);
        else if ('candidates' in result)
          storeLookup(key, { kind: 'ready', candidates: result.candidates, metadata: lookup.metadata });
        else storeLookup(key, { kind: 'error', signal, metadata: lookup.metadata });
      });
    } catch {
      // An interrupted response leaves unfinished rows retryable, not unmatched.
    } finally {
      if (!signal.aborted)
        for (const [id, lookup] of remaining) {
          const key = rowKey(provider, id);
          if (readLookup(key) === lookup) storeLookup(key, { kind: 'error', signal, metadata: lookup.metadata });
        }
    }
  }

  const searchPage = useEffectEvent(() => {
    const signal = request.current!.signal;
    void search(
      data.items.filter((book) => {
        const key = rowKey(provider, book.id);
        if (linkFor(book, provider)) return false;
        const cached = readLookup(key);
        return (
          !cached || cached.metadata !== metadataKey(book) || (cached.kind !== 'ready' && cached.signal !== signal)
        );
      }),
      signal,
    );
  });
  useEffect(() => {
    searchPage();
  }, [pageMetadata]);

  useLayoutEffect(() => {
    if (!focusRequest) return;
    const row = Array.from(table.current?.rows ?? []).find((row) => row.dataset.bookId === focusRequest.bookId);
    row?.querySelector<HTMLElement>('[data-match-value]')?.focus({ preventScroll: true });
  }, [focusRequest]);

  async function changeLink(book: MatcherBook, action: LinkAction) {
    const signal = request.current!.signal;
    if (!signal.aborted && (await write(book, provider, action)) && !signal.aborted) {
      setSelections((current) => {
        if (!current.has(book.id)) return current;
        const next = new Map(current);
        next.delete(book.id);
        return next;
      });
      setFocusRequest({ bookId: book.id });
    }
  }

  function lookup(book: MatcherBook) {
    const signal = request.current?.signal;
    const key = rowKey(provider, book.id);
    const pending = readLookup(key);
    if (signal && !saving.has(book.id) && !(pending?.kind === 'searching' && pending.signal === signal))
      void search([book], signal);
  }

  return (
    <>
      {data.items.length === 0 ? (
        <p className={styles.empty}>No books on this page.</p>
      ) : (
        <table ref={table} className={styles.table} aria-label={`${providers[provider].name} associations`}>
          <thead>
            <tr>
              <th scope="col">Book</th>
              <th scope="col">Provider ID</th>
              <th scope="col" className={styles.action}>
                <span className={app.srOnly}>Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((book) => {
              const key = rowKey(provider, book.id);
              const lookupState = lookups.get(key);
              const result =
                lookupState?.metadata === metadataKey(book) &&
                (lookupState.kind === 'ready' || !lookupState.signal.aborted)
                  ? lookupState
                  : undefined;
              const selection = selections.get(book.id);
              const selected =
                result?.kind === 'ready'
                  ? (result.candidates.find((candidate) => candidate.work_id === selection) ?? result.candidates[0])
                  : undefined;
              const busy = saving.has(book.id);
              const reference = linkFor(book, provider);
              const match = reference && matcherLink(provider, reference.work_id);
              const failure = errors.get(key);
              return (
                <tr key={book.id} data-book-id={book.id}>
                  <th scope="row">
                    <BookInfo
                      book={{ title: book.title ?? '', author: book.author ?? '' }}
                      isbn={book.isbn13 || book.isbn10 || undefined}
                    />
                  </th>
                  <td className={styles.value}>
                    {match ? (
                      <ProviderPill provider={provider} match={match} matchValue />
                    ) : result?.kind === 'ready' ? (
                      selected ? (
                        <CandidatePicker
                          label={`Choose Match: ${book.title}`}
                          groupLabel={`Matches for ${book.title}`}
                          candidates={result.candidates}
                          selected={selected}
                          provider={provider}
                          disabled={busy}
                          onChoose={(candidate) =>
                            setSelections((current) => new Map(current).set(book.id, candidate.work_id))
                          }
                        />
                      ) : (
                        <span className={styles.noMatch}>No Match</span>
                      )
                    ) : result?.kind === 'searching' ? (
                      <span className={styles.status} role="status">
                        <span className={app.lookupSpinner} aria-hidden="true" />
                        Searching…
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles.trigger}
                        data-match-value
                        disabled={busy}
                        onClick={() => lookup(book)}
                        aria-label={`${result?.kind === 'error' ? 'Retry Lookup' : 'Unmatched'}: ${book.title}`}
                      >
                        {result?.kind === 'error' ? (
                          <>
                            <Icon name="refresh" size={14} />
                            Retry Lookup
                          </>
                        ) : (
                          'Unmatched'
                        )}
                      </button>
                    )}
                    {failure && (
                      <div className={styles.writeError}>
                        <span role="status">{failure.message}</span>
                        <button type="button" onClick={failure.retry} aria-label={`Retry Link Change: ${book.title}`}>
                          Retry
                        </button>
                      </div>
                    )}
                  </td>
                  <td className={styles.action}>
                    {match ? (
                      <CircleAction
                        icon="close"
                        label={`Unlink ${book.title} from ${providers[provider].name}`}
                        disabled={busy}
                        onClick={() => void changeLink(book, { kind: 'unlink', match })}
                      />
                    ) : (
                      selected && (
                        <CircleAction
                          emphasized
                          icon="check"
                          label={`Confirm Match for ${book.title}`}
                          disabled={busy}
                          onClick={() => void changeLink(book, { kind: 'confirm', match: selected, mode })}
                        />
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Pager
        label="Book Pages"
        page={page}
        hasNext={page * pageSize < data.total}
        onPageChange={onPageChange}
        range={
          data.items.length
            ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + data.items.length} of ${data.total}`
            : `${data.total} ${data.total === 1 ? 'Book' : 'Books'}`
        }
      />
    </>
  );
}
