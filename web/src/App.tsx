import { useEffect, useLayoutEffect, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider, ScrollRestoration, useLocation, useNavigate, useRouteError } from 'react-router';
import { ReadingProvider, useReading } from './reading';
import { sameAccount } from './api/client';
import { queryClient, session, useSession } from './session';
import { Library } from './routes/Library';
import { BookDetail } from './routes/BookDetail';
import { Auth } from './routes/Auth';
import { More, Sync } from './routes/More';
import { ErrorNotice } from './ui';
import { WorkerRecovery } from './WorkerRecovery';
import { authPath, legacyDocument, retirementDestination } from './retirement';
import styles from './App.module.css';

function ReadingSession() {
  const { ready, resumeAccount } = useReading();
  useEffect(() => { if (ready) session.observeResume(resumeAccount); }, [ready, resumeAccount]);
  return null;
}
function RetirementDestination() {
  const { access, busy } = useSession();
  const { ready, resumeAccount } = useReading();
  const location = useLocation();
  const navigate = useNavigate();
  const id = legacyDocument(location.search);
  useEffect(() => {
    if (!id || busy || access.kind === 'loading') return;
    const destination = retirementDestination(id, access);
    if (destination && ready && resumeAccount && access.kind === 'authenticated' && sameAccount(resumeAccount, access.account)) navigate(destination, { replace: true });
    else if (!['/login', '/register'].includes(location.pathname)) navigate(authPath('login', id), { replace: true });
  }, [id, access, busy, ready, resumeAccount, location.pathname, navigate]);
  return null;
}
const retirementAccess = { kind: 'loading' } as const;
function Providers() {
  const state = useSession();
  const location = useLocation();
  const intent = legacyDocument(location.search);
  const pendingIntent = intent && !['/login', '/register'].includes(location.pathname);
  return <QueryClientProvider client={queryClient}>
    <ReadingProvider access={intent && state.access.kind === 'expired' ? retirementAccess : state.access} bridge={session.api.bridge} onSessionExpired={(account) => session.expire(account)}>
      <ReadingSession /><RetirementDestination />{pendingIntent ? <p role="status">Opening requested book…</p> : <Outlet />}<ScrollRestoration />
    </ReadingProvider>
  </QueryClientProvider>;
}
function Shell() {
  const { access, busy } = useSession();
  const reading = useReading();
  const location = useLocation();
  const navigate = useNavigate();
  const reader = location.pathname.startsWith('/read/');
  const recovery = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const target = recovery.current, container = main.current;
    if (!target || !container) return;
    if (!reader) { container.style.setProperty('--app-recovery-height', '0px'); return; }
    const measure = () => container.style.setProperty('--app-recovery-height', `${target.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(target); measure();
    return () => observer.disconnect();
  }, [reader]);
  useEffect(() => {
    if (!reader) document.title = `AnthoLume · ${location.pathname.startsWith('/offline') ? 'Offline' : location.pathname.startsWith('/more') ? 'More' : 'Library'}`;
  }, [location.pathname, reader]);
  useEffect(() => {
    if (!['/library', '/offline'].includes(location.pathname) || !location.search) return;
    const params = new URLSearchParams(location.search);
    if (access.kind === 'anonymous' || access.kind === 'logout') {
      params.delete('source');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, preventScrollReset: true });
    }
  }, [access.kind]);
  return <div className={`${styles.shell} ${reader ? styles.readerShell : ''}`}>
    <a className={styles.skip} href="#content">Skip to content</a>
    <aside className={styles.rail}>
      <Link to="/library" className={styles.brand}>Antho<span>Lume</span></Link>
      <nav aria-label="Main navigation" className={styles.tabs}>
        <NavLink to="/library">▤ <span>Library</span></NavLink>
        <NavLink to="/offline">↓ <span>Offline</span></NavLink>
        <a href="/" aria-label="Insights (original site)">◷ <span>Insights ↗</span></a>
        <NavLink to="/more">☰ <span>More</span></NavLink>
      </nav>
      <p className={styles.railNote}>A little space<br />for a good book.</p>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.header}><Link to="/library">Your reading space</Link><div className={styles.actions}>
        <Link to="/sync">{reading.pendingCount ? `${reading.pendingCount} pending` : reading.sync === 'idle' ? 'Sync' : reading.sync}</Link>
        {access.kind === 'authenticated' ? <Link to="/more">Account</Link> : <Link to={authPath('login', legacyDocument(location.search))}>{access.kind === 'expired' ? 'Sign in again' : 'Sign in'}</Link>}
      </div></header>
      <main ref={main} id="content" className={styles.main}>
        <div ref={recovery} className={reader ? styles.readerRecovery : undefined}>
          {busy && !reader && <p role="status">Connecting… Local books remain available.</p>}
          {reading.error && !reader && <ErrorNotice error={reading.error} />}
          <WorkerRecovery duringReading={reader} />
        </div>
        <Outlet />
      </main>
    </div>
  </div>;
}
function RouteError() {
  const error = useRouteError();
  return <main className={styles.main}><h1>This page could not open</h1><ErrorNotice error={error} /><Link to="/library">Return to Library</Link></main>;
}
const router = createBrowserRouter([{
  Component: Providers,
  ErrorBoundary: RouteError,
  children: [{ Component: Shell, children: [
    { index: true, Component: Library },
    { path: 'library', Component: Library },
    { path: 'offline', element: <Library offline /> },
    { path: 'books/:kind/:id', Component: BookDetail },
    { path: 'read/:kind/:id', lazy: () => import('./routes/ReaderRoute') },
    { path: 'login', element: <Auth mode="login" /> },
    { path: 'register', element: <Auth mode="register" /> },
    { path: 'more', Component: More },
    { path: 'sync', Component: Sync },
    { path: '*', element: <><h1>Page not found</h1><Link to="/library">Library</Link></> },
  ] }],
}], { basename: '/app' });
export function App() { return <RouterProvider router={router} />; }
