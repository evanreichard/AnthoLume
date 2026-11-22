import { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { components } from './api/schema.gen';
import { apiOrigin, createAPI, sameAccount, SessionUnavailable } from './api/client';
import type { Account, ReadingAccess } from './reading';

type S = components['schemas'];
const sessionAccount = (user: NonNullable<S['Session']['user']>): Account => ({ origin: apiOrigin, userId: user.account_id, readingGeneration: user.reading_generation });
import { profiles, rememberProfile, selectProfile, selectedProfile, forgetProfile, isProfileKey } from './offlineProfiles';
const unreachable = (error: unknown) => error instanceof SessionUnavailable || error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError';
const logoutKey = 'antholume:logout-pending';
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 300_000 } } });
type Snapshot = { session: S['Session'] | null; capabilities: S['Capabilities'] | null; access: ReadingAccess; error: string | null; busy: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not contact the server.';

class SessionCoordinator {
  private snapshot: Snapshot = { session: null, capabilities: null, access: { kind: 'loading' }, error: null, busy: false };
  private listeners = new Set<() => void>();
  private generation = 0;
  private refresh: AbortController | null = null;
  private resume: Account | null = null;
  private readerAccount: Account | null = null;
  private reconnect?: ReturnType<typeof setTimeout>;
  private pendingLogout = false;
  private storageBlocked = false;
  private channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('antholume:session');
  readonly api = createAPI({
    token: () => this.snapshot.session?.csrf_token ?? null,
    disconnected: () => { if (!this.refresh && this.snapshot.access.kind === 'authenticated') void this.checkSession(); },
    epoch: () => this.generation,
    assert: (account, epoch) => {
      const access = this.snapshot.access;
      if (epoch !== this.generation || access.kind !== 'authenticated' || !sameAccount(account, access.account)) throw new DOMException('Account changed', 'AbortError');
    },
    expired: (account) => this.expire(account),
    changed: (account) => {
      const access = this.snapshot.access;
      if (access.kind !== 'authenticated' || !sameAccount(account, access.account)) return;
      this.expire(account);
      void this.checkSession();
    },
  });
  constructor() {
    try { this.pendingLogout = localStorage.getItem(logoutKey) === '1'; } catch { this.storageBlocked = true; }
    this.channel?.addEventListener('message', () => { void this.checkSession(); });
    window.addEventListener('storage', (event) => {
      if (isProfileKey(event.key)) {
        const access = this.snapshot.access;
        if (access.kind === 'offline' && !profiles().some(p => sameAccount(p.account, access.account))) this.chooseOffline();
        else if (access.kind === 'picker') this.publish({});
      }
      if (event.key === logoutKey) {
        this.pendingLogout = event.newValue === '1';
        void this.bootstrap();
      }
    });
    window.addEventListener('offline', () => { void this.checkSession(); });
    window.addEventListener('online', () => { void this.checkSession(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.checkSession(); });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  retainReader(account: Account) {
    this.readerAccount = account;
    return () => { if (this.readerAccount === account) this.readerAccount = null; };
  }
  private publish(value: Partial<Snapshot>, fence = false) {
    if (fence) {
      this.refresh?.abort();
      this.generation++;
      void queryClient.cancelQueries();
      queryClient.clear();
    }
    this.snapshot = { ...this.snapshot, ...value };
    clearTimeout(this.reconnect);
    if (['offline', 'picker'].includes(this.snapshot.access.kind)) this.retryOffline();
    this.listeners.forEach((listener) => listener());
  }
  private retryOffline() {
    clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => {
      if (!['offline', 'picker'].includes(this.snapshot.access.kind)) return;
      if (navigator.onLine && document.visibilityState === 'visible') void this.checkSession();
      this.retryOffline();
    }, 30_000);
  }
  private remember(account: Account | null, name?: string) {
    try {
      if (account && name) rememberProfile(account, name);
      selectProfile(null);
    } catch { this.storageBlocked = true; }
  }
  chooseOffline(account?: Account) {
    if (account && !profiles().some(p => sameAccount(p.account, account))) return;
    selectProfile(account ?? null);
    this.publish({ session: null, busy: false, access: account ? { kind: 'offline', account } : { kind: 'picker' }, error: null }, true);
  }
  forgetOffline(account: Account) { forgetProfile(account); this.chooseOffline(); }
  private eligible(): Account | null {
    const access = this.snapshot.access;
    if (access.kind === 'logout' || this.pendingLogout) return null;
    return access.kind === 'authenticated' || access.kind === 'offline' || access.kind === 'expired' ? access.account : this.resume;
  }
  private retainedAccess(previous: Account | null): ReadingAccess {
    if (this.pendingLogout) return this.snapshot.access.kind === 'logout' ? this.snapshot.access : { kind: 'anonymous' };
    if (this.storageBlocked) return { kind: 'anonymous' };
    const account = previous ?? this.resume;
    return account ? { kind: 'expired', account } : { kind: 'anonymous' };
  }
  observeResume(account: Account | null) {
    if (['offline', 'picker'].includes(this.snapshot.access.kind)) return;
    if (this.pendingLogout) {
      this.resume = null;
      if (account && this.snapshot.access.kind !== 'logout') this.publish({ access: { kind: 'logout', account } }, this.snapshot.access.kind === 'authenticated' || this.snapshot.access.kind === 'expired');
      return;
    }
    this.resume = this.storageBlocked ? null : account;
    if (!this.storageBlocked && account && !this.snapshot.busy && !this.pendingLogout && this.snapshot.access.kind === 'anonymous') {
      this.publish({ access: { kind: 'expired', account } }, true);
    }
  }
  expire(account: Account) {
    const access = this.snapshot.access;
    if (access.kind !== 'authenticated' || !sameAccount(account, access.account)) return;
    this.remember(null);
    this.publish({ session: null, access: { kind: 'expired', account }, error: 'Your session expired. Sign in to continue reading and synchronizing.' }, true);
  }
  async checkSession() {
    if (this.snapshot.busy) return;
    const access = this.snapshot.access;
    if (this.pendingLogout || access.kind !== 'authenticated' && access.kind !== 'offline') return this.bootstrap();
    this.refresh?.abort();
    const refresh = new AbortController();
    this.refresh = refresh;
    const signal = AbortSignal.any([refresh.signal, AbortSignal.timeout(10_000)]);
    try {
      const session = await this.api.session(signal);
      if (refresh.signal.aborted) return;
      const account = session.user ? sessionAccount(session.user) : null;
      if (!account) {
        this.remember(null);
        this.publish({ session, access: { kind: 'expired', account: access.account } }, true);
        return;
      }
      this.remember(account, session.user?.id);
      const same = access.kind === 'authenticated' && sameAccount(account, access.account);
      this.publish({ session, access: same ? access : { kind: 'authenticated', account }, error: null }, !same);
      if (same && !this.snapshot.capabilities) {
        try {
          const capabilities = await this.api.capabilities(signal);
          if (!refresh.signal.aborted) this.publish({ capabilities });
        } catch {
          if (!refresh.signal.aborted) this.publish({ capabilities: null, error: 'Server feature discovery is unavailable.' });
        }
      }
    } catch (error) {
      if (refresh.signal.aborted) return;
      if (unreachable(error)) {
        if (access.kind === 'offline') return;
        if (this.readerAccount && sameAccount(access.account, this.readerAccount)) {
          // Live Reader - A failed probe pauses server access without changing the open book or selecting a profile for future tabs.
          this.publish({ session: null, access: { kind: 'offline', account: access.account }, error: 'Could not verify your session. You can keep reading on this device.' }, true);
          return;
        }
        if (profiles().length) { this.chooseOffline(); return; }
      }
      this.publish({ error: message(error) });
    } finally {
      if (this.refresh === refresh) this.refresh = null;
    }
  }
  async bootstrap() {
    try { this.pendingLogout = localStorage.getItem(logoutKey) === '1'; } catch { this.storageBlocked = true; }
    if (this.pendingLogout) {
      const access = this.snapshot.access;
      this.resume = null;
      if (access.kind === 'authenticated' || access.kind === 'expired') this.publish({ access: { kind: 'logout', account: access.account } }, true);
    }
    const previous = this.storageBlocked ? null : this.eligible();
    const access = this.snapshot.access;
    const offline = access.kind === 'offline' || access.kind === 'picker';
    this.publish({ busy: true, session: null, access: offline || access.kind === 'logout' ? access : { kind: 'loading' }, error: null }, true);
    const epoch = this.generation;
    try {
      let session = await this.api.session(AbortSignal.timeout(10_000));
      if (epoch !== this.generation) return;
      this.publish({ session });
      if (this.pendingLogout) {
        if (session.user) session = await this.api.logout(sessionAccount(session.user));
        if (epoch !== this.generation) return;
      }
      const account = session.user && !this.storageBlocked && !this.pendingLogout ? sessionAccount(session.user) : null;
      this.remember(account, session.user?.id);
      this.publish({ session, busy: false, access: account ? { kind: 'authenticated', account } : this.retainedAccess(previous), error: this.storageBlocked ? 'Browser storage is unavailable. Automatic account access is disabled; sign in explicitly.' : null });
      try {
        const capabilities = await this.api.capabilities();
        if (epoch === this.generation) this.publish({ capabilities });
      } catch (error) {
        if (epoch === this.generation) {
          this.publish({ capabilities: null, error: 'Server feature discovery is unavailable. Existing books remain usable.' });
          if (account && unreachable(error)) void this.checkSession();
        }
      }
    } catch (error) {
      if (epoch !== this.generation) return;
      if (offline) this.publish({ busy: false, session: null, error: unreachable(error) ? null : message(error) });
      else if (unreachable(error) && profiles().length) this.chooseOffline(selectedProfile());
      else this.publish({ busy: false, session: null, error: message(error), access: this.retainedAccess(previous) });
    }
  }
  async authenticate(mode: 'login' | 'register', username: string, password: string) {
    if (this.pendingLogout) {
      await this.bootstrap();
      if (!this.snapshot.session || this.snapshot.session.user) throw new Error('Reconnect to finish signing out before signing in.');
      try { localStorage.removeItem(logoutKey); } catch { throw new Error('Allow browser storage before signing in after sign-out.'); }
      this.pendingLogout = false;
      this.resume = null;
    }
    if (!this.snapshot.session) await this.bootstrap();
    if (!this.snapshot.session) throw new Error('Connect to the server before signing in.');
    const oldAccess = this.snapshot.access;
    this.publish({ busy: true, access: { kind: 'loading' }, error: null }, true);
    const epoch = this.generation;
    try {
      const session = await this.api[mode]({ username, password });
      if (epoch !== this.generation) throw new DOMException('Session changed', 'AbortError');
      if (!session.user) throw new Error('The server did not authenticate the account.');
      this.remember(sessionAccount(session.user), session.user.id);
      this.publish({ session, busy: false, access: { kind: 'authenticated', account: sessionAccount(session.user) } });
      this.channel?.postMessage('changed');
    } catch (error) {
      if (epoch === this.generation) this.publish({ busy: false, access: oldAccess.kind === 'authenticated' ? { kind: 'expired', account: oldAccess.account } : oldAccess });
      throw error;
    }
  }
  async updateTimezone(account: Account, timezone: string) {
    const epoch = this.generation;
    const current = await this.api.updatePreferences(account, timezone);
    if (epoch !== this.generation || !current.user || !sameAccount(sessionAccount(current.user), account)) throw new DOMException('Account changed', 'AbortError');
    this.refresh?.abort();
    this.publish({ session: current });
    void queryClient.invalidateQueries({ predicate: query => ['insights', 'insight-activity', 'insight-progress'].includes(String(query.queryKey[0])) });
    this.channel?.postMessage('session');
  }
  async changePassword(account: Account, body: S['PasswordChange']) {
    const epoch = this.generation;
    const current = await this.api.changePassword(account, body);
    if (epoch !== this.generation || !current.user || !sameAccount(sessionAccount(current.user), account)) throw new DOMException('Account changed', 'AbortError');
    this.refresh?.abort();
    this.publish({ session: current });
    this.channel?.postMessage('session');
  }
  async logout() {
    const account = this.eligible();
    this.remember(null);
    this.pendingLogout = true;
    try { localStorage.setItem(logoutKey, '1'); } catch { this.storageBlocked = true; }
    this.resume = null;
    const session = this.snapshot.session;
    this.publish({ access: account ? { kind: 'logout', account } : { kind: 'anonymous' }, busy: false, error: null }, true);
    this.channel?.postMessage('changed');
    const epoch = this.generation;
    try {
      if (!session) throw new Error('Offline sign-out is fenced. Reconnect to invalidate the server session.');
      const anonymous = session.user ? await this.api.logout(sessionAccount(session.user)) : session;
      if (epoch !== this.generation) return;
      this.publish({ session: anonymous });
    } catch (error) {
      if (epoch === this.generation) this.publish({ session: null, error: this.storageBlocked ? 'Browser storage is blocked. Close this app before sharing the device and reconnect to finish server sign-out.' : message(error) });
    }
  }
}
export const session = new SessionCoordinator();
export const useSession = () => useSyncExternalStore(session.subscribe, session.getSnapshot);
