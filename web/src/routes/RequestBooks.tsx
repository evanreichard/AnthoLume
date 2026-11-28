import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  type QueryClient,
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { ActionRow, ActionRows, Button, Card, CardHeader, SearchField, SegmentedControl } from '../Controls';
import type { ShelfmarkBook, ShelfmarkRelease, ShelfmarkReleases } from '../api/shelfmark';
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
const requestCount = (count: number) => `${count} ${count === 1 ? 'request' : 'requests'}`;
const releaseStatus = (state: string) => state.charAt(0).toUpperCase() + state.slice(1);

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
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const update = () => setDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [view, setView] = useState<'search' | 'history'>('search');
  const showSearch = desktop || view === 'search';
  const showHistory = desktop || view === 'history';
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [selected, select] = useState<{ book: ShelfmarkBook; history: boolean } | null>(null);
  const searchKey = shelfmarkKey(account, 'search');
  const historyKey = shelfmarkKey(account, 'history');
  const search = useQuery({
    queryKey: [...searchKey, term],
    enabled: showSearch && !!term,
    queryFn: ({ signal }) => session.api.shelfmarkSearch(account, term, signal),
  });
  const history = useInfiniteQuery({
    queryKey: historyKey,
    enabled: showHistory,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => session.api.shelfmarkHistory(account, pageParam, signal),
    getNextPageParam: (page, _pages, offset) => (page.length > historyPageSize ? offset + historyPageSize : undefined),
  });
  const historyRows = history.data?.pages.flatMap((page) => page.slice(0, historyPageSize)) ?? [];
  const results = search.data ?? [];
  function editQuery(value: string) {
    setQuery(value);
    if (value.trim() !== term) setTerm('');
  }
  return (
    <>
      <PageHeader title="Request" mobileBrand />
      <div className={styles.settingsLayout}>
        {!desktop && (
          <SegmentedControl
            label="Request Views"
            options={[
              ['search', 'Search'],
              ['history', 'History'],
            ]}
            value={view}
            onChange={setView}
          />
        )}
        {showSearch && (
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
                  <p className={results.length ? styles.srOnly : coverStyles.resultStatus} role="status">
                    {!results.length && <span className={styles.lookupSpinner} aria-hidden="true" />}
                    <span>Searching Shelfmark for books…</span>
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
                  <p className={results.length ? styles.srOnly : coverStyles.resultStatus} role="status">
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
                        subtitle={bookByline(book, book.request_count ? requestCount(book.request_count) : '')}
                        onClick={() => select({ book, history: false })}
                      />
                    ))}
                  </ActionRows>
                )}
              </div>
            )}
          </Card>
        )}
        {showHistory && (
          <Card density="compact" aria-labelledby="request-history">
            <CardHeader id="request-history" title="Request History" />
            <ErrorNotice error={history.error} />
            {history.isPending && (
              <p className={styles.settingsCardFeedback} role="status">
                Loading request history…
              </p>
            )}
            {history.isSuccess && !historyRows.length && (
              <p className={coverStyles.resultStatus}>No books requested yet.</p>
            )}
            {historyRows.length > 0 && (
              <ActionRows>
                {historyRows.map((book) => (
                  <ActionRow
                    key={bookKey(book)}
                    leading={<Cover account={account} book={book} />}
                    label={book.title}
                    subtitle={bookByline(book, requestCount(book.request_count))}
                    onClick={() => select({ book, history: true })}
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
        <ReleaseDialog account={account} book={selected.book} history={selected.history} onClose={() => select(null)} />
      )}
    </>
  );
}

function BookDescription({ text }: { text: string }) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const node = paragraph.current;
    if (!node || expanded) return;
    const observer = new ResizeObserver(() => setOverflows(node.scrollHeight > node.clientHeight + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, text]);
  return (
    <>
      <p id={id} ref={paragraph} className={coverStyles.description} data-collapsed={!expanded || undefined}>
        {text}
      </p>
      {(expanded || overflows) && (
        <Button size="slim" aria-controls={id} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show Less' : 'Show More'}
        </Button>
      )}
    </>
  );
}

function updateCachedRequests(
  client: QueryClient,
  account: Account,
  kind: 'releases' | 'release-history',
  saved: ShelfmarkRelease[],
) {
  const requests = new Map(saved.map((row) => [row.key, row.request]));
  client.setQueriesData<ShelfmarkReleases>({ queryKey: shelfmarkKey(account, kind) }, (current) => {
    if (!current) return;
    let changed = false;
    const releases = current.releases.map((row) => {
      const request = requests.get(row.key);
      if (!request || row.request?.state === request.state) return row;
      if (row.request && row.request.state !== 'unconfirmed') return row;
      changed = true;
      return { ...row, request };
    });
    return changed ? { ...current, releases } : undefined;
  });
}

function ReleaseDialog({
  account,
  book,
  history,
  onClose,
}: {
  account: Account;
  book: ShelfmarkBook;
  history: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const key = [...shelfmarkKey(account, history ? 'release-history' : 'releases'), book.provider, book.id];
  const mutationKey = ['shelfmark-download', account, book.provider, book.id];
  const pending = useIsMutating({ mutationKey, exact: true });
  const releases = useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<ShelfmarkReleases> => {
      const result = history
        ? {
            releases: await session.api.shelfmarkReleaseHistory(account, book.provider, book.id, signal),
            partial: false,
          }
        : await session.api.shelfmarkReleases(account, book.provider, book.id, signal);
      updateCachedRequests(client, account, history ? 'releases' : 'release-history', result.releases);
      return result;
    },
    ...(history ? {} : { staleTime: Infinity, gcTime: Infinity }),
    refetchOnWindowFocus: false,
  });
  const rows = releases.data?.releases ?? [];
  const recommendation = history ? undefined : releases.data?.recommendation;
  return (
    <Dialog
      title={book.title}
      titleLeading={<Cover account={account} book={book} />}
      subtitle={bookByline(book)}
      placement="mobile-sheet"
      size="wide"
      layout="scroll-body"
      scrollHeight="tall"
      onClose={onClose}
      dismissDisabled={pending > 0}
    >
      {!history && book.description && <BookDescription text={book.description} />}
      <section aria-label={history ? 'Requested Releases' : 'Ebook Releases'} className={coverStyles.results}>
        {releases.isFetching && (
          <p className={rows.length ? styles.srOnly : coverStyles.resultStatus} role="status">
            {!rows.length && <span className={styles.lookupSpinner} aria-hidden="true" />}
            <span>{history ? 'Loading requested releases…' : 'Finding releases…'}</span>
          </p>
        )}
        {releases.isError && (
          <div className={coverStyles.resultStatus}>
            <ErrorNotice
              error={
                !history &&
                releases.error instanceof ReadingHTTPError &&
                releases.error.problem.code === 'shelfmark_upstream_error'
                  ? 'Couldn’t load releases from Shelfmark.'
                  : releases.error
              }
            />
            <Button size="slim" disabled={releases.isFetching} onClick={() => void releases.refetch()}>
              {history ? 'Retry History' : 'Retry Releases'}
            </Button>
          </div>
        )}
        {releases.data?.partial && (
          <p role="status" className={styles.settingsCardFeedback}>
            Some sources didn’t return results. This list may be incomplete.
          </p>
        )}
        {releases.isSuccess && !releases.isFetching && !rows.length && (
          <p className={coverStyles.resultStatus} role="status">
            {history ? 'No saved releases for this book.' : 'No releases found.'}
          </p>
        )}
        {rows.length > 0 && (
          <ul className={coverStyles.releaseList}>
            {rows.map((release) => (
              <ReleaseRow
                key={release.key}
                release={release}
                recommendation={recommendation?.release_key === release.key ? recommendation.basis : undefined}
                download={!history && !releases.isFetching && !releases.isError}
                account={account}
                book={book}
                mutationKey={mutationKey}
                refresh={async () => (await releases.refetch()).isSuccess}
              />
            ))}
          </ul>
        )}
      </section>
    </Dialog>
  );
}

type RecommendationBasis = NonNullable<ShelfmarkReleases['recommendation']>['basis'];

function RecommendationBadge({ basis }: { basis: RecommendationBasis }) {
  const id = useId();
  const badge = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<'hover' | 'focus' | 'pinned'>();
  const open = mode !== undefined;

  useLayoutEffect(() => {
    const popup = tooltip.current;
    const trigger = badge.current;
    if (!open || !popup || !trigger) return;
    popup.showPopover();
    function position() {
      if (!popup || !trigger) return;
      const anchor = trigger.getBoundingClientRect();
      const { width, height } = popup.getBoundingClientRect();
      const right = document.documentElement.clientWidth - width - 8;
      const below = anchor.bottom + height <= document.documentElement.clientHeight - 8;
      popup.style.left = `${Math.max(8, Math.min(anchor.left, right))}px`;
      popup.style.top = `${below ? anchor.bottom : anchor.top - height}px`;
    }
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      popup.hidePopover();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dialog = badge.current?.closest('dialog');
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMode(undefined);
    };
    const onClickOutside = (event: MouseEvent) => {
      if (
        !(event.target instanceof Node) ||
        badge.current?.contains(event.target) ||
        tooltip.current?.contains(event.target)
      )
        return;
      if (dialog && event.target === dialog) {
        const { left, top, right, bottom } = dialog.getBoundingClientRect();
        if (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
      setMode(undefined);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClickOutside, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClickOutside, true);
    };
  }, [open]);

  return (
    <span
      className={coverStyles.releaseRecommendation}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setMode((current) => current ?? 'hover');
      }}
      onPointerLeave={() => setMode((current) => (current === 'hover' ? undefined : current))}
    >
      <button
        ref={badge}
        type="button"
        className={coverStyles.recommendationBadge}
        aria-describedby={id}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setMode('focus');
        }}
        onBlur={(event) => {
          if (event.relatedTarget) setMode((current) => (current === 'focus' ? undefined : current));
        }}
        onClick={() => setMode((current) => (current === 'pinned' ? undefined : 'pinned'))}
      >
        Recommended
      </button>
      <span ref={tooltip} id={id} popover="manual" role="tooltip" className={coverStyles.recommendationReason}>
        {basis === 'isbn' ? 'ISBN match' : 'Title and author match'}
      </span>
    </span>
  );
}

function ReleaseRow({
  release,
  recommendation,
  download,
  account,
  book,
  mutationKey,
  refresh,
}: {
  release: ShelfmarkRelease;
  recommendation?: RecommendationBasis;
  download: boolean;
  account: Account;
  book: ShelfmarkBook;
  mutationKey: readonly unknown[];
  refresh: () => Promise<boolean>;
}) {
  const client = useQueryClient();
  const { show } = useSnackbar(JSON.stringify(account));
  const request = useMutation({
    mutationKey,
    mutationFn: () =>
      session.api.requestShelfmarkRelease(account, book.provider, book.id, release.key, release.selection!),
    retry: false,
    onSuccess: ({ release: saved, request_count }) => {
      client.setQueriesData<ShelfmarkBook[]>({ queryKey: shelfmarkKey(account, 'search') }, (books) =>
        books?.map((row) =>
          bookKey(row) === bookKey(book) ? { ...row, request_count: Math.max(row.request_count, request_count) } : row,
        ),
      );
      updateCachedRequests(client, account, 'releases', [saved]);
      show({ message: `${releaseStatus(saved.request.state)} · ${saved.title}` });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: shelfmarkKey(account, 'history') });
      void client.invalidateQueries({
        queryKey: [...shelfmarkKey(account, 'release-history'), book.provider, book.id],
      });
    },
  });
  const invalidSelection =
    request.error instanceof ReadingHTTPError && request.error.problem.code === 'shelfmark_invalid_selection';
  const saved = release.request ?? request.data?.release.request;
  const buttonLabel = saved ? releaseStatus(saved.state) : request.isPending ? 'Queueing…' : 'Download';
  const byline = release.author ? `By ${release.author}` : book.author ? `Catalog author: ${book.author}` : '';
  const metadata = [
    release.format.toUpperCase(),
    release.size,
    release.language,
    release.indexer && release.indexer !== release.source ? `${release.source} › ${release.indexer}` : release.source,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className={coverStyles.releaseRow}>
      <div className={coverStyles.releaseDetails}>
        <div>
          <strong>{release.title}</strong>
          {recommendation && (
            <>
              {' '}
              <RecommendationBadge basis={recommendation} />
            </>
          )}
        </div>
        {byline && <span>{byline}</span>}
        {metadata && <span>{metadata}</span>}
        {saved && (
          <span>
            Requested by {saved.username} ·{' '}
            <time dateTime={saved.requested_at}>{requestDate.format(new Date(saved.requested_at))}</time>
          </span>
        )}
      </div>
      {!saved && request.isError ? (
        <Button
          size="slim"
          disabled={!download}
          aria-label={`Refresh Releases for ${release.title}`}
          onClick={async () => {
            if (await refresh()) request.reset();
          }}
        >
          Refresh Releases
        </Button>
      ) : (
        <Button
          size="slim"
          disabled={!!saved || !download || request.isPending}
          aria-label={`${buttonLabel} ${release.title}`}
          onClick={() => {
            if (!saved && download && !request.isPending) request.mutate();
          }}
        >
          {buttonLabel}
        </Button>
      )}
      {!saved && request.isError && (
        <p role="alert" className={coverStyles.releaseError}>
          {invalidSelection
            ? 'This release list has changed. Refresh releases before choosing again.'
            : 'Couldn’t confirm whether this release was queued. Refresh releases before trying again.'}
        </p>
      )}
    </li>
  );
}
