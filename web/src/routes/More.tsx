import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useReading } from '../reading';
import { session, useSession } from '../session';
import { Dialog, ErrorNotice, PageHeader } from '../ui';
import { CardHeader, Button, ButtonLink } from '../Controls';
import { AccountSettings } from './AccountSettings';
import styles from '../App.module.css';

export function Settings() {
  const { session: current, capabilities, access } = useSession();
  const { pendingCount, sync } = useReading();
  const [logout, setLogout] = useState(false);
  const navigate = useNavigate();
  const canAdminister = access.kind === 'authenticated' && current?.user?.is_admin;
  return <>
    <PageHeader title="Settings" actions={canAdminister && <ButtonLink to="/admin">Administration</ButtonLink>} />
    <div className={styles.settingsLayout}>
    {access.kind === 'authenticated' && current?.user && <AccountSettings key={access.account.userId} account={access.account} username={current.user.id} timezone={current.user.timezone} readOnly={!capabilities || capabilities.demo_mode}
      syncStatus={sync === 'idle' && pendingCount ? `${pendingCount} pending` : syncLabels[sync]} syncDetails={<SyncDetails />}
      onSignOut={() => setLogout(true)} />}
    </div>
    {logout && <Dialog title="Sign out on this device?" onClose={() => setLogout(false)}><div className={styles.form}><p>Pending progress and activity stay on this device and can sync only after you sign back into this account.</p><div className={styles.actions}><Button tone="danger" onClick={() => { void session.logout(); navigate('/login', { replace: true }); }}>Sign out</Button><Button onClick={() => setLogout(false)}>Keep signed in</Button></div></div></Dialog>}
  </>;
}
const syncLabels = {
  idle: 'Up to date', pending: 'Waiting to sync', syncing: 'Syncing…', 'auth-required': 'Sign-in required',
  'retryable-error': 'Waiting to retry', 'quota-error': 'Device storage full', blocked: 'Sync blocked',
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
  </section>;
}
