import { useEffect, useLayoutEffect, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Link, Navigate, NavLink, Outlet, RouterProvider, ScrollRestoration, useLocation, useNavigate, useRouteError } from 'react-router';
import { ReadingProvider, useReading } from './reading';
import { sameAccount } from './api/client';
import { queryClient, session, useSession } from './session';
import { Library } from './routes/Library';
import { BookDetail } from './routes/BookDetail';
import { AppLoading, Auth } from './routes/Auth';
import { Insights } from './routes/Insights';
import { Settings, Sync } from './routes/More';
import { LocalBookExport } from './routes/LocalBookExport';
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
function ProtectedApp() {
  const { access } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (access.kind !== 'loading' && access.kind !== 'authenticated' && session.getSnapshot().access === access) navigate('/login', { replace: true });
  }, [access, navigate]);
  if (access.kind === 'loading') return <AppLoading />;
  return access.kind === 'authenticated' ? <Shell /> : null;
}

function Shell() {
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
    if (!reader) document.title = `AnthoLume · ${location.pathname.startsWith('/local-book-export') ? 'Export local books' : location.pathname.startsWith('/settings') ? 'Settings' : location.pathname.startsWith('/insights') ? 'Insights' : 'Library'}`;
  }, [location.pathname, reader]);
  return <div className={`${styles.shell} ${reader ? styles.readerShell : ''}`}>
      <a className={styles.skip} href="#content">Skip to content</a>
      <aside className={styles.rail}>
        <Link to="/library" className={styles.brand}>Antho<span>Lume</span></Link>
        <nav aria-label="Main navigation" className={styles.tabs}>
          <NavLink to="/library"><i className={styles.tabIcon}><Icon name="library" /></i><span>Library</span></NavLink>
          <NavLink to="/insights"><i className={styles.tabIcon}><Icon name="insights" /></i><span>Insights</span></NavLink>
          <NavLink to="/settings"><i className={styles.tabIcon}><Icon name="settings" /></i><span>Settings</span></NavLink>
        </nav>
      </aside>
    <div className={styles.workspace}>
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
    { path: 'local-book-export', Component: LocalBookExport },
    { path: 'offline', element: <Navigate to="/local-book-export" replace /> },
    { Component: ProtectedApp, children: [
      { index: true, element: <Navigate to="/library" replace /> },
      { path: 'library', Component: Library },
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
