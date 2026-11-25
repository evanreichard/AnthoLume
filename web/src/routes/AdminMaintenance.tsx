import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { Account } from '../reading';
import { Button, Card, CardHeader, Disclosure } from '../Controls';
import { ErrorNotice } from '../ui';
import { session } from '../session';
import { adminJobsKey, adminJobsOptions } from '../adminQueries';
import styles from '../App.module.css';

const tasks = {
  statistics: 'Refresh Reading Statistics',
  database_check: 'Check Database Integrity',
} as const;
type Kind = keyof typeof tasks;
const kinds = Object.keys(tasks) as Kind[];
const labels = { running: 'Running', succeeded: 'Completed', failed: 'Failed', interrupted: 'Interrupted' };
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function AdminMaintenance({ account }: { account: Account }) {
  const client = useQueryClient();
  const histories = useQueries({
    queries: kinds.map((kind) => ({
      ...adminJobsOptions(account, kind),
      refetchInterval: (query: { state: { data?: { status: string }[] } }) =>
        query.state.data?.some((job) => job.status === 'running') ? 1000 : 15_000,
    })),
  });
  const [starting, setStarting] = useState<Kind | null>(null);
  const [error, setError] = useState<unknown>(null);
  const recent = histories
    .flatMap((result) => result.data ?? [])
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 20);
  const active = starting !== null || histories.some((result) => result.data?.some((job) => job.status === 'running'));
  async function start(kind: Kind) {
    setStarting(kind);
    setError(null);
    try {
      await session.api.startAdminJob(account, kind);
      await client.invalidateQueries({ queryKey: adminJobsKey(account, kind) });
    } catch (err) {
      setError(err);
    } finally {
      setStarting(null);
    }
  }

  return (
    <Card density="compact" aria-labelledby="admin-maintenance-heading">
      <CardHeader id="admin-maintenance-heading" title="Maintenance" />
      <div className={styles.settingsCardRows}>
        {kinds.map((kind, i) => {
          const result = histories[i];
          const latest = result.data?.[0];
          const running = latest?.status === 'running' || starting === kind;
          return (
            <div className={styles.settingsRow} key={kind}>
              <div>
                <strong>{tasks[kind]}</strong>
                <p role="status">
                  {running ? (
                    'Running…'
                  ) : latest ? (
                    <>
                      Last ran on <time dateTime={latest.started_at}>{date.format(new Date(latest.started_at))}</time> ·{' '}
                      {labels[latest.status]}
                    </>
                  ) : result.isPending ? (
                    'Loading…'
                  ) : result.isError ? (
                    'Run history unavailable'
                  ) : (
                    'Never run'
                  )}
                </p>
              </div>
              <Button
                size="slim"
                aria-label={tasks[kind]}
                disabled={active || result.isPending}
                onClick={() => void start(kind)}
              >
                Run
              </Button>
            </div>
          );
        })}
      </div>
      <ErrorNotice error={error || histories.find((result) => result.error)?.error} />
      <div className={styles.disclosureInset}>
        <Disclosure inset title="Recent Jobs">
          {recent.length ? (
            <ul>
              {recent.map((job) => (
                <li key={job.id}>
                  <span>
                    {tasks[job.kind as Kind]} ·{' '}
                    <time dateTime={job.started_at}>{date.format(new Date(job.started_at))}</time>
                  </span>
                  <span className={styles.jobStatus} data-status={job.status}>
                    {labels[job.status]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{histories.some((result) => result.isPending) ? 'Loading jobs…' : 'No maintenance jobs yet.'}</p>
          )}
        </Disclosure>
      </div>
    </Card>
  );
}
