import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import type { Account } from '../reading';
import type { components } from '../api/schema.gen';
import { Button, Dropdown, IconButton } from '../Controls';
import { Icon } from '../Icon';
import { SkeletonRows } from '../Skeleton';
import { ErrorNotice } from '../ui';
import { session } from '../session';
import { AdminSectionTabs } from './Administration';
import styles from './AdminLogs.module.css';

type Level = components['schemas']['AdminLogLevel'];
const levels: Record<Level, string> = { trace: 'Trace', debug: 'Debug', info: 'Info', warn: 'Warning', error: 'Error', fatal: 'Fatal', panic: 'Panic' };
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export function AdminLogs() {
  const { account } = useOutletContext<{ account: Account }>();
  const [level, setLevel] = useState<Level | ''>('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const client = useQueryClient();
  const loadMore = useRef<HTMLButtonElement>(null);
  const queryKey = ['admin-logs', account, level, term] as const;
  const logs = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => session.api.adminLogs(account, { cursor: pageParam, q: term || undefined, level: level || undefined }, signal),
    getNextPageParam: page => page.next_cursor,
    staleTime: Infinity,
  });
  const { fetchNextPage, hasNextPage, isFetching, isFetchNextPageError } = logs;
  const lastPage = logs.data?.pages.at(-1);
  const entries = logs.data?.pages.flatMap(page => page.entries) ?? [];
  const canAutoLoad = Boolean(lastPage?.entries.length) && hasNextPage && !isFetching && !isFetchNextPageError;

  useEffect(() => {
    const target = loadMore.current;
    if (!target || !canAutoLoad || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void fetchNextPage({ cancelRefetch: false });
    }, { rootMargin: '0px 0px 160px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [canAutoLoad, fetchNextPage]);

  return <section aria-label="Logs">
    <div className={styles.sticky}>
      <AdminSectionTabs />
      <div role="group" aria-label="Log controls" className={styles.filters}>
        <form className={styles.searchForm} onSubmit={event => { event.preventDefault(); setTerm(search.trim()); }}>
          <input type="search" aria-label="Search log events" placeholder="Search logs" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} />
          <button type="submit" aria-label="Search Logs" title="Search Logs"><Icon name="search" size={17} /></button>
        </form>
        <Dropdown aria-label="Log level" value={level} onChange={event => { setLevel(event.target.value as Level | ''); }}>
          <option value="">All levels</option>
          {Object.entries(levels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </Dropdown>
        <IconButton aria-label="Refresh Logs" title="Refresh Logs" disabled={logs.isFetching} onClick={() => void client.resetQueries({ queryKey, exact: true })}><Icon name="refresh" size={17} /></IconButton>
      </div>
    </div>
    <ErrorNotice error={logs.error} />
    {logs.isPending && <SkeletonRows label="Loading logs…" count={4} />}
    {logs.data && <>
      {entries.length === 0 && <p className={styles.summary} role="status">{hasNextPage ? 'No matches yet. Load older logs to keep searching.' : term || level ? 'No matching events.' : 'No log entries.'}</p>}
      {entries.length > 0 && <ul className={styles.entries} aria-label="Log events" key={JSON.stringify([level, term])}>
          {entries.map((entry, i) => <li key={i}>
            <details>
              <summary className={styles.event}>
                <span className={styles.level} data-level={entry.level}>{levels[entry.level]}</span>
                <strong>{entry.message}</strong>
                <time dateTime={entry.time}>{date.format(new Date(entry.time))}</time>
              </summary>
              <pre className={styles.details} aria-label="Log entry details" tabIndex={0}>{entry.details}</pre>
            </details>
          </li>)}
      </ul>}
      {hasNextPage && <div className={styles.more}>
        <Button ref={loadMore} size="slim" disabled={isFetching} onClick={() => void fetchNextPage({ cancelRefetch: false })}>
          {logs.isFetchingNextPage ? 'Loading Older Logs…' : isFetchNextPageError ? 'Retry Loading Older Logs' : 'Load Older Logs'}
        </Button>
      </div>}
    </>}
  </section>;
}
