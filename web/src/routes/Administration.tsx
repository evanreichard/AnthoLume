import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useOutletContext } from 'react-router';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type Account } from '../reading';
import { session, useSession } from '../session';
import { Dialog, ErrorNotice } from '../ui';
import { ActionRow, Card, CardHeader, CompactPill, CompactPillLink, Disclosure, PillSelect, SectionTabs, WorkspaceHeader } from '../Controls';
import { Icon } from '../Icon';
import styles from '../App.module.css';

type User = components['schemas']['AdminUser'];
type UserAction = { kind: 'create' } | { kind: 'edit' | 'delete'; user: User };

const tabs = [['library', 'Library'], ['users', 'Users'], ['system', 'System']] as const;
type AdminContext = { account: Account; readOnly: boolean };

export function Administration() {
  const { access, session: current, capabilities } = useSession();
  const context: AdminContext | null = access.kind === 'authenticated' && current?.user?.is_admin
    ? { account: access.account, readOnly: !capabilities || capabilities.demo_mode }
    : null;
  return <>
    <WorkspaceHeader title="Administration" backTo="/settings" backLabel="Settings" />
    {context ? <>
      <SectionTabs label="Administration sections" items={tabs.map(([path, label]) => ({ to: `/admin/${path}`, label }))} />
      <div className={styles.sectionContent}><Outlet context={context} /></div>
    </> : <p>Administrator access is required.</p>}
  </>;
}

export function AdminLibrary() {
  const context = useOutletContext<AdminContext>();
  return <div className={styles.settingsLayout}><AdminImport {...context} /><AdminBackups {...context} /></div>;
}

function AdminImport({ account, readOnly }: AdminContext) {
  const client = useQueryClient();
  const [directory, setDirectory] = useState('');
  const [reference, setReference] = useState(false);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const queryKey = ['admin-jobs', account, 'import'] as const;
  const jobs = useQuery({ queryKey, queryFn: ({ signal }) => session.api.adminJobs(account, 'import', signal), refetchInterval: query => query.state.data?.some(job => job.status === 'running') ? 1000 : false });
  const latest = jobs.data?.[0];
  const results = useQuery({ queryKey: ['admin-import-results', account, latest?.id], enabled: latest?.status === 'succeeded', queryFn: ({ signal }) => session.api.adminImportResults(account, latest!.id, signal) });
  async function run(start: boolean) {
    setBusy(true); setError(null);
    try {
      if (start) {
        await session.api.startAdminJob(account, 'import', { directory, reference });
        setPreview(null);
        await client.invalidateQueries({ queryKey });
      } else setPreview(await session.api.previewAdminImport(account, directory));
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  return <Card density="compact" aria-labelledby="admin-import-heading">
      <CardHeader id="admin-import-heading" title="Import books" />
      <p>EPUBs from the server’s <code>imports</code> folder</p>
      <form className={styles.manageForm} onSubmit={event => { event.preventDefault(); void run(false); }}>
        <label>Subfolder<input value={directory} maxLength={512} placeholder="All imports" onChange={event => { setDirectory(event.target.value); setPreview(null); }} /></label>
        <label className={styles.settingsCheck}><input type="checkbox" checked={reference} onChange={event => { setReference(event.target.checked); setPreview(null); }} /> Reference in place</label>
        <div className={styles.backupActions}><CompactPill type="submit" disabled={busy}>Preview import</CompactPill>
          {!!preview?.length && <CompactPill tone="primary" disabled={readOnly || busy || latest?.status === 'running'} onClick={() => void run(true)}>Start import</CompactPill>}</div>
      </form>
      <ErrorNotice error={error || jobs.error || results.error} />
      {preview?.length === 0 && <p>No EPUBs found.</p>}
      <div className={styles.disclosureInset}><Disclosure inset title="Import options"><p>Enter a subfolder relative to <code>imports</code>. Referenced EPUBs stay in place and are excluded from backups.</p></Disclosure></div>
      {!!preview?.length && <Disclosure inset title={preview.length === 1 ? '1 EPUB ready to review' : `${preview.length} EPUBs ready to review`}><ul>{preview.map(file => <li key={file}>{file}</li>)}</ul></Disclosure>}
      {latest && <div className={styles.adminCardDetails}>
        <p role="status">{latest.status === 'running' ? 'Import running…' : latest.status === 'succeeded' ? 'Import finished' : `Import ${latest.status}`}</p>
        {results.data && <Disclosure inset title={results.data.length === 1 ? '1 file result' : `${results.data.length} file results`}><ul>{results.data.map(row => <li key={row.file}><span>{row.file}</span><strong>{row.status}</strong></li>)}</ul></Disclosure>}
      </div>}
    </Card>;
}

function AdminBackups({ account, readOnly }: AdminContext) {
  const [databaseOnly, setDatabaseOnly] = useState(false);
  return <Card density="compact" aria-labelledby="database-backup">
    <CardHeader id="database-backup" title="Backup & restore" action={<PillSelect aria-label="Backup contents" value={databaseOnly ? 'database' : 'full'} onChange={event => setDatabaseOnly(event.target.value === 'database')}>
      <option value="full">Full library</option><option value="database">Database only</option>
    </PillSelect>} />
    <AdminJobs key={String(databaseOnly)} account={account} canRefresh={!readOnly} kind={databaseOnly ? 'backup' : 'full_backup'} />
    {!readOnly && <div className={styles.adminCardDetails}><RestoreBackup account={account} /></div>}
  </Card>;
}

function RestoreBackup({ account }: { account: Account }) {
  const [file, setFile] = useState<File | null>(null);
  const [candidate, setCandidate] = useState<components['schemas']['AdminRestore'] | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function restore(apply: boolean) {
    setBusy(true); setError(null);
    try {
      if (apply && candidate && confirm === 'RESTORE') {
        await session.api.applyAdminRestore(account, candidate);
        window.location.assign('/app/login');
      } else if (!apply && file) setCandidate(await session.api.stageAdminRestore(account, file));
    } catch (failure) {
      const code = failure instanceof ReadingHTTPError ? failure.problem.code : '';
      setError(code === 'incompatible_restore_database' ? new Error('The database is damaged, has no administrator, or does not match this server’s schema.') : code === 'server_busy' ? new Error('The server is busy. Wait for other requests and jobs to finish, then retry.') : code === 'invalid_restore_archive' ? new Error('Choose a valid AnthoLume backup.') : failure);
    } finally { setBusy(false); }
  }
  return <Disclosure inset title="Restore a backup">
    <div className={styles.manageForm}>
      <label>Backup file<input type="file" accept=".zip,.db" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setCandidate(null); setConfirm(''); setError(null); }} /></label>
      <div><CompactPill disabled={!file || busy} onClick={() => void restore(false)}>{busy && !candidate ? 'Validating…' : 'Validate backup'}</CompactPill></div>
      <ErrorNotice error={!candidate ? error : null} />
    </div>
    {candidate && <Dialog title="Confirm restore" onClose={() => { if (!busy) setCandidate(null); }}>
      <div className={styles.form}>
        <p>{candidate.files ? `${candidate.files} library files will be restored.` : 'No library files are included.'} The server saves a recovery snapshot and signs everyone out.</p>
        <label>Type RESTORE to confirm<input autoComplete="off" value={confirm} disabled={busy} onChange={event => setConfirm(event.target.value)} /></label>
        <ErrorNotice error={error} />
        <div className={styles.actions}><button className={styles.dangerPill} disabled={confirm !== 'RESTORE' || busy} onClick={() => void restore(true)}>Restore backup</button><button className={styles.pillAction} disabled={busy} onClick={() => setCandidate(null)}>Cancel</button></div>
      </div>
    </Dialog>}
  </Disclosure>;
}

export function AdminSystem() {
  const { account, readOnly } = useOutletContext<AdminContext>();
  return <div className={styles.settingsLayout}><SystemDetails account={account} /><AdminJobs account={account} canRefresh={!readOnly} /></div>;
}

function AdminJobs({ account, canRefresh, kind = 'statistics' }: { account: Account; canRefresh: boolean; kind?: 'statistics' | 'backup' | 'full_backup' }) {
  const client = useQueryClient();
  const queryKey = ['admin-jobs', account, kind] as const;
  const jobs = useQuery({ queryKey, queryFn: ({ signal }) => session.api.adminJobs(account, kind, signal), refetchInterval: query => query.state.data?.some(job => job.status === 'running') ? 1000 : 15_000 });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const labels = { running: 'Running', succeeded: 'Completed', failed: 'Failed', interrupted: 'Interrupted' };
  async function refresh() {
    setStarting(true); setError(null);
    try { await session.api.startAdminJob(account, kind); await client.invalidateQueries({ queryKey }); }
    catch (failure) { setError(failure); }
    finally { setStarting(false); }
  }
  if (kind === 'backup' || kind === 'full_backup') {
    const full = kind === 'full_backup';
    const [latest, ...earlier] = jobs.data ?? [];
    const saved = jobs.data?.find(job => job.status === 'succeeded');
    const running = starting || latest?.status === 'running';
    const formatDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return <>
      <p>{full ? 'Database, books & covers' : 'Database only · no library files'}</p>
      <div className={styles.backupLatest} aria-live="polite">
        <div>
          <strong>{saved ? 'Latest snapshot' : jobs.isPending ? 'Checking for backups…' : jobs.isError && !latest ? 'Backup status unavailable' : 'No snapshot available'}</strong>
          {saved && <time dateTime={saved.finished_at ?? saved.started_at}>{formatDate(saved.finished_at ?? saved.started_at)}</time>}
        </div>
        {latest && <span className={styles.jobStatus} data-status={latest.status}>{latest.status === 'succeeded' ? labels.succeeded : `Latest run: ${labels[latest.status].toLowerCase()}`}</span>}
      </div>
      <ErrorNotice error={error || jobs.error} />
      {(canRefresh || saved) && <div className={styles.backupActions}>
        {saved && <CompactPillLink tone="primary" href={full ? '/api/v1/admin/backup?full=true' : '/api/v1/admin/backup'} download><Icon name="download" size={16} /> Download backup</CompactPillLink>}
        {canRefresh && <CompactPill tone={saved ? undefined : 'primary'} disabled={running} onClick={() => void refresh()}>{running ? 'Creating…' : 'Create backup'}</CompactPill>}
      </div>}
      <div className={styles.disclosureInset}>
        {full && <Disclosure inset title="What’s included"><p>Managed EPUBs and covers are included. Referenced files and server configuration are excluded.</p></Disclosure>}
        {earlier.length > 0 && <Disclosure inset title={`Earlier runs (${earlier.length})`}>
          <ul>{earlier.map(job => <li key={job.id}><time dateTime={job.started_at}>{formatDate(job.started_at)}</time><span className={styles.jobStatus} data-status={job.status}>{labels[job.status]}</span></li>)}</ul>
        </Disclosure>}
      </div>
    </>;
  }
  const latestStatus = jobs.data?.[0]?.status;
  return <div className={styles.settingsStack}>
    {canRefresh && <Card aria-labelledby="admin-maintenance-heading">
      <CardHeader id="admin-maintenance-heading" title="Maintenance" subtitle="Reading statistics"
        action={<CompactPill aria-label="Refresh statistics" disabled={starting || jobs.data?.some(job => job.status === 'running')} onClick={() => void refresh()}>Refresh</CompactPill>} />
      <ErrorNotice error={error} />
    </Card>}
    <Card aria-label="Recent jobs">
      <Disclosure inset title="Recent jobs" trailing={latestStatus && <span className={styles.jobStatus} role="status" data-status={latestStatus}>{labels[latestStatus]}</span>}>
      <ErrorNotice error={jobs.error} />
      {jobs.isPending && <p className={styles.settingsCardFeedback} role="status">Loading jobs…</p>}
      {jobs.data?.length === 0 && <p className={styles.settingsCardFeedback}>No maintenance jobs yet.</p>}
      {!!jobs.data?.length && <div className={styles.settingsCardRows}>{jobs.data.map(job => <div className={styles.settingsRow} key={job.id}>
        <div><strong>Statistics refresh</strong><p><time dateTime={job.started_at}>{new Date(job.started_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></p></div>
        <span className={styles.jobStatus} role="status" data-status={job.status}>{labels[job.status]}</span>
      </div>)}</div>}
      </Disclosure>
    </Card>
  </div>;
}

function SystemDetails({ account }: { account: Account }) {
  const info = useQuery({ queryKey: ['admin-system', account], queryFn: ({ signal }) => session.api.adminSystem(account, signal) });
  return <Card aria-labelledby="admin-server-heading">
    <CardHeader id="admin-server-heading" title="Server" />
    <ErrorNotice error={info.error} />
    {info.isPending && <p className={styles.settingsCardFeedback} role="status">Loading server details…</p>}
    {info.data && <p className={styles.settingsCardFeedback}>Version: {info.data.version || 'Development build'}</p>}
    <div className={styles.disclosureInset}><AdminLogs account={account} /></div>
  </Card>;
}

function AdminLogs({ account }: { account: Account }) {
  const [filter, setFilter] = useState('');
  const logs = useQuery({ queryKey: ['admin-logs', account], queryFn: ({ signal }) => session.api.adminLogs(account, signal) });
  const visible = logs.data?.filter(row => `${row.level} ${row.operation}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return <Disclosure inset title="Recent server logs">
    <label className={styles.manageForm}>Filter logs<input type="search" value={filter} onChange={event => setFilter(event.target.value)} /></label>
    <ErrorNotice error={logs.error} />
    {visible?.length === 0 && <p>No matching log entries.</p>}
    <ul>{visible?.map((row, index) => <li key={index}><span>{row.operation} · {row.level}</span><time dateTime={row.time}>{new Date(row.time).toLocaleString()}</time></li>)}</ul>
  </Disclosure>;
}

export function AdminUsers() {
  const { account, readOnly } = useOutletContext<AdminContext>();
  return <UserList key={account.userId} account={account} readOnly={readOnly} />;
}

function UserList({ account, readOnly }: { account: Account; readOnly: boolean }) {
  const client = useQueryClient();
  const queryKey = ['admin-users', account] as const;
  const users = useInfiniteQuery({ queryKey, initialPageParam: '', queryFn: ({ pageParam, signal }) => session.api.adminUsers(account, pageParam, signal), getNextPageParam: page => page.length > 50 ? page[49]?.id : undefined });
  const [action, setAction] = useState<UserAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  function select(value: UserAction) { setError(null); setNotice(''); setAction(value); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy || readOnly) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      if (action.kind === 'create') {
        const created = await session.api.createAdminUser(account, { username: String(data.get('username')), password: String(data.get('password')), is_admin: data.has('admin') });
        setNotice(`Created ${created.id}.`);
      } else if (action.kind === 'edit') {
        const password = String(data.get('password'));
        const admin = data.has('admin');
        if (!password && admin === action.user.is_admin) { setAction(null); return; }
        await session.api.updateAdminUser(account, action.user.id, { ...(password ? { password } : {}), ...(admin !== action.user.is_admin ? { is_admin: admin } : {}) });
        setNotice(`Updated ${action.user.id}.`);
      } else {
        if (String(data.get('confirm')) !== action.user.id) throw new Error('Enter the exact username to confirm.');
        await session.api.deleteAdminUser(account, action.user.id);
        setNotice(`Deleted ${action.user.id}.`);
      }
      setAction(null);
      await client.invalidateQueries({ queryKey });
    } catch (failure) {
      const code = failure instanceof ReadingHTTPError ? failure.problem.code : '';
      setError(code === 'user_conflict' ? new Error('That username already exists.') : code === 'current_admin' ? new Error('You cannot change your own account here.') : failure);
    } finally { setBusy(false); }
  }
  const accounts = users.data?.pages.flatMap(page => page.slice(0, 50));
  return <section className={styles.settingsGroup} aria-labelledby="admin-users-heading">
    <div className={`${styles.settingsHeading} ${styles.userListHeading}`}>
      <h2 id="admin-users-heading">Users {accounts && <span className={styles.settingsCount}>{accounts.length}{users.hasNextPage ? '+' : ''}</span>}</h2>
      <button type="button" className={`${styles.pillAction} ${styles.pillIcon}`} aria-label="Create user" title="Create user" disabled={readOnly} onClick={() => select({ kind: 'create' })}><span><Icon name="add" size={16} /></span></button>
    </div>
    {notice && <p role="status">{notice}</p>}
    {readOnly && <p>Account changes are unavailable in this deployment.</p>}
    <ErrorNotice error={users.error} />
    {users.isPending && <p role="status">Loading users…</p>}
    {accounts && <ul className={`${styles.settingsSurface} ${styles.userList}`}>{accounts.map(user => {
      const own = user.id === account.userId;
      const identity = <span className={styles.userIdentity}>
        <span><strong>{user.id}</strong>{own && <small className={styles.userSelf}>You</small>}</span>
        <small>{user.is_admin ? 'Administrator' : 'Member'}</small>
      </span>;
      return <li key={user.id}>{own || readOnly
        ? <div className={styles.userRow}>{identity}</div>
        : <ActionRow label={identity} aria-label={`Manage ${user.id}`} onClick={() => select({ kind: 'edit', user })} />}</li>;
    })}</ul>}
    {users.hasNextPage && <button className={styles.pillAction} disabled={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>Load more users</button>}
    {action && <Dialog key={action.kind} title={action.kind === 'create' ? 'Create user' : action.kind === 'edit' ? `Manage ${action.user.id}` : `Delete ${action.user.id}?`} onClose={() => { if (!busy) setAction(null); }}>
      <form className={styles.form} onSubmit={submit}>
        <fieldset className={styles.settingsFields} disabled={busy}>
          {action.kind === 'delete' ? <><p>Deletes this account and its reading history, not shared books. A recovery snapshot is saved first.</p><label>Type {action.user.id} to confirm<input name="confirm" autoComplete="off" required /></label></> : <>
            {action.kind === 'create' && <label>Username<input name="username" autoComplete="off" maxLength={128} required /></label>}
            <label>{action.kind === 'create' ? 'Password' : 'New password (optional)'}<input name="password" type="password" autoComplete="new-password" maxLength={256} required={action.kind === 'create'} /></label>
            {action.kind === 'edit' && <p>A new password signs this user out.</p>}
            <label className={styles.settingsCheck}><input name="admin" type="checkbox" defaultChecked={action.kind === 'edit' && action.user.is_admin} /> Administrator</label>
          </>}
        </fieldset>
        {action.kind === 'edit' && <button type="button" className={`${styles.rowAction} ${styles.rowActionDanger}`} disabled={busy} aria-label={`Delete ${action.user.id}`} onClick={() => select({ kind: 'delete', user: action.user })}>Delete account</button>}
        <ErrorNotice error={error} />
        <div className={styles.actions}><button className={action.kind === 'delete' ? styles.dangerPill : styles.filledPill} disabled={busy}>{busy ? 'Working…' : action.kind === 'delete' ? 'Delete user' : action.kind === 'create' ? 'Create account' : 'Save changes'}</button><button type="button" className={styles.pillAction} disabled={busy} onClick={() => setAction(null)}>Cancel</button></div>
      </form>
    </Dialog>}
  </section>;
}
