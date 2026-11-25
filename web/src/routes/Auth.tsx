import { Button } from '../Controls';
import { Brand } from '../Brand';
import { APIUnavailable } from '../api/transport';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { session, useSession } from '../session';
import { authPath, legacyDocument } from '../retirement';
import { ReadingHTTPError } from '../reading';
import { WorkerRecovery } from '../WorkerRecovery';
import styles from '../App.module.css';

export function AppLoading({ message = 'Connecting…' }: { message?: string }) {
  return (
    <main className={styles.auth}>
      <p role="status">{message}</p>
    </main>
  );
}

function authError(error: unknown, mode: 'login' | 'register') {
  if (error instanceof ReadingHTTPError) {
    switch (error.problem.code) {
      case 'unauthenticated':
        return 'The username or password is incorrect.';
      case 'csrf_failed':
        return 'The server rejected this session. Check that you opened the correct app URL, then reload and try again.';
      case 'invalid_request':
        return 'Check your username and password and try again.';
      case 'user_conflict':
        return 'That username is already in use. Choose another or sign in.';
      case 'forbidden':
        if (mode === 'register') return 'Registration is disabled on this server.';
    }
  }
  if (error instanceof APIUnavailable) return 'Could not reach the server. Check your connection and try again.';
  return mode === 'login'
    ? 'Could not sign in. Try again in a moment.'
    : 'Could not create an account. Try again in a moment.';
}

export function Auth({ mode }: { mode: 'login' | 'register' }) {
  const { capabilities, busy, access } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const intent = legacyDocument(location.search);
  const title = mode === 'login' ? 'Sign in' : 'Create an account';
  const submitLabel =
    mode === 'login' ? (submitting ? 'Signing In…' : 'Sign In') : submitting ? 'Creating Account…' : 'Create Account';
  useEffect(() => {
    document.title = `AnthoLume · ${title}`;
  }, [title]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setSubmitting(true);
    try {
      await session.authenticate(mode, String(data.get('username')), String(data.get('password')));
    } catch (failure) {
      const { session: current, error: connectionError } = session.getSnapshot();
      if ((current || !connectionError) && !(failure instanceof DOMException && failure.name === 'AbortError'))
        setError(authError(failure, mode));
    } finally {
      setSubmitting(false);
    }
  }
  if (access.kind === 'loading' && !submitting) return <AppLoading />;
  if (access.kind === 'authenticated') {
    if (!intent) return <Navigate to="/library" replace />;
    return (
      <main className={styles.auth}>
        <p role="status">Opening requested book…</p>
        <WorkerRecovery />
      </main>
    );
  }
  return (
    <main className={styles.auth}>
      <div className={styles.authBrand}>
        <Brand />
      </div>
      <h1>{title}</h1>
      {intent && <p>Sign in to open the requested shared book.</p>}
      <WorkerRecovery />
      {mode === 'register' && capabilities?.registration_enabled === false ? (
        <p>Registration is disabled on this server.</p>
      ) : (
        <form className={styles.form} onSubmit={submit} onInput={() => setError(null)}>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={256}
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              required
              maxLength={256}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && (
            <p role="alert" className={styles.authError}>
              {error}
            </p>
          )}
          <Button type="submit" tone="primary" disabled={busy || submitting}>
            {submitLabel}
          </Button>
        </form>
      )}
      {mode === 'login' && capabilities?.registration_enabled && (
        <Link to={authPath('register', intent)}>Create an account</Link>
      )}
      {mode === 'register' && <Link to={authPath('login', intent)}>Already have an account? Sign in</Link>}
    </main>
  );
}
