import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { Account } from '../reading';
import type { components } from '../api/schema.gen';
import { session, useSession } from '../session';
import { bookPath } from '../library';
import { ErrorNotice, PageHeader } from '../ui';
import styles from './Insights.module.css';
import { Card, CardHeader, Pager, PillSelect, SectionTabs } from '../Controls';

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

function ActivityList({ account, items, timezone }: { account: Account; items: Activity[]; timezone: string }) {
  return <ul className={styles.entries}>{items.map(item => <li key={item.id}>
    <div>{item.available ? <Link to={detail(account, item.document_id)}>{item.title}</Link> : <strong>{item.title}</strong>}
      <small><time dateTime={item.started_at}>{dateLabel(item.started_at, timezone, true)}</time> · {percent(item.start_fraction)} → {percent(item.end_fraction)}</small></div>
    <strong className={styles.value}>{duration(item.duration)}</strong>
  </li>)}</ul>;
}

function Overview({ account }: { account: Account }) {
  const summary = useQuery({ staleTime: 0, refetchInterval: 30_000, queryKey: ['insights', account], queryFn: ({ signal }) => session.api.insights(account, signal) });
  const data = summary.data;
  const peak = Math.max(1, ...(data?.days.map(day => day.seconds_read) ?? []));
  return <>
    <ErrorNotice error={summary.error} />
    {summary.isPending && <p role="status">Loading your reading journal…</p>}
    {data && <>
      <Card aria-labelledby="insight-chart">
        <div className={styles.chartHeading}>
          <div>
            <h2 id="insight-chart" className={styles.kicker}>Last 30 days</h2>
            <p>{count(data.active_days, 'active day')}</p>
          </div>
          <strong className={styles.chartTotal}>{duration(data.seconds_read)} read</strong>
        </div>
        <div className={styles.chart} aria-label="Daily reading time">
          {data.days.map(day => <Link key={day.date} to={`/insights/activity?day=${day.date}`} style={{ '--bar': `${100 * day.seconds_read / peak}%` } as React.CSSProperties} aria-label={`${dateLabel(day.date)}: ${duration(day.seconds_read)}`}><span /></Link>)}
        </div>
        <div className={styles.axis}><time>{dateLabel(data.days[0]!.date)}</time><time>{dateLabel(data.days.at(-1)!.date)}</time></div>
      </Card>
      <div className={styles.streaks}>
        <section><p className={styles.kicker}>Daily streak</p><h2>{count(data.current_streak, 'day')}</h2><p>Best: {count(data.longest_streak, 'day')}</p></section>
        <section><p className={styles.kicker}>Weekly streak</p><h2>{count(data.current_week_streak, 'week')}</h2><p>Best: {count(data.longest_week_streak, 'week')}</p></section>
      </div>
    </>}
    <Rankings account={account} preview />
  </>;
}

function History({ account, view }: { account: Account; view: 'activity' | 'progress' }) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.get('page') || '1', 10) || 1));
  const requestedDay = params.get('day') ?? '';
  const day = /^\d{4}-\d\d-\d\d$/.test(requestedDay) && Number.isFinite(Date.parse(requestedDay)) && new Date(requestedDay).toISOString().slice(0, 10) === requestedDay ? requestedDay : '';
  const document = Array.from(params.get('document') ?? '').slice(0, 128).join('');
  const activity = useQuery({ enabled: view === 'activity', staleTime: 0, queryKey: ['insight-activity', account, page, day, document], queryFn: ({ signal }) => session.api.insightActivity(account, { page, ...(day ? { day } : {}), ...(document ? { document } : {}) }, signal) });
  const progress = useQuery({ enabled: view === 'progress', staleTime: 0, queryKey: ['insight-progress', account, page], queryFn: ({ signal }) => session.api.insightProgress(account, page, signal) });
  const current = view === 'activity' ? activity : progress;
  const go = (n: number) => setParams(previous => { const next = new URLSearchParams(previous); if (n === 1) next.delete('page'); else next.set('page', String(n)); return next; });
  return <section className={styles.history} aria-label={view === 'activity' ? 'Reading activity' : 'Saved progress'}>
    {view === 'activity' && (day || document) && <div className={styles.historyFilters}>
      {day && <time dateTime={day}>{dateLabel(day)}</time>}
      <Link to="/insights/activity">Clear filters</Link>
    </div>}
    <ErrorNotice error={current.error} />
    {current.isPending && <p role="status">Loading reading records…</p>}
    {current.data && !current.data.items.length && <p className={styles.muted}>No reading records {day ? 'for this day' : 'to show'}.</p>}
    {view === 'activity' && activity.data && <ActivityList account={account} items={activity.data.items} timezone={activity.data.timezone} />}
    {view === 'progress' && progress.data && <ul className={styles.entries}>{progress.data.items.map(item => <li key={item.document_id}>
      <div>{item.available ? <Link to={detail(account, item.document_id)}>{item.title}</Link> : <strong>{item.title}</strong>}
      <small><time dateTime={item.updated_at}>{dateLabel(item.updated_at, progress.data.timezone, true)}</time>{item.available && <> · <Link to={`/insights/activity?${new URLSearchParams({ document: item.document_id })}`}>Activity for this book</Link></>}</small></div>
      <strong className={styles.value}>{item.fraction == null ? 'Position saved' : percent(item.fraction)}</strong></li>)}</ul>}
    {(page > 1 || current.data?.has_more) && <Pager label="History pages" page={page} hasNext={!!current.data?.has_more && page < 100000} onPageChange={go} />}
  </section>;
}

const rankingMetrics = [['time', 'Time'], ['words', 'Words'], ['pace', 'Pace']] as const;

function Rankings({ account, preview = false }: { account: Account; preview?: boolean }) {
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
      <PillSelect aria-label="Ranking period" value={period} onChange={event => setFilter('period', event.target.value)}><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option><option value="all">All time</option></PillSelect>
    } />
    <div className={styles.metricSwitch} role="group" aria-label="Ranking metric">
      {rankingMetrics.map(([value, label]) => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setFilter('metric', value)}><span>{label}</span></button>)}
    </div>
    {!preview && <p className={styles.rankingNote}>Ranking periods use UTC. Words and pace are estimates.</p>}
    <div aria-live="polite" aria-atomic="true">
      <ErrorNotice error={result.error} />
      {result.isPending && <p className={styles.muted}>Loading rankings…</p>}
      {items && (items.length ? <ol className={styles.rankRows}>{items.map((item, i) => <li key={item.user}>
        <span aria-hidden="true" className={styles.rankNumber}>{i + 1}</span>
        <strong className={styles.rankName}>{item.user}{item.user === account.userId ? ' (you)' : ''}</strong>
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
