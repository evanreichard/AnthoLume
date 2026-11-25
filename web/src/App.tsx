import { useEffect, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createBrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  useLocation,
  useNavigate,
  useRouteError,
} from 'react-router';
import type { RouteObject } from 'react-router';
import { appRoutes, type AppRoute } from './app-routes';
import { ReadingProvider, sameAccount, useReading, type ReadingBridge } from './reading';
import { refreshLibraryResume } from './catalogQueries';
import { queryClient, session, useSession } from './session';
import { Library } from './routes/Library';
import { BookDetail } from './routes/BookDetail';
import { BookMatcher } from './routes/BookMatcher';
import { AppLoading, Auth } from './routes/Auth';
import { Insights } from './routes/Insights';
import { Settings } from './routes/More';
import { Administration, AdminUsers, AdminLibrary, AdminSystem } from './routes/Administration';
import { AdminLogs } from './routes/AdminLogs';
import { ErrorNotice, PageHeader } from './ui';
import { Icon } from './Icon';
import { Brand } from './Brand';
import { OfflinePicker, OfflineReview } from './OfflineReading';
import { WorkerRecovery } from './WorkerRecovery';
import { SnackbarProvider, useSnackbar } from './Snackbar';
import { authPath, legacyDocument, retirementDestination } from './retirement';
import styles from './App.module.css';

function ReadingSession() {
  const { ready, resumeAccount } = useReading();
  useEffect(() => {
    if (ready) session.observeResume(resumeAccount);
  }, [ready, resumeAccount]);
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
    if (
      destination &&
      ready &&
      resumeAccount &&
      access.kind === 'authenticated' &&
      sameAccount(resumeAccount, access.account)
    )
      navigate(destination, { replace: true });
    else if (!['/login', '/register'].includes(location.pathname)) navigate(authPath('login', id), { replace: true });
  }, [id, access, busy, ready, resumeAccount, location.pathname, navigate]);
  return null;
}
const retirementAccess = { kind: 'loading' } as const;
const readingBridge: ReadingBridge = {
  ...session.api.bridge,
  progressAcknowledged: (account) => {
    const { access } = session.getSnapshot();
    if (access.kind === 'authenticated' && sameAccount(access.account, account))
      void refreshLibraryResume(queryClient, account);
  },
};
function Providers() {
  const state = useSession();
  const location = useLocation();
  const intent = legacyDocument(location.search);
  const pendingIntent = intent && !['/login', '/register'].includes(location.pathname);
  return (
    <QueryClientProvider client={queryClient}>
      <ReadingProvider
        access={intent && state.access.kind === 'expired' ? retirementAccess : state.access}
        bridge={readingBridge}
        lookupCover={(ref) => queryClient.getQueryData<Blob>(['cover', ref])}
        onSessionExpired={(account) => session.expire(account)}
      >
        <ReadingSession />
        <RetirementDestination />
        {state.access.kind === 'picker' ? (
          location.pathname === '/library' ? (
            <OfflinePicker />
          ) : (
            <Navigate to="/library" replace />
          )
        ) : state.access.kind === 'offline' && ['/login', '/register'].includes(location.pathname) ? (
          <Navigate to="/library" replace />
        ) : pendingIntent ? (
          <AppLoading message="Opening requested book…" />
        ) : (
          <Outlet />
        )}
        <ScrollRestoration />
      </ReadingProvider>
    </QueryClientProvider>
  );
}
function ProtectedApp() {
  const { access } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (
      access.kind !== 'offline' &&
      access.kind !== 'loading' &&
      access.kind !== 'authenticated' &&
      session.getSnapshot().access === access
    )
      navigate('/login', { replace: true });
  }, [access, navigate]);
  if (access.kind === 'loading') return <p role="status">Connecting…</p>;
  if (access.kind === 'offline') {
    const path = location.pathname.replace(/\/+$/, '');
    if (path === '/books/server') return <Navigate to={'/read/server' + location.search} replace />;
    return ['/library', '/library/matcher', '/read/server'].includes(path) ? (
      <Outlet />
    ) : (
      <Navigate to="/library" replace />
    );
  }
  return access.kind === 'authenticated' ? <Outlet /> : null;
}

function CapabilityNotice() {
  const { capabilitiesUnavailable } = useSession();
  const { show, dismiss } = useSnackbar();
  useEffect(() => {
    if (capabilitiesUnavailable)
      show({ message: 'Couldn’t check which features are available. You can still read your books.' });
    return dismiss;
  }, [capabilitiesUnavailable, show, dismiss]);
  return null;
}

function SyncNotice({ reader }: { reader: boolean }) {
  const { notice } = useReading();
  const { show, dismiss } = useSnackbar();
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    if (!reader && notice && notice.id !== lastShown.current) {
      lastShown.current = notice.id;
      show({ message: notice.message });
    }
    return dismiss;
  }, [reader, notice, show, dismiss]);
  return null;
}

function Shell() {
  const reading = useReading();
  const location = useLocation();
  const reader = location.pathname.startsWith('/read/');
  const { access } = useSession();
  const showShell = access.kind === 'authenticated' || access.kind === 'offline';
  useEffect(() => {
    if (!reader && showShell)
      document.title = `AnthoLume · ${location.pathname.startsWith('/settings') ? 'Settings' : location.pathname.startsWith('/insights') ? 'Insights' : 'Library'}`;
  }, [location.pathname, reader, showShell]);
  if (!showShell) return <Outlet />;
  return (
    <SnackbarProvider>
      <div className={`${styles.shell} ${reader ? styles.readerShell : ''}`}>
        {access.kind === 'authenticated' && (
          <>
            <CapabilityNotice key={'capabilities:' + JSON.stringify(access.account)} />
            <SyncNotice key={'sync:' + JSON.stringify(access.account)} reader={reader} />
          </>
        )}
        <a className={styles.skip} href="#content">
          Skip to content
        </a>
        {access.kind !== 'offline' && (
          <aside className={styles.rail}>
            <Link to="/library" className={styles.brand}>
              <Brand />
            </Link>
            <nav aria-label="Main navigation" className={styles.tabs}>
              <NavLink to="/library">
                <i className={styles.tabIcon}>
                  <Icon name="library" />
                </i>
                <span>Library</span>
              </NavLink>
              <NavLink to="/insights">
                <i className={styles.tabIcon}>
                  <Icon name="insights" />
                </i>
                <span>Insights</span>
              </NavLink>
              <NavLink to="/settings" data-section-active={location.pathname.startsWith('/admin') || undefined}>
                <i className={styles.tabIcon}>
                  <Icon name="settings" />
                </i>
                <span>Settings</span>
              </NavLink>
            </nav>
          </aside>
        )}
        <div className={access.kind === 'offline' ? styles.offlineWorkspace : styles.workspace}>
          <main id="content" className={styles.main}>
            <div className={reader ? styles.readerReview : undefined}>
              {reading.error && !reader && <ErrorNotice error={reading.error} />}
              {access.kind === 'authenticated' && reading.ready && (
                <OfflineReview key={JSON.stringify(access.account)} account={access.account} />
              )}
              {!reader && <WorkerRecovery />}
            </div>
            <Outlet />
          </main>
        </div>
      </div>
    </SnackbarProvider>
  );
}
function RouteError() {
  const error = useRouteError();
  return (
    <>
      <PageHeader title="This page could not open" />
      <ErrorNotice error={error} />
      <Link to="/library">Return to Library</Link>
    </>
  );
}
const screens = {
  providers: { Component: Providers, HydrateFallback: AppLoading },
  login: { element: <Auth key="login" mode="login" /> },
  register: { element: <Auth key="register" mode="register" /> },
  shell: { Component: Shell },
  protected: { Component: ProtectedApp, ErrorBoundary: RouteError },
  home: { element: <Navigate to="/library" replace /> },
  library: { Component: Library },
  bookMatcher: { Component: BookMatcher },
  book: { Component: BookDetail },
  reader: { lazy: () => import('./routes/ReaderRoute') },
  insights: { Component: Insights },
  activity: { element: <Insights view="activity" /> },
  progress: { element: <Insights view="progress" /> },
  rankings: { element: <Insights view="rankings" /> },
  settings: { Component: Settings },
  admin: { Component: Administration },
  adminHome: { element: <Navigate to="library" replace /> },
  adminLibrary: { Component: AdminLibrary },
  users: { Component: AdminUsers },
  system: { Component: AdminSystem },
  logs: { Component: AdminLogs },
  notFound: {
    element: (
      <>
        <PageHeader title="Page not found" />
        <Link to="/library">Library</Link>
      </>
    ),
  },
} satisfies Record<
  AppRoute['id'],
  Pick<RouteObject, 'Component' | 'element' | 'lazy' | 'ErrorBoundary' | 'HydrateFallback'>
>;

function bindRoute(route: AppRoute): RouteObject {
  return 'children' in route
    ? { ...route, ...screens[route.id], children: route.children.map(bindRoute) }
    : { ...route, ...screens[route.id] };
}

const router = createBrowserRouter(appRoutes.map(bindRoute));
export function App() {
  return <RouterProvider router={router} />;
}
