import { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { components } from './api/schema.gen';
import { apiOrigin, createAPI, sameAccount } from './api/client';
import type { Account, ReadingAccess } from './reading';

type S = components['schemas'];
const logoutKey = 'antholume:logout-pending';
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 300_000 } } });
type Snapshot = { session: S['Session'] | null; capabilities: S['Capabilities'] | null; access: ReadingAccess; error: string | null; busy: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not contact the server.';

class SessionCoordinator {
  private snapshot: Snapshot = { session: null, capabilities: null, access: { kind: 'loading' }, error: null, busy: false };
  private listeners = new Set<() => void>();
  private generation = 0;
  private resume: Account | null = null;
  private pendingLogout = false;
  private storageBlocked = false;
  private channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('antholume:session');
  readonly api = createAPI({
    token: () => this.snapshot.session?.csrf_token ?? null,
    epoch: () => this.generation,
    assert: (account, epoch) => {
      const access = this.snapshot.access;
      if (epoch !== this.generation || access.kind !== 'authenticated' || !sameAccount(account, access.account)) throw new DOMException('Account changed', 'AbortError');
    },
    expired: (account) => this.expire(account),
  });
  constructor() {
    try { this.pendingLogout = localStorage.getItem(logoutKey) === '1'; } catch { this.storageBlocked = true; }
    this.channel?.addEventListener('message', () => { void this.bootstrap(); });
    window.addEventListener('storage', (event) => {
      if (event.key === logoutKey) {
        this.pendingLogout = event.newValue === '1';
        void this.bootstrap();
      }
    });
    window.addEventListener('online', () => { void this.bootstrap(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !this.snapshot.busy) void this.bootstrap(); });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish(value: Partial<Snapshot>, fence = false) {
    if (fence) {
      this.generation++;
      void queryClient.cancelQueries();
      queryClient.clear();
    }
    this.snapshot = { ...this.snapshot, ...value };
    this.listeners.forEach((listener) => listener());
  }
  private eligible(): Account | null {
    const access = this.snapshot.access;
    if (access.kind === 'logout' || this.pendingLogout) return null;
    return access.kind === 'authenticated' || access.kind === 'expired' ? access.account : this.resume;
  }
  private retainedAccess(previous: Account | null): ReadingAccess {
    if (this.pendingLogout) return this.snapshot.access.kind === 'logout' ? this.snapshot.access : { kind: 'anonymous' };
    if (this.storageBlocked) return { kind: 'anonymous' };
    const account = previous ?? this.resume;
    return account ? { kind: 'expired', account } : { kind: 'anonymous' };
  }
  observeResume(account: Account | null) {
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
    this.publish({ session: null, access: { kind: 'expired', account }, error: 'Your session expired. Stored books still work; sign in to synchronize.' }, true);
  }
  async bootstrap() {
    try { this.pendingLogout = localStorage.getItem(logoutKey) === '1'; } catch { this.storageBlocked = true; }
    if (this.pendingLogout) {
      const access = this.snapshot.access;
      this.resume = null;
      if (access.kind === 'authenticated' || access.kind === 'expired') this.publish({ access: { kind: 'logout', account: access.account } }, true);
    }
    const previous = this.storageBlocked ? null : this.eligible();
    this.publish({ busy: true, session: null, access: this.snapshot.access.kind === 'logout' ? this.snapshot.access : { kind: 'loading' }, error: null }, true);
    const epoch = this.generation;
    try {
      let session = await this.api.session();
      if (epoch !== this.generation) return;
      this.publish({ session });
      if (this.pendingLogout) {
        if (session.user) session = await this.api.logout();
        if (epoch !== this.generation) return;
      }
      const account = session.user && !this.storageBlocked && !this.pendingLogout ? { origin: apiOrigin, userId: session.user.id } : null;
      this.publish({ session, busy: false, access: account ? { kind: 'authenticated', account } : this.retainedAccess(previous), error: this.storageBlocked ? 'Browser storage is unavailable. Automatic account access is disabled; sign in explicitly.' : null });
      try {
        const capabilities = await this.api.capabilities();
        if (epoch === this.generation) this.publish({ capabilities });
      } catch {
        if (epoch === this.generation) this.publish({ capabilities: null, error: 'Server feature discovery is unavailable. Existing books remain usable.' });
      }
    } catch (error) {
      if (epoch !== this.generation) return;
      this.publish({ busy: false, session: null, error: message(error), access: this.retainedAccess(previous) });
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
      this.publish({ session, busy: false, access: { kind: 'authenticated', account: { origin: apiOrigin, userId: session.user.id } } });
      this.channel?.postMessage('changed');
    } catch (error) {
      if (epoch === this.generation) this.publish({ busy: false, access: oldAccess.kind === 'authenticated' ? { kind: 'expired', account: oldAccess.account } : oldAccess, error: message(error) });
      throw error;
    }
  }
  async updateTimezone(account: Account, timezone: string) {
    const epoch = this.generation;
    const current = await this.api.updatePreferences(account, timezone);
    if (epoch !== this.generation || current.user?.id !== account.userId) throw new DOMException('Account changed', 'AbortError');
    this.publish({ session: current });
    void queryClient.invalidateQueries({ predicate: query => ['insights', 'insight-activity', 'insight-progress'].includes(String(query.queryKey[0])) });
    this.channel?.postMessage('session');
  }
  async changePassword(account: Account, body: S['PasswordChange']) {
    const epoch = this.generation;
    const current = await this.api.changePassword(account, body);
    if (epoch !== this.generation || current.user?.id !== account.userId) throw new DOMException('Account changed', 'AbortError');
    this.publish({ session: current });
    this.channel?.postMessage('session');
  }
  async logout() {
    const account = this.eligible();
    this.pendingLogout = true;
    try { localStorage.setItem(logoutKey, '1'); } catch { this.storageBlocked = true; }
    this.resume = null;
    const session = this.snapshot.session;
    this.publish({ access: account ? { kind: 'logout', account } : { kind: 'anonymous' }, busy: false, error: null }, true);
    this.channel?.postMessage('changed');
    const epoch = this.generation;
    try {
      if (!session) throw new Error('Offline sign-out is fenced. Reconnect to invalidate the server session.');
      const anonymous = await this.api.logout();
      if (epoch !== this.generation) return;
      this.publish({ session: anonymous });
    } catch (error) {
      if (epoch === this.generation) this.publish({ session: null, error: this.storageBlocked ? 'Browser storage is blocked. Close this app before sharing the device and reconnect to finish server sign-out.' : message(error) });
    }
  }
}
export const session = new SessionCoordinator();
export const useSession = () => useSyncExternalStore(session.subscribe, session.getSnapshot);
