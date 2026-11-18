import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useReading, type Conflict } from '../reading';
import { session, useSession } from '../session';
import { bookKey } from '../library';
import { Dialog, ErrorNotice, PageHeader } from '../ui';
import { AccountSettings } from './AccountSettings';
import styles from '../App.module.css';

export function Settings() {
  const { session: current, capabilities, access } = useSession();
  const [logout, setLogout] = useState(false);
  const navigate = useNavigate();
  return <>
    <PageHeader title="Settings" />
    <section className={styles.panel}><h2>Account</h2><p>Signed in. Shared books synchronize with this account.</p><div className={styles.actions}>
      <button onClick={() => setLogout(true)}>Sign out</button>
      <Link className={styles.actionLink} to="/sync">Synchronization</Link>
      <Link className={styles.actionLink} to="/offline">Offline books</Link>
    </div></section>
    {access.kind === 'authenticated' && current?.user && <AccountSettings key={access.account.userId} account={access.account} timezone={current.user.timezone} readOnly={!capabilities || capabilities.demo_mode} />}
    <section className={styles.panel}><h2>Original site</h2><p>These features still open the server-rendered site. Their React migration comes later.</p><nav aria-label="Original site features" className={styles.menu}>
      <a href="/documents">Shared library tools ↗</a>
      {capabilities?.search_enabled && <a href="/search">Find & acquire books ↗</a>}
      {current?.user?.is_admin && <a href="/admin">Administration ↗</a>}
    </nav></section>
    {logout && <Dialog title="Sign out on this device?" onClose={() => setLogout(false)}><div className={styles.form}><p>Local books, shared downloads, and pending events stay on this device. To access shared downloads again, sign in to the same account. If you sign out offline, the server session is closed when you reconnect.</p><button onClick={() => { void session.logout(); navigate('/login', { replace: true }); }}>Sign out</button><button onClick={() => setLogout(false)}>Keep signed in</button></div></Dialog>}
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
    try { await reading.resolveConflict(conflict.eventId, choice, observed.server.revision); setObserved(null); }
    catch (failure) { setError(failure); setObserved(null); } finally { setBusy(false); }
  }
  const title = reading.books.find((book) => bookKey(book.ref) === bookKey(conflict.ref))?.title || 'Shared book';
  return <article className={styles.panel}><h2>{title}</h2><p>Another device changed the shared position. Neither the highest percentage nor the latest clock wins automatically.</p><p>Saved here: {conflict.local.fraction === null ? 'Position retained' : `${Math.round(conflict.local.fraction * 100)}%`}</p>
    <button onClick={() => void refresh()} disabled={busy}>Refresh shared position</button>
    {observed && <><p>Shared position: {observed.server.fraction === null ? 'No position' : `${Math.round(observed.server.fraction * 100)}%`} · revision {observed.server.revision}</p><div className={styles.actions}><button onClick={() => void choose('local')} disabled={busy}>Use this device’s position (may move backward)</button><button onClick={() => void choose('server')} disabled={busy}>Use shared position</button></div><p>A further shared change will require a fresh choice. Activity remains independent.</p></>}
    <ErrorNotice error={error} /></article>;
}
export function Sync() {
  const reading = useReading();
  const { access } = useSession();
  const [error, setError] = useState<unknown>(null);
  return <><PageHeader title="Synchronization" />
    <section className={styles.panel}><h2>{reading.sync}</h2><p>{reading.pendingCount} pending events. Books and reading checkpoints are stored by the reader, not the query cache.</p>
      {access.kind !== 'authenticated' ? <p><Link to="/login">Sign in</Link> to resume sending this account’s saved events.</p> : <button onClick={() => { setError(null); void reading.replay().catch(setError); }}>Retry synchronization</button>}
      <ErrorNotice error={error} /></section>
    {reading.conflicts.map((conflict) => <ConflictChoice key={conflict.eventId} conflict={conflict} />)}
    <section className={styles.panel}><h2>About the browser update</h2><p>The first update retires the old offline reader’s downloads, local-only imports and settings. Re-import those original EPUBs. This app’s new saved books and pending events are retained on later updates and sign-out.</p></section>
  </>;
}
