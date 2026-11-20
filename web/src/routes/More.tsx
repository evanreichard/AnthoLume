import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useReading, type Conflict } from '../reading';
import { session, useSession } from '../session';
import { bookKey } from '../library';
import { Dialog, ErrorNotice, PageHeader } from '../ui';
import { ActionRow, Card, CardHeader, Button, ButtonLink } from '../Controls';
import { AccountSettings } from './AccountSettings';
import styles from '../App.module.css';

export function Settings() {
  const { session: current, capabilities, access } = useSession();
  const { books, pendingCount, sync } = useReading();
  const [logout, setLogout] = useState(false);
  const navigate = useNavigate();
  const canAdminister = access.kind === 'authenticated' && current?.user?.is_admin;
  const exportRow = books.some(book => book.ref.kind === 'local') && <ActionRow to="/local-book-export" label="Export local books" />;
  return <>
    <PageHeader title="Settings" actions={canAdminister && <ButtonLink to="/admin">Administration</ButtonLink>} />
    <div className={styles.settingsLayout}>
    {access.kind === 'authenticated' && current?.user && <AccountSettings key={access.account.userId} account={access.account} username={current.user.id} timezone={current.user.timezone} readOnly={!capabilities || capabilities.demo_mode}
      syncStatus={sync === 'idle' && pendingCount ? `${pendingCount} pending` : syncLabels[sync]} syncDetails={<SyncDetails />}
      onSignOut={() => setLogout(true)}>{exportRow}</AccountSettings>}
    {access.kind !== 'authenticated' && exportRow}
    </div>
    {logout && <Dialog title="Sign out on this device?" onClose={() => setLogout(false)}><div className={styles.form}><p>Pending progress and activity stay on this device and can sync only after you sign back into this account.</p><div className={styles.actions}><Button tone="danger" onClick={() => { void session.logout(); navigate('/login', { replace: true }); }}>Sign out</Button><Button onClick={() => setLogout(false)}>Keep signed in</Button></div></div></Dialog>}
  </>;
}
function ConflictChoice({ conflict }: { conflict: Conflict }) {
  const reading = useReading();
  const [observed, setObserved] = useState<Conflict | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError(null); setObserved(null);
    try { setObserved(await reading.refreshConflict(conflict.eventId)); } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  async function choose(choice: 'local' | 'server') {
    if (!observed) return;
    setBusy(true); setError(null);
    try { await reading.resolveConflict(conflict.eventId, choice, observed.server.revision, observed.local); setObserved(null); }
    catch (failure) { setError(failure); setObserved(null); } finally { setBusy(false); }
  }
  const title = reading.books.find((book) => bookKey(book.ref) === bookKey(conflict.ref))?.title || 'Shared book';
  return <Card as="article"><CardHeader title={title} /><p>Another device changed your reading position.</p><p>Saved here: {conflict.local.fraction === null ? 'Position retained' : `${Math.round(conflict.local.fraction * 100)}%`}</p>
    <Button size="slim" onClick={() => void refresh()} disabled={busy}>Refresh shared position</Button>
    {observed && <><p>Shared position: {observed.server.fraction === null ? 'No position' : `${Math.round(observed.server.fraction * 100)}%`} · revision {observed.server.revision}</p><div className={styles.actions}><Button size="slim" onClick={() => void choose('local')} disabled={busy}>Use this device’s position (may move backward)</Button><Button size="slim" tone="primary" onClick={() => void choose('server')} disabled={busy}>Use shared position</Button></div></>}
    <ErrorNotice error={error} /></Card>;
}
const syncLabels = {
  idle: 'Up to date', pending: 'Waiting to sync', syncing: 'Syncing…', 'auth-required': 'Sign-in required',
  'retryable-error': 'Waiting to retry', conflict: 'Needs attention', 'quota-error': 'Device storage full', blocked: 'Sync blocked',
} as const;

function SyncDetails() {
  const reading = useReading();
  const [error, setError] = useState<unknown>(null);
  return <section className={styles.inlineSync} aria-label="Sync status">
    <div className={styles.syncRow}>
      <div role="status"><CardHeader title={syncLabels[reading.sync]} subtitle={`${reading.pendingCount} pending`} /></div>
      <Button size="slim" aria-label="Retry synchronization" onClick={() => { setError(null); void reading.replay().catch(setError); }}>Retry</Button>
    </div>
    <ErrorNotice error={error} />
    {!!reading.conflicts.length && <div className={styles.settingsStack}>
      {reading.conflicts.map(conflict => <ConflictChoice key={conflict.eventId} conflict={conflict} />)}
    </div>}
  </section>;
}
