import { Button } from '../Controls';
import { Brand } from '../Brand';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { session, useSession } from '../session';
import { authPath, legacyDocument } from '../retirement';
import { ErrorNotice } from '../ui';
import { WorkerRecovery } from '../WorkerRecovery';
import styles from '../App.module.css';

export function AppLoading({ message = 'Connecting…' }: { message?: string }) {
  return <main className={styles.auth}><p role="status">{message}</p></main>;
}

export function Auth({ mode }: { mode: 'login' | 'register' }) {
  const { capabilities, busy, access } = useSession();
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const intent = legacyDocument(location.search);
  const title = mode === 'login' ? 'Sign in' : 'Create an account';
  useEffect(() => { document.title = `AnthoLume · ${title}`; }, [title]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setSubmitting(true);
    try {
      await session.authenticate(mode, String(data.get('username')), String(data.get('password')));
    } catch (failure) { setError(failure); }
    finally { setSubmitting(false); }
  }
  if (access.kind === 'loading' && !submitting) return <AppLoading />;
  if (access.kind === 'authenticated') {
    if (!intent) return <Navigate to="/library" replace />;
    return <main className={styles.auth}><p role="status">Opening requested book…</p><WorkerRecovery /></main>;
  }
  return <main className={styles.auth}>
    <div className={styles.authBrand}><Brand /></div>
    <h1>{title}</h1>
    {intent && <p>Sign in to open the requested shared book.</p>}
    <WorkerRecovery />
    {mode === 'register' && capabilities?.registration_enabled === false ? <p>Registration is disabled on this server.</p> : <form className={styles.form} onSubmit={submit}>
      <label>Username<input name="username" autoComplete="username" required maxLength={256} autoCapitalize="none" spellCheck={false} /></label>
      <label>Password<input type="password" name="password" required maxLength={256} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      <ErrorNotice error={error} /><Button type="submit" tone="primary" disabled={busy || submitting}>{busy || submitting ? 'Connecting…' : mode === 'login' ? 'Sign in' : 'Create account'}</Button>
    </form>}
    {mode === 'login' && capabilities?.registration_enabled && <Link to={authPath('register', intent)}>Create an account</Link>}
    {mode === 'register' && <Link to={authPath('login', intent)}>Already have an account? Sign in</Link>}
  </main>;
}
