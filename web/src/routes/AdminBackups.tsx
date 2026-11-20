import { useId, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type Account } from '../reading';
import { Button, Card, CardHeader, JoinedAction, JoinedActions, RadioChoices } from '../Controls';
import { Icon } from '../Icon';
import { session } from '../session';
import { Dialog, ErrorNotice } from '../ui';
import { storageRootsKey } from './AdminStorage';
import styles from '../App.module.css';

type Kind = 'full_backup' | 'backup';
type PathIssue = components['schemas']['AdminBackupPathIssue'];
type PathRepair = components['schemas']['AdminBackupPathRepair'];

function catalogProblem(error: unknown) {
  return error instanceof ReadingHTTPError && error.problem.code === 'invalid_backup_catalog' ? error.problem : undefined;
}

function pathIssueMessage({ document_id, kind }: PathIssue) {
  return `Document ${document_id} has an invalid ${kind} path.`;
}

function safeRelativePath(path: string) {
  return new TextEncoder().encode(path).length <= 4096 && !/^[a-z]:/i.test(path) && !path.includes('\\') && !path.includes('\0')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export function AdminBackups({ account, readOnly }: { account: Account; readOnly: boolean }) {
  const [dialog, setDialog] = useState<'create' | 'restore' | null>(null);
  const close = () => setDialog(null);

  return <Card density="compact" aria-labelledby="database-backup">
    <CardHeader id="database-backup" title="Backup & Restore" action={!readOnly && <JoinedActions label="Backup actions" size="slim">
      <JoinedAction aria-label="Create Backup" title="Create Backup" onClick={() => setDialog('create')}><Icon name="download" size={16} /></JoinedAction>
      <JoinedAction aria-label="Restore Backup" title="Restore Backup" onClick={() => setDialog('restore')}><Icon name="upload" size={16} /></JoinedAction>
    </JoinedActions>} />
    {dialog === 'create' && <CreateBackup account={account} close={close} />}
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

function CreateBackup({ account, close }: { account: Account; close: () => void }) {
  const [kind, setKind] = useState<Kind>('full_backup');
  const [repairing, setRepairing] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const full = kind === 'full_backup';
  const preview = useQuery({ queryKey: ['admin-backup-preview', account], refetchOnMount: 'always', refetchOnWindowFocus: false, queryFn: ({ signal }) => session.api.previewAdminBackup(account, signal) });
  const problem = catalogProblem(preview.error);
  const issue = problem?.backup_path_issue;
  const downloadDisabled = repairing || preview.isFetching || !!problem || full && (!preview.data || preview.isError);

  async function repairPath(body: PathRepair) {
    setRepairing(true);
    try {
      await session.api.repairAdminBackupPath(account, body);
      const ref = { kind: 'server', account, documentId: body.document_id };
      for (const queryKey of [storageRootsKey(account), ['document', ref], ['cover', ref], ['documents', account], ['library-resume', account], ['insight-activity', account], ['insight-progress', account]]) {
        void client.invalidateQueries({ queryKey });
      }
      await preview.refetch();
      content.current?.closest('dialog')?.querySelector('h2')?.focus();
    } finally { setRepairing(false); }
  }

  function downloadBackup() {
    if (downloadDisabled) return;
    const link = document.createElement('a');
    link.href = `/api/v1/admin/backup?${new URLSearchParams({ full: String(full), account: account.userId, generation: account.readingGeneration ?? '' })}`;
    link.download = '';
    link.click();
    close();
  }
  return <Dialog title="Create Backup" layout={issue ? 'scroll-body' : 'content'} onClose={() => { if (!repairing) close(); }} footer={<>
    <Button size="slim" tone="primary" disabled={downloadDisabled} onClick={downloadBackup}>Download</Button>
    <Button size="slim" disabled={repairing} onClick={close}>Cancel</Button>
  </>}>
    <div ref={content} className={styles.manageForm}>
      <RadioChoices<Kind> legend="Backup contents" value={kind} onChange={setKind} options={[
        { value: 'full_backup', label: 'Database & Library', description: 'Database, managed books, and covers.',
          status: preview.data && !preview.isError ? `${preview.data.files} book files · ${formatBookSize(preview.data.bytes)}${preview.data.missing ? ` · ${preview.data.missing} missing` : ''}` : preview.isFetching ? 'Checking Library files…' : 'Library estimate unavailable.' },
        { value: 'backup', label: 'Database', description: 'No book files or covers.' },
      ]} />
      {issue ? <RepairBackupPath key={JSON.stringify(issue)} account={account} issue={issue} busy={repairing || preview.isFetching} onRepair={repairPath} />
        : <ErrorNotice error={(full || problem) && preview.error} />}
    </div>
  </Dialog>;
}

function RepairBackupPath({ account, issue, busy, onRepair }: { account: Account; issue: PathIssue; busy: boolean; onRepair: (body: PathRepair) => Promise<void> }) {
  const hintId = useId();
  const [action, setAction] = useState<'relink' | 'clear'>('relink');
  const [path, setPath] = useState('');
  const [rootID, setRootID] = useState('library');
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const book = issue.kind === 'book';
  const roots = useQuery({ queryKey: storageRootsKey(account), enabled: book, queryFn: ({ signal }) => session.api.adminStorageRoots(account, signal) });
  const root = roots.data?.find(root => root.id === rootID);
  const validPath = safeRelativePath(path);
  const clear = action === 'clear';
  const canRelink = validPath && (!book || (root ? root.directory_available : rootID === 'library'));
  const disabled = busy || !(clear ? confirmClear : canRelink);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setError(null);
    try {
      await onRepair(clear ? { ...issue, confirm_clear: true } : { ...issue, path, ...(book && rootID !== 'library' ? { root_id: rootID } : {}) });
    } catch (failure) { setError(failure); }
  }

  return <form className={styles.manageForm} onSubmit={submit}>
    <p role="alert" className={styles.error}>{pathIssueMessage(issue)} Repair this reference before downloading a backup.</p>
    <fieldset className={styles.settingsFields} disabled={busy}>
      <RadioChoices legend="Repair catalog path" value={action} onChange={next => { setAction(next); setConfirmClear(false); setError(null); }} options={[
        { value: 'relink', label: 'Relink to an existing file' },
        { value: 'clear', label: 'Clear the reference' },
      ]} />
      {clear ? <>
        <p>Clearing removes only the path from the catalog. It does not delete any files or reading history.</p>
        <label className={styles.settingsCheck}><input type="checkbox" checked={confirmClear} onChange={event => setConfirmClear(event.target.checked)} />I confirm clearing this {issue.kind} path.</label>
      </> : <>
        {book && <>
          <label>Storage root<select value={rootID} onChange={event => setRootID(event.target.value)}>
            <option value="library">Library</option>
            {roots.data?.filter(root => root.id !== 'library').map(root => <option key={root.id} value={root.id} disabled={!root.directory_available}>{root.label}</option>)}
          </select></label>
          <ErrorNotice error={roots.error ?? (root && !root.directory_available ? new Error('The selected storage root is unavailable.') : null)} />
        </>}
        <label>Relative file path<input value={path} required maxLength={4096} autoComplete="off" spellCheck={false} aria-describedby={hintId} aria-invalid={path !== '' && !validPath} onChange={event => setPath(event.target.value)} /></label>
        <p id={hintId}>Enter a path within {book ? 'the selected storage root' : 'the covers directory'}, using <code>/</code> between folders. Do not use absolute paths, <code>.</code>, or <code>..</code>.</p>
      </>}
    </fieldset>
    <div className={styles.backupActions}><Button size="slim" type="submit" tone={clear ? 'danger' : 'primary'} disabled={disabled}>{clear ? 'Clear path' : 'Relink path'}</Button></div>
    <ErrorNotice error={error} />
  </form>;
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
        window.location.assign('/login');
      } else if (!apply && file) {
        const staged = await session.api.stageAdminRestore(account, file);
        setCandidate(staged);
      }
    } catch (failure) {
      const problem = catalogProblem(failure);
      if (problem) {
        const message = problem.backup_path_issue ? pathIssueMessage(problem.backup_path_issue) : 'This backup has an invalid catalog path.';
        setError(new Error(`${message} Repair the catalog on the source server, then create a new backup.`));
      } else {
        const code = failure instanceof ReadingHTTPError ? failure.problem.code : '';
        setError(code === 'incompatible_restore_database' ? new Error('The database is damaged, has no administrator, or does not match this server’s schema.') : code === 'server_busy' ? new Error('The server is busy. Wait for other requests and jobs to finish, then retry.') : code === 'invalid_restore_archive' ? new Error('Choose a valid AnthoLume backup.') : failure);
      }
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
        <p>{candidate.files ? `${candidate.files} library files will be restored.` : 'No library files are included.'} Restore replaces the current database and signs everyone out. No backup is created automatically. Reading changes queued before restore stay on the device and do not sync into the restored library.</p>
        <label>Type RESTORE to confirm<input autoComplete="off" value={confirm} disabled={busy} onChange={event => setConfirm(event.target.value)} /></label>
      </> : <>
        <label>Backup file<input type="file" accept=".zip,.db" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(null); }} /></label>
        <p>Validate checks the backup without changing your library.</p>
      </>}
      <ErrorNotice error={error} />
    </div>
  </Dialog>;
}
