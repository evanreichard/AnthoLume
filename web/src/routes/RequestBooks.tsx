import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { ActionRow, ActionRows, Button, Card, CardHeader, SearchField, SegmentedControl } from '../Controls';
import type { ShelfmarkBook, ShelfmarkRequestInfo } from '../api/shelfmark';
import { ReadingHTTPError, type Account } from '../reading';
import { session, useSession } from '../session';
import { shelfmarkKey, useShelfmarkSettings } from '../shelfmarkQueries';
import { Dialog, ErrorNotice, PageHeader } from '../ui';
import { useSnackbar } from '../Snackbar';
import { useObjectURL } from '../useObjectURL';
import { Icon } from '../Icon';
import styles from '../App.module.css';
import coverStyles from './RequestBooks.module.css';

const historyPageSize = 50;
const requestDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const bookKey = (book: ShelfmarkBook) => JSON.stringify([book.provider, book.id]);
const bookByline = (book: ShelfmarkBook, ...rest: string[]) =>
  [book.author, book.year ? String(book.year) : '', ...rest].filter(Boolean).join(' · ');
const attribution = (info: ShelfmarkRequestInfo) => `Requested by ${info.username}`;
const confirming = 'Shelfmark hasn’t confirmed this request yet.';

function Cover({ account, book }: { account: Account; book: ShelfmarkBook }) {
  const { data } = useQuery({
    queryKey: [...shelfmarkKey(account, 'cover'), book.provider, book.id],
    enabled: book.has_cover,
    queryFn: ({ signal }) => session.api.shelfmarkCover(account, book.provider, book.id, signal),
  });
  const url = useObjectURL(book.has_cover ? data : undefined);
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span className={coverStyles.cover} aria-hidden="true">
      {url && url !== failedUrl ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />
      ) : (
        <Icon name="book" />
      )}
    </span>
  );
}

export function RequestBooks() {
  const { access } = useSession();
  const account = access.kind === 'authenticated' ? access.account : undefined;
  const status = useShelfmarkSettings(account);
  if (!account || (!status.isError && status.data && !status.data.enabled)) return <Navigate to="/library" replace />;
  if (status.isError || !status.data)
    return (
      <>
        <PageHeader title="Request" mobileBrand />
        {status.isError ? (
          <>
            <ErrorNotice error={status.error} />
            <Button size="slim" disabled={status.isFetching} onClick={() => void status.refetch()}>
              Retry Settings Check
            </Button>
          </>
        ) : (
          <p role="status">Checking Shelfmark settings…</p>
        )}
      </>
    );
  return <RequestCatalog key={JSON.stringify(account)} account={account} />;
}

function RequestCatalog({ account }: { account: Account }) {
  const [view, setView] = useState<'search' | 'history'>('search');
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [selected, select] = useState<ShelfmarkBook | null>(null);
  const [uncertain, setUncertain] = useState<Record<string, boolean>>({});
  const client = useQueryClient();
  const { show } = useSnackbar(JSON.stringify(account));
  const searchKey = shelfmarkKey(account, 'search');
  const historyKey = shelfmarkKey(account, 'history');
  const search = useQuery({
    queryKey: [...searchKey, term],
    enabled: view === 'search' && !!term,
    queryFn: ({ signal }) => session.api.shelfmarkSearch(account, term, signal),
  });
  const history = useInfiniteQuery({
    queryKey: historyKey,
    enabled: view === 'history',
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => session.api.shelfmarkHistory(account, pageParam, signal),
    getNextPageParam: (page, _pages, offset) => (page.length > historyPageSize ? offset + historyPageSize : undefined),
  });
  const historyRows = history.data?.pages.flatMap((page) => page.slice(0, historyPageSize)) ?? [];
  const results = search.data ?? [];
  const selectedKey = selected && bookKey(selected);
  const previous =
    selected &&
    ((view === 'history' ? historyRows : results).find((book) => bookKey(book) === selectedKey)?.request ??
      selected.request);
  const unknown = !!selectedKey && !!uncertain[selectedKey] && !previous;
  const visibleResults = (book: ShelfmarkBook) =>
    book.request
      ? book.request.state === 'confirming'
        ? [book.author, 'Confirming Request'].filter(Boolean).join(' · ')
        : [book.author, attribution(book.request)].filter(Boolean).join(' · ')
      : uncertain[bookKey(book)]
        ? bookByline(book, 'Request Status Unknown')
        : bookByline(book);
  const request = useMutation({
    mutationFn: ({ book, checkOnly }: { book: ShelfmarkBook; checkOnly: boolean }) =>
      session.api.requestShelfmarkBook(account, book.provider, book.id, checkOnly),
  });
  function close() {
    request.reset();
    select(null);
  }
  function editQuery(value: string) {
    setQuery(value);
    if (value.trim() !== term) setTerm('');
  }
  function confirm(book: ShelfmarkBook, checkOnly = false) {
    if (request.isPending || (!checkOnly && (previous || unknown))) return;
    request.mutate(
      { book, checkOnly },
      {
        onSuccess: (saved) => {
          client.setQueriesData<ShelfmarkBook[]>({ queryKey: searchKey }, (rows) =>
            rows?.map((row) => (bookKey(row) === bookKey(saved) ? { ...row, request: saved.request } : row)),
          );
          void client.invalidateQueries({ queryKey: historyKey });
          select(null);
          show({
            message:
              saved.request.state === 'confirming' ? confirming : `${saved.title} · ${attribution(saved.request)}`,
          });
        },
        onError: (error) => {
          if (checkOnly && error instanceof ReadingHTTPError && error.problem.code === 'shelfmark_request_not_found') {
            setUncertain((current) => ({ ...current, [bookKey(book)]: false }));
            void client.invalidateQueries({ queryKey: searchKey });
            void client.invalidateQueries({ queryKey: historyKey });
            return;
          }
          if (
            !checkOnly &&
            (!(error instanceof ReadingHTTPError) ||
              (!error.problem.code.startsWith('shelfmark_') && ![400, 401, 403, 404, 422, 429].includes(error.status)))
          ) {
            setUncertain((current) => ({ ...current, [bookKey(book)]: true }));
            void client.invalidateQueries({ queryKey: historyKey });
          }
        },
      },
    );
  }
  return (
    <>
      <PageHeader title="Request" mobileBrand />
      <div className={styles.settingsLayout}>
        <SegmentedControl
          label="Request Views"
          options={[
            ['search', 'Search'],
            ['history', 'History'],
          ]}
          value={view}
          onChange={setView}
        />
        {view === 'search' ? (
          <Card density="compact" aria-labelledby="request-search">
            <CardHeader id="request-search" title="Find a Book" />
            <form
              role="search"
              className={styles.settingsCardRows}
              onSubmit={(event) => {
                event.preventDefault();
                const next = query.trim();
                if (next && next === term) void search.refetch();
                else setTerm(next);
              }}
            >
              <SearchField
                aria-label="Search Books to Request"
                placeholder="Search by title or author"
                value={query}
                enterKeyHint="search"
                maxLength={128}
                submit={{ label: 'Search Books', title: 'Search Books' }}
                onChange={(event) => editQuery(event.target.value)}
                onClear={query ? () => editQuery('') : undefined}
              />
            </form>
            {term && (
              <div role="group" aria-label="Search Results" className={coverStyles.results}>
                {search.isFetching && (
                  <p className={styles.settingsCardFeedback} role="status">
                    Searching…
                  </p>
                )}
                {search.isError && (
                  <>
                    <ErrorNotice error={search.error} />
                    <Button size="slim" onClick={() => void search.refetch()}>
                      Retry Search
                    </Button>
                  </>
                )}
                {!search.isError && !search.isFetching && search.data && (
                  <p className={results.length ? styles.srOnly : coverStyles.emptyResults} role="status">
                    {results.length
                      ? `${results.length} ${results.length === 1 ? 'book' : 'books'} found`
                      : 'No books found. Try another title or author.'}
                  </p>
                )}
                {results.length > 0 && (
                  <ActionRows>
                    {results.map((book) => (
                      <ActionRow
                        key={bookKey(book)}
                        leading={<Cover account={account} book={book} />}
                        label={book.title}
                        subtitle={visibleResults(book)}
                        onClick={() => select(book)}
                      />
                    ))}
                  </ActionRows>
                )}
              </div>
            )}
          </Card>
        ) : (
          <Card density="compact" aria-labelledby="request-history">
            <CardHeader id="request-history" title="Request History" />
            <ErrorNotice error={history.error} />
            {history.isPending && (
              <p className={styles.settingsCardFeedback} role="status">
                Loading request history…
              </p>
            )}
            {history.isSuccess && !historyRows.length && (
              <p className={coverStyles.emptyResults}>No books requested yet.</p>
            )}
            {historyRows.length > 0 && (
              <ActionRows>
                {historyRows.map((book) => (
                  <ActionRow
                    key={bookKey(book)}
                    leading={<Cover account={account} book={book} />}
                    label={book.title}
                    subtitle={`${attribution(book.request)} · ${requestDate.format(new Date(book.request.requested_at))}${book.request.state === 'confirming' ? ' · Confirming' : ''}`}
                    onClick={() => select(book)}
                  />
                ))}
              </ActionRows>
            )}
            {(history.hasNextPage || history.isError) && (
              <Button
                size="slim"
                disabled={history.isFetching}
                onClick={() =>
                  void (history.isFetchNextPageError || !history.isError ? history.fetchNextPage() : history.refetch())
                }
              >
                {history.isFetching ? 'Loading Requests…' : history.isError ? 'Retry History' : 'Load More Requests'}
              </Button>
            )}
          </Card>
        )}
      </div>
      {selected && (
        <Dialog
          title={selected.title}
          titleLeading={<Cover account={account} book={selected} />}
          placement="mobile-sheet"
          onClose={close}
          dismissDisabled={request.isPending}
          footer={
            previous?.state === 'confirming' || unknown ? (
              <Button disabled={request.isPending} onClick={() => confirm(selected, true)}>
                {request.isPending ? 'Checking Status…' : 'Check Status'}
              </Button>
            ) : previous ? (
              <Button onClick={close}>Done</Button>
            ) : (
              <Button
                tone="primary"
                disabled={request.isPending || search.isFetching || search.isError}
                onClick={() => confirm(selected)}
              >
                {request.isPending ? 'Requesting Ebook…' : 'Request Ebook'}
              </Button>
            )
          }
        >
          <p className={styles.settingsCardFeedback}>{bookByline(selected, 'Ebook')}</p>
          {selected.description && <p>{selected.description}</p>}
          {previous && (
            <p className={styles.settingsCardFeedback}>
              {attribution(previous)} on {requestDate.format(new Date(previous.requested_at))}.
              {previous.state === 'confirming' ? ` ${confirming}` : ''}
            </p>
          )}
          {unknown && (
            <p role="alert" className={styles.settingsCardFeedback}>
              Couldn’t verify whether Shelfmark received this request. Check its status before trying again.
            </p>
          )}
          {(!unknown || request.variables?.checkOnly) && <ErrorNotice error={request.error} />}
          {!previous && !unknown && search.isError && (
            <>
              <ErrorNotice error={search.error} />
              <Button size="slim" onClick={() => void search.refetch()}>
                Retry Search
              </Button>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
