import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { session, useSession } from '../session';
import { authPath, legacyDocument } from '../retirement';
import { ErrorNotice } from '../ui';
import styles from '../App.module.css';

export function Auth({ mode }: { mode: 'login' | 'register' }) {
  const { capabilities, busy, access } = useSession();
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const intent = legacyDocument(location.search);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    try {
      await session.authenticate(mode, String(data.get('username')), String(data.get('password')));
      form.reset();
      if (!intent) navigate('/library', { replace: true });
    } catch (failure) { setError(failure); }
  }
  return <section className={styles.auth}>
    <p className={styles.eyebrow}>Your reading, together</p><h1>{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
    {intent && <p role="status">{access.kind === 'authenticated' ? 'Opening requested book…' : 'Sign in to resume the requested shared book. No previous account’s book information is shown here.'}</p>}
    {access.kind === 'expired' && <p>Sign in to the same account to resume synchronization. Your stored books and unsent events have been retained.</p>}
    {mode === 'register' && capabilities?.registration_enabled === false ? <p>Registration is disabled on this server.</p> : <form className={styles.form} onSubmit={submit}>
      <label>Username<input name="username" autoComplete="username" required maxLength={256} autoCapitalize="none" spellCheck={false} /></label>
      <label>Password<input type="password" name="password" required maxLength={256} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      <ErrorNotice error={error} /><button className={styles.primary} disabled={busy || !!intent && access.kind === 'authenticated'}>{busy ? 'Connecting…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
    </form>}
    {mode === 'login' && capabilities?.registration_enabled && <Link to={authPath('register', intent)}>Create an account</Link>}
    {mode === 'register' && <Link to={authPath('login', intent)}>Already have an account? Sign in</Link>}
    <p>Local books work without an account. <Link to="/library">Return to Library</Link></p>
  </section>;
}
