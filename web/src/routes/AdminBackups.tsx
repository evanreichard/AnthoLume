import { useId, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type Account } from '../reading';
import { Button, ButtonLink, Card, CardHeader, Disclosure, JoinedAction, JoinedActions } from '../Controls';
import { Icon } from '../Icon';
import { session } from '../session';
import { Dialog, ErrorNotice } from '../ui';
import { SkeletonRows } from '../Skeleton';
import styles from '../App.module.css';
import backup from './AdminBackups.module.css';

type Kind = 'full_backup' | 'backup';
type Job = components['schemas']['AdminJob'];
const kinds: Kind[] = ['full_backup', 'backup'];
const titles = { full_backup: 'Database & Library', backup: 'Database' };
const statuses = { running: 'Running', succeeded: 'Completed', failed: 'Failed', interrupted: 'Interrupted' };
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const jobKey = (account: Account, kind: Kind) => ['admin-jobs', account, kind] as const;

export function AdminBackups({ account, readOnly }: { account: Account; readOnly: boolean }) {
  const [dialog, setDialog] = useState<'create' | 'restore' | null>(null);
  const queries = useQueries({ queries: kinds.map(kind => ({
    queryKey: jobKey(account, kind),
    queryFn: ({ signal }: { signal: AbortSignal }) => session.api.adminJobs(account, kind, signal),
    refetchInterval: ({ state }: { state: { data?: Job[] } }) => state.data?.some(job => job.status === 'running') ? 1000 : 15_000,
  })) });
  const rows = kinds.map((kind, index) => {
    const jobs = queries[index].data ?? [];
    const saved = jobs.find(job => job.status === 'succeeded');
    return { kind, latest: jobs[0], saved, history: jobs.filter(job => job.id !== saved?.id) };
  });
  const history = rows.flatMap(row => row.history.map(job => ({ kind: row.kind, job })))
    .sort((a, b) => b.job.started_at.localeCompare(a.job.started_at));
  const running = rows.some(row => row.latest?.status === 'running');
  const loading = queries.some(query => query.isPending);
  const error = queries.find(query => query.error)?.error;
  const close = () => setDialog(null);

  return <Card density="compact" aria-labelledby="database-backup">
    <CardHeader id="database-backup" title="Backup & Restore" action={!readOnly && <JoinedActions label="Backup actions" size="slim">
      <JoinedAction aria-label="Create Backup" title="Create Backup" onClick={() => setDialog('create')}><Icon name="download" size={16} /></JoinedAction>
      <JoinedAction aria-label="Restore Backup" title="Restore Backup" onClick={() => setDialog('restore')}><Icon name="upload" size={16} /></JoinedAction>
    </JoinedActions>} />
    <ErrorNotice error={error} />
    {loading && <SkeletonRows label="Loading snapshots…" count={1} />}
    {!loading && !error && rows.every(row => !row.saved) && <p>No snapshots yet.</p>}
    <div role="status">
      {rows.map(({ kind, saved }) => saved && <div className={styles.settingsRow} key={kind}>
        <div><strong>{titles[kind]}</strong><p><time dateTime={saved.finished_at ?? saved.started_at}>{date.format(new Date(saved.finished_at ?? saved.started_at))}</time></p></div>
        <ButtonLink size="slim" aria-label={`Download ${titles[kind]} backup`} href={kind === 'full_backup' ? '/api/v1/admin/backup?full=true' : '/api/v1/admin/backup'} download><Icon name="download" size={16} /> Download</ButtonLink>
      </div>)}
      {rows.map(({ kind, latest }) => latest && latest.status !== 'succeeded' && <p key={latest.id}>{titles[kind]}: {statuses[latest.status]}</p>)}
    </div>
    {history.length > 0 && <div className={styles.disclosureInset}><Disclosure inset title="Backup history">
      <ul>{history.map(({ kind, job }) => <li key={job.id}><span>{titles[kind]} · <time dateTime={job.started_at}>{date.format(new Date(job.started_at))}</time></span><span className={styles.jobStatus} data-status={job.status}>{statuses[job.status]}</span></li>)}</ul>
    </Disclosure></div>}
    {dialog === 'create' && <CreateBackup account={account} running={running} close={close} />}
    {dialog === 'restore' && <RestoreBackup account={account} close={close} />}
  </Card>;
}

function formatBookSize(bytes: number) {
  const MiB = 1 << 20;
  if (bytes > 0 && bytes < MiB) return '< 1 MiB';
  const inGiB = bytes >= 1024 * MiB;
  const amount = bytes / (inGiB ? 1024 * MiB : MiB);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: inGiB ? 2 : 1 }).format(amount)} ${inGiB ? 'GiB' : 'MiB'}`;
}

function CreateBackup({ account, running, close }: { account: Account; running: boolean; close: () => void }) {
  const groupId = useId();
  const [kind, setKind] = useState<Kind>('full_backup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const client = useQueryClient();
  const full = kind === 'full_backup';
  const preview = useQuery({ queryKey: ['admin-backup-preview', account], queryFn: ({ signal }) => session.api.previewAdminBackup(account, signal) });
  async function start() {
    setBusy(true);
    setError(null);
    try {
      await session.api.startAdminJob(account, kind);
      await client.invalidateQueries({ queryKey: jobKey(account, kind) });
      close();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <Dialog title="Create Backup" onClose={() => { if (!busy) close(); }} footer={<>
    <Button size="slim" tone="primary" disabled={busy || running || full && (!preview.data || preview.isError || preview.isFetching)} onClick={() => void start()}>{busy ? 'Starting…' : 'Create'}</Button>
    <Button size="slim" disabled={busy} onClick={close}>Cancel</Button>
  </>}>
    <div className={styles.manageForm}>
      <fieldset className={backup.choices} disabled={busy}>
        <legend>Backup contents</legend>
        {kinds.map(value => {
          const descriptionId = `${groupId}-${value}`;
          const includesLibrary = value === 'full_backup';
          return <label className={backup.choice} key={value}>
            <input type="radio" name={groupId} value={value} checked={kind === value} aria-label={titles[value]} aria-describedby={descriptionId}
              onChange={() => { setKind(value); setError(null); }} />
            <span className={backup.copy}>
              <span>{titles[value]}</span>
              <span id={descriptionId} className={backup.description}>
                {includesLibrary ? 'Database, managed books, and covers.' : 'No book files or covers.'}
              </span>
              {includesLibrary && <span className={backup.description} role="status">
                {preview.data ? `${preview.data.files} book files · ${formatBookSize(preview.data.bytes)}${preview.data.missing ? ` · ${preview.data.missing} missing` : ''}` : preview.isPending ? 'Checking Library files…' : 'Library estimate unavailable.'}
              </span>}
            </span>
          </label>;
        })}
      </fieldset>
      {running && <p>A backup is already running.</p>}
      <ErrorNotice error={error || (full && preview.error)} />
    </div>
  </Dialog>;
}

function RestoreBackup({ account, close }: { account: Account; close: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [candidate, setCandidate] = useState<components['schemas']['AdminRestore'] | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function restore(apply: boolean) {
    setBusy(true); setError(null);
    try {
      if (apply && candidate && confirm === 'RESTORE') {
        await session.api.applyAdminRestore(account, { token: candidate.token });
        window.location.assign('/app/login');
      } else if (!apply && file) {
        const staged = await session.api.stageAdminRestore(account, file);
        setCandidate(staged);
      }
    } catch (failure) {
      const code = failure instanceof ReadingHTTPError ? failure.problem.code : '';
      setError(code === 'incompatible_restore_database' ? new Error('The database is damaged, has no administrator, or does not match this server’s schema.') : code === 'server_busy' ? new Error('The server is busy. Wait for other requests and jobs to finish, then retry.') : code === 'invalid_restore_archive' ? new Error('Choose a valid AnthoLume backup.') : failure);
    } finally { setBusy(false); }
  }
  return <Dialog title={candidate ? 'Confirm Restore' : 'Restore Backup'} onClose={() => { if (!busy) close(); }} footer={<>
    {candidate
      ? <Button size="slim" tone="danger" disabled={confirm !== 'RESTORE' || busy} onClick={() => void restore(true)}>Restore backup</Button>
      : <Button size="slim" tone="primary" disabled={!file || busy} onClick={() => void restore(false)}>{busy ? 'Validating…' : 'Validate'}</Button>}
    <Button size="slim" disabled={busy} onClick={close}>Cancel</Button>
  </>}>
    <div className={styles.manageForm}>
      {candidate ? <>
        <p>{candidate.files ? `${candidate.files} library files will be restored.` : 'No library files are included.'} The server saves a recovery snapshot and signs everyone out.</p>
        <label>Type RESTORE to confirm<input autoComplete="off" value={confirm} disabled={busy} onChange={event => setConfirm(event.target.value)} /></label>
      </> : <>
        <label>Backup file<input type="file" accept=".zip,.db" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(null); }} /></label>
        <p>Validate checks the backup without changing your library.</p>
      </>}
      <ErrorNotice error={error} />
    </div>
  </Dialog>;
}
