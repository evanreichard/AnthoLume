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
import { Settings } from './routes/More';
import { Administration, AdminUsers, AdminLibrary, AdminSystem } from './routes/Administration';
import { AdminLogs } from './routes/AdminLogs';
import { ErrorNotice, PageHeader } from './ui';
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
  if (access.kind === 'loading') return <p role="status">Connecting…</p>;
  return access.kind === 'authenticated' ? <Outlet /> : null;
}

function Shell() {
  const reading = useReading();
  const location = useLocation();
  const reader = location.pathname.startsWith('/read/');
  const { access } = useSession();
  const showShell = access.kind === 'authenticated';
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
  }, [reader, showShell]);
  useEffect(() => {
    if (!reader && showShell) document.title = `AnthoLume · ${location.pathname.startsWith('/settings') ? 'Settings' : location.pathname.startsWith('/insights') ? 'Insights' : 'Library'}`;
  }, [location.pathname, reader, showShell]);
  if (!showShell) return <Outlet />;
  return <div className={`${styles.shell} ${reader ? styles.readerShell : ''}`}>
      <a className={styles.skip} href="#content">Skip to content</a>
      <aside className={styles.rail}>
        <Link to="/library" className={styles.brand}>Antho<span>Lume</span></Link>
        <nav aria-label="Main navigation" className={styles.tabs}>
          <NavLink to="/library"><i className={styles.tabIcon}><Icon name="library" /></i><span>Library</span></NavLink>
          <NavLink to="/insights"><i className={styles.tabIcon}><Icon name="insights" /></i><span>Insights</span></NavLink>
          <NavLink to="/settings" data-section-active={location.pathname.startsWith('/admin') || undefined}><i className={styles.tabIcon}><Icon name="settings" /></i><span>Settings</span></NavLink>
        </nav>
      </aside>
    <div className={styles.workspace}>
      <main ref={main} id="content" className={styles.main}>
        <div ref={recovery} className={reader ? styles.readerRecovery : undefined}>
          {reading.error && !reader && <ErrorNotice error={reading.error} />}
          {reading.notice && !reader && <p role="status" className={styles.notice}>{reading.notice}</p>}
          <WorkerRecovery duringReading={reader} />
        </div>
        <Outlet />
      </main>
    </div>
  </div>;
}
function RouteError() {
  const error = useRouteError();
  return <><PageHeader title="This page could not open" /><ErrorNotice error={error} /><Link to="/library">Return to Library</Link></>;
}
const router = createBrowserRouter([{
  Component: Providers,
  HydrateFallback: AppLoading,
  children: [
    { path: 'login', element: <Auth key="login" mode="login" /> },
    { path: 'register', element: <Auth key="register" mode="register" /> },
    { Component: Shell, children: [
      { Component: ProtectedApp, ErrorBoundary: RouteError, children: [
      { index: true, element: <Navigate to="/library" replace /> },
      { path: 'library', Component: Library },
      { path: 'books/:kind', Component: BookDetail },
      { path: 'read/:kind', lazy: () => import('./routes/ReaderRoute') },
      { path: 'insights', Component: Insights },
      { path: 'insights/activity', element: <Insights view="activity" /> },
      { path: 'insights/progress', element: <Insights view="progress" /> },
      { path: 'insights/rankings', element: <Insights view="rankings" /> },
      { path: 'settings', Component: Settings },
      { path: 'admin', Component: Administration, children: [
        { index: true, element: <Navigate to="library" replace /> },
        { path: 'library', Component: AdminLibrary },
        { path: 'users', Component: AdminUsers },
        { path: 'system', Component: AdminSystem },
        { path: 'logs', Component: AdminLogs },
      ] },
      { path: '*', element: <><PageHeader title="Page not found" /><Link to="/library">Library</Link></> },
      ] },
    ] },
  ],
}]);
export function App() { return <RouterProvider router={router} />; }
