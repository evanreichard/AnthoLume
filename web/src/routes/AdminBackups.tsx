import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type Account } from '../reading';
import { Button, Card, CardHeader, JoinedAction, JoinedActions, RadioChoices } from '../Controls';
import { Icon } from '../Icon';
import { session } from '../session';
import { Dialog, ErrorNotice } from '../ui';
import styles from '../App.module.css';

type Kind = 'full_backup' | 'backup';

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
  const full = kind === 'full_backup';
  const preview = useQuery({ queryKey: ['admin-backup-preview', account], queryFn: ({ signal }) => session.api.previewAdminBackup(account, signal) });
  function downloadBackup() {
    const link = document.createElement('a');
    link.href = `/api/v1/admin/backup?${new URLSearchParams({ full: String(full), account: account.userId, generation: account.readingGeneration ?? '' })}`;
    link.download = '';
    link.click();
    close();
  }
  return <Dialog title="Create Backup" onClose={close} footer={<>
    <Button size="slim" tone="primary" disabled={full && (!preview.data || preview.isError || preview.isFetching)} onClick={downloadBackup}>Download</Button>
    <Button size="slim" onClick={close}>Cancel</Button>
  </>}>
    <div className={styles.manageForm}>
      <RadioChoices<Kind> legend="Backup contents" value={kind} onChange={setKind} options={[
        { value: 'full_backup', label: 'Database & Library', description: 'Database, managed books, and covers.',
          status: preview.data ? `${preview.data.files} book files · ${formatBookSize(preview.data.bytes)}${preview.data.missing ? ` · ${preview.data.missing} missing` : ''}` : preview.isPending ? 'Checking Library files…' : 'Library estimate unavailable.' },
        { value: 'backup', label: 'Database', description: 'No book files or covers.' },
      ]} />
      <ErrorNotice error={full && preview.error} />
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
        window.location.assign('/login');
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
