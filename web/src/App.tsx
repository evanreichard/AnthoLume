import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Link, Navigate, NavLink, Outlet, RouterProvider, ScrollRestoration, useLocation, useNavigate, useParams, useRouteError } from 'react-router';
import { ReadingProvider, useReading } from './reading';
import { sameAccount } from './api/client';
import { queryClient, session, useSession } from './session';
import { Library } from './routes/Library';
import { BookDetail } from './routes/BookDetail';
import { AppLoading, Auth } from './routes/Auth';
import { Insights } from './routes/Insights';
import { Settings, Sync } from './routes/More';
import { useBookRef } from './routes/bookRef';
import { ErrorNotice } from './ui';
import { Icon } from './Icon';
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
      <ReadingSession />
      <RetirementDestination />
      {pendingIntent ? <AppLoading message="Opening requested book…" /> : <Outlet />}
      <ScrollRestoration />
    </ReadingProvider>
  </QueryClientProvider>;
}
function subscribeNetwork(change: () => void) {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
}

function ProtectedApp() {
  const { access } = useSession();
  const offline = useSyncExternalStore(subscribeNetwork, () => !navigator.onLine);
  const reading = useReading();
  const { kind, id } = useParams();
  const ref = useBookRef();
  const navigate = useNavigate();
  const offlineDeepLink = offline && !!id && (kind === 'server' || kind === 'local');
  const checkingBook = offlineDeepLink && access.kind === 'anonymous' && !reading.ready && !reading.error && reading.update === 'idle';
  // Book routes resolve only this ref; the reader owns saved-copy availability and permissions.
  const resumeBook = offlineDeepLink && access.kind === 'expired' && !!ref;
  const needsLogin = access.kind !== 'loading' && access.kind !== 'authenticated' && !checkingBook && !resumeBook;
  useEffect(() => {
    // Durable Resume - ReadingSession can select the retained account in this same commit.
    if (needsLogin && session.getSnapshot().access === access) navigate('/login', { replace: true });
  }, [needsLogin, access, navigate]);

  if (access.kind === 'loading') return <AppLoading />;
  if (access.kind === 'authenticated') return <Shell />;
  if (checkingBook) return <AppLoading message="Checking for a saved book…" />;
  if (resumeBook) return <Shell offline />;
  return null;
}

function Shell({ offline = false }: { offline?: boolean }) {
  const reading = useReading();
  const location = useLocation();
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
    if (!reader) document.title = `AnthoLume · ${location.pathname.startsWith('/offline') ? 'Offline' : location.pathname.startsWith('/settings') ? 'Settings' : location.pathname.startsWith('/insights') ? 'Insights' : 'Library'}`;
  }, [location.pathname, reader]);
  return <div className={`${styles.shell} ${reader ? styles.readerShell : ''}`}>
    {!offline && <>
      <a className={styles.skip} href="#content">Skip to content</a>
      <aside className={styles.rail}>
        <Link to="/library" className={styles.brand}>Antho<span>Lume</span></Link>
        <nav aria-label="Main navigation" className={styles.tabs}>
          <NavLink to="/library"><i className={styles.tabIcon}><Icon name="library" /></i><span>Library</span></NavLink>
          <NavLink to="/insights"><i className={styles.tabIcon}><Icon name="insights" /></i><span>Insights</span></NavLink>
          <NavLink to="/settings"><i className={styles.tabIcon}><Icon name="settings" /></i><span>Settings</span></NavLink>
        </nav>
      </aside>
    </>}
    <div className={offline ? undefined : styles.workspace}>
      <main ref={main} id="content" className={styles.main}>
        <div ref={recovery} className={reader ? styles.readerRecovery : undefined}>
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
  HydrateFallback: AppLoading,
  children: [
    { path: 'login', element: <Auth key="login" mode="login" /> },
    { path: 'register', element: <Auth key="register" mode="register" /> },
    { Component: ProtectedApp, children: [
      { index: true, element: <Navigate to="/library" replace /> },
      { path: 'library', Component: Library },
      { path: 'offline', element: <Library offline /> },
      { path: 'books/:kind/:id', Component: BookDetail },
      { path: 'read/:kind/:id', lazy: () => import('./routes/ReaderRoute') },
      { path: 'insights', Component: Insights },
      { path: 'insights/activity', element: <Insights view="activity" /> },
      { path: 'insights/progress', element: <Insights view="progress" /> },
      { path: 'insights/rankings', element: <Insights view="rankings" /> },
      { path: 'settings', Component: Settings },
      { path: 'more', element: <Navigate to="/settings" replace /> },
      { path: 'sync', Component: Sync },
      { path: '*', element: <><h1>Page not found</h1><Link to="/library">Library</Link></> },
    ] },
  ],
}], { basename: '/app' });
export function App() { return <RouterProvider router={router} />; }
