import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { Account } from '../reading';
import type { components } from '../api/schema.gen';
import { session, useSession } from '../session';
import { bookPath } from '../library';
import { ErrorNotice, PageHeader } from '../ui';
import styles from './Insights.module.css';
import { LoadingStatus, Skeleton, SkeletonRows } from '../Skeleton';
import { Button, Card, CardHeader, SectionTabs, SegmentedControl, Dropdown } from '../Controls';

type Activity = components['schemas']['InsightActivity'];
const tabs = [['', 'Overview'], ['activity', 'Activity'], ['progress', 'Progress']] as const;
type View = typeof tabs[number][0] | 'rankings';
const count = (n: number, unit: string) => `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`;
function duration(seconds: number) {
  if (!seconds) return '0 min';
  if (seconds < 60) return `${seconds} sec`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} hr${min % 60 ? ` ${min % 60} min` : ''}`;
}
const percent = (n: number) => new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(n);
const dateLabel = (date: string, timezone = 'UTC', withTime = false) => new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: 'short', day: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(date));
const detail = (account: Account, documentId: string) => bookPath({ kind: 'server', account, documentId });

function ActivityList({ account, items, timezone, hasMore }: { account: Account; items: Activity[]; timezone: string; hasMore: boolean }) {
  const date = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  const headingDate = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'full' });
  const groups = new Map<string, Activity[]>();
  for (const item of items) {
    const parts = date.formatToParts(new Date(item.started_at));
    const day = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
    const sessions = groups.get(day);
    if (sessions) sessions.push(item); else groups.set(day, [item]);
  }
  const lastDay = [...groups.keys()].at(-1);
  return [...groups].map(([day, sessions]) => <section className={styles.journalDay} key={day}>
    <header className={styles.dayHeader}>
      <h2><time dateTime={day}>{headingDate.format(new Date(day))}</time></h2>
      <span>{duration(sessions.reduce((sum, item) => sum + item.duration, 0))}{hasMore && day === lastDay ? ' loaded' : ' read'}</span>
    </header>
    <ul className={styles.entries}>{sessions.map(item => <li key={item.id}>
      <div>{item.available ? <Link to={detail(account, item.document_id)}>{item.title}</Link> : <strong>{item.title}</strong>}
        <small><time dateTime={item.started_at}>{time.format(new Date(item.started_at))}</time> · {percent(item.start_fraction)} → {percent(item.end_fraction)}</small></div>
      <strong className={styles.value}>{duration(item.duration)}</strong>
    </li>)}</ul>
  </section>);
}

function ProgressList({ account, items, timezone }: { account: Account; items: components['schemas']['InsightProgress'][]; timezone: string }) {
  return <ul className={`${styles.entries} ${styles.progressEntries}`}>{items.map(item => <li key={item.document_id}>
    <div className={styles.progressHeading}>
      {item.available ? <Link to={detail(account, item.document_id)}>{item.title}</Link> : <strong>{item.title}</strong>}
      <strong className={styles.value}>{item.fraction == null ? 'Position saved' : percent(item.fraction)}</strong>
    </div>
    {item.fraction != null && <progress className={styles.bookProgress} max={1} value={item.fraction} aria-label={`Reading progress for ${item.title}`} />}
    <small className={styles.progressMeta}><span>Last read <time dateTime={item.updated_at}>{dateLabel(item.updated_at, timezone, true)}</time></span>{item.available && <Link to={`/insights/activity?${new URLSearchParams({ document: item.document_id })}`}>Activity for this book</Link>}</small>
  </li>)}</ul>;
}

function SkeletonLine({ width }: { width: string }) {
  return <Skeleton width={width} />;
}

function StreakSkeleton({ label }: { label: string }) {
  return <section>
    <p className={styles.kicker}><SkeletonLine width={label} /></p>
    <h2><SkeletonLine width="3.75rem" /></h2>
    <p><SkeletonLine width="5.5rem" /></p>
  </section>;
}

function Overview({ account }: { account: Account }) {
  const summary = useQuery({ staleTime: 0, refetchInterval: 30_000, queryKey: ['insights', account], queryFn: ({ signal }) => session.api.insights(account, signal) });
  const data = summary.data;
  const peak = Math.max(1, ...(data?.days.map(day => day.seconds_read) ?? []));
  return <>
    <ErrorNotice error={summary.error} />
    {summary.isPending && <LoadingStatus>Loading your reading journal…</LoadingStatus>}
    {(data || summary.isPending) && <>
      <Card aria-labelledby={data ? 'insight-chart' : undefined} aria-hidden={!data || undefined}>
        <div className={styles.chartHeading}>
          <div>
            <h2 id="insight-chart" className={styles.kicker}>{data ? 'Last 30 days' : <SkeletonLine width="6rem" />}</h2>
            <p>{data ? count(data.active_days, 'active day') : <SkeletonLine width="4.75rem" />}</p>
          </div>
          <strong className={styles.chartTotal}>{data ? `${duration(data.seconds_read)} read` : <SkeletonLine width="5.25rem" />}</strong>
        </div>
        <div className={styles.chart} aria-label={data ? 'Daily reading time' : undefined}>
          {data ? data.days.map(day => <Link key={day.date} to={`/insights/activity?day=${day.date}`} style={{ '--bar': `${100 * day.seconds_read / peak}%` } as React.CSSProperties} aria-label={`${dateLabel(day.date)}: ${duration(day.seconds_read)}`}><span /></Link>)
            : Array.from({ length: 30 }, (_, index) => <Skeleton block key={index} className={styles.skeletonBar} style={{ '--bar': `${[22, 47, 32, 66, 18, 81, 38, 57, 24, 42][index % 10]}%` } as React.CSSProperties} />)}
        </div>
        <div className={styles.axis}>{data
          ? <><time>{dateLabel(data.days[0]!.date)}</time><time>{dateLabel(data.days.at(-1)!.date)}</time></>
          : <><SkeletonLine width="2.75rem" /><SkeletonLine width="2.75rem" /></>}</div>
      </Card>
      <div className={styles.streaks} aria-hidden={!data || undefined}>
        {data ? <>
          <section><p className={styles.kicker}>Daily streak</p><h2>{count(data.current_streak, 'day')}</h2><p>Best: {count(data.longest_streak, 'day')}</p></section>
          <section><p className={styles.kicker}>Weekly streak</p><h2>{count(data.current_week_streak, 'week')}</h2><p>Best: {count(data.longest_week_streak, 'week')}</p></section>
        </> : <><StreakSkeleton label="5rem" /><StreakSkeleton label="6rem" /></>}
      </div>
    </>}
    <Rankings account={account} preview />
  </>;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; });
}

function History({ account, view }: { account: Account; view: 'activity' | 'progress' }) {
  const [params] = useSearchParams();
  const requestedDay = params.get('day') ?? '';
  const day = /^\d{4}-\d\d-\d\d$/.test(requestedDay) && Number.isFinite(Date.parse(requestedDay)) && new Date(requestedDay).toISOString().slice(0, 10) === requestedDay ? requestedDay : '';
  const document = Array.from(params.get('document') ?? '').slice(0, 128).join('');
  const pagination = { initialPageParam: undefined as string | undefined, gcTime: 30 * 60_000, staleTime: 30_000, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
  const activity = useInfiniteQuery({ ...pagination, enabled: view === 'activity', queryKey: ['insight-activity', account, day, document], queryFn: ({ signal, pageParam }) => session.api.insightActivity(account, { cursor: pageParam, ...(day ? { day } : {}), ...(document ? { document } : {}) }, signal), getNextPageParam: page => page.next_cursor });
  const progress = useInfiniteQuery({ ...pagination, enabled: view === 'progress', queryKey: ['insight-progress', account], queryFn: ({ signal, pageParam }) => session.api.insightProgress(account, pageParam, signal), getNextPageParam: page => page.next_cursor });
  const activityItems = uniqueBy(activity.data?.pages.flatMap(page => page.items) ?? [], item => item.id);
  const progressItems = uniqueBy(progress.data?.pages.flatMap(page => page.items) ?? [], item => item.document_id);
  const current = view === 'activity' ? activity : progress;
  const items = view === 'activity' ? activityItems : progressItems;
  const timezone = current.data?.pages[0]?.timezone ?? 'UTC';
  const showLoad = current.hasNextPage || (current.data?.pages.length ?? 0) > 1;
  return <section className={styles.history} aria-label={view === 'activity' ? 'Reading activity' : 'Saved progress'}>
    {view === 'activity' && (day || document) && <div className={styles.historyFilters}>
      {day && <time dateTime={day}>{dateLabel(day)}</time>}
      <Link to="/insights/activity">Clear filters</Link>
    </div>}
    <ErrorNotice error={current.error} />
    {current.isPending && <SkeletonRows label="Loading reading records…" count={4} />}
    {current.data && !items.length && <p className={styles.muted}>{view === 'progress' ? 'No saved reading progress yet.' : day ? 'No reading sessions for this day.' : 'No reading sessions yet.'}</p>}
    {view === 'activity' && <ActivityList account={account} items={activityItems} timezone={timezone} hasMore={current.hasNextPage} />}
    {view === 'progress' && progressItems.length > 0 && <ProgressList account={account} items={progressItems} timezone={timezone} />}
    {showLoad && <div className={styles.loadMore}>
      <Button aria-disabled={!current.hasNextPage || current.isFetching} onClick={() => { if (current.hasNextPage && !current.isFetching) void current.fetchNextPage(); }}>
        {current.isFetchingNextPage ? 'Loading…' : !current.hasNextPage ? (view === 'activity' ? 'All activity loaded' : 'All books loaded') : current.isFetchNextPageError ? 'Try again' : view === 'activity' ? 'Load older activity' : 'Load more books'}
      </Button>
      <span className={styles.srOnly} role="status">{count(items.length, view === 'activity' ? 'session' : 'book')} shown</span>
    </div>}
  </section>;
}

const rankingMetrics = [['time', 'Time'], ['words', 'Words'], ['pace', 'Pace']] as const;

function Rankings({ account, preview = false }: { account: Account; preview?: boolean }) {
  const username = useSession().session?.user?.id;
  const [params, setParams] = useSearchParams();
  const choice = params.get('metric'), range = params.get('period');
  const metric = choice === 'words' || choice === 'pace' ? choice : 'time';
  const period = range === 'week' || range === 'year' || range === 'all' ? range : 'month';
  const setFilter = (name: 'metric' | 'period', value: string) => {
    // Keep rapid filter changes from overwriting one another before the router rerenders.
    const next = new URLSearchParams(window.location.search);
    next.set(name, value);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const result = useQuery({ queryKey: ['insight-rankings', account, period, metric], queryFn: ({ signal }) => session.api.insightRankings(account, { period, metric }, signal) });
  const items = preview ? result.data?.items.slice(0, 3) : result.data?.items;
  const fullPath = `/insights/rankings?${new URLSearchParams({ metric, period })}`;
  const Frame = preview ? Card : 'section';
  return <Frame className={styles.rankings} aria-labelledby="ranking-title">
    <CardHeader id="ranking-title" title="Rankings" action={
      <Dropdown size="slim" aria-label="Ranking period" value={period} onChange={event => setFilter('period', event.target.value)}><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="year">Last 365 days</option><option value="all">All time</option></Dropdown>
    } />
    <SegmentedControl className={styles.metricSwitch} label="Ranking metric" options={rankingMetrics} value={metric} onChange={value => setFilter('metric', value)} />
    {!preview && <p className={styles.rankingNote}>Words and pace are estimates.</p>}
    <div aria-live="polite" aria-atomic="true">
      <ErrorNotice error={result.error} />
      {result.isPending && <>
        <LoadingStatus>Loading rankings…</LoadingStatus>
        <ol className={styles.rankRows} aria-hidden="true">{['6rem', '5rem', '7rem'].map(width => <li key={width}>
          <Skeleton block className={styles.rankNumber} />
          <SkeletonLine width={width} />
          <SkeletonLine width="3rem" />
        </li>)}</ol>
      </>}
      {items && (items.length ? <ol className={styles.rankRows}>{items.map((item, i) => <li key={item.user}>
        <span aria-hidden="true" className={styles.rankNumber}>{i + 1}</span>
        <strong className={styles.rankName}>{item.user}{item.user === username ? ' (you)' : ''}</strong>
        <strong className={styles.value}>{metric === 'time' ? duration(item.value) : `${item.value.toLocaleString()} ${metric === 'words' ? 'words' : 'wpm'}`}</strong>
      </li>)}</ol> : <p className={styles.muted}>No rankings for this selection.</p>)}
    </div>
    {preview && <Link className={styles.fullRankings} to={fullPath}>View full rankings <span aria-hidden="true">→</span></Link>}
  </Frame>;
}

export function Insights({ view = '' }: { view?: View }) {
  const { access } = useSession();
  return <>
    <PageHeader title="Insights" />
    <SectionTabs label="Insights sections" items={tabs.map(([route, label]) => ({ to: route ? `/insights/${route}` : '/insights', label }))} />
    {access.kind !== 'authenticated' ? <p>Connect and sign in to see your synced reading records.</p> : view === '' ? <Overview account={access.account} /> : view === 'rankings' ? <Rankings account={access.account} /> : <History account={access.account} view={view} />}
  </>;
}
