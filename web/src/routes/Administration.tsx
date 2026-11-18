import { useId, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useMatch, useOutletContext } from 'react-router';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type Account } from '../reading';
import { session, useSession } from '../session';
import { Dialog, ErrorNotice, PageHeader } from '../ui';
import { ActionRow, AddPill, Card, CardHeader, SectionTabs, Button } from '../Controls';
import { AdminBackups } from './AdminBackups';
import { AdminImport } from './AdminImport';
import { AdminMaintenance } from './AdminMaintenance';
import { SkeletonRows } from '../Skeleton';
import { StorageRoots, storageRootsKey, type StorageRoot } from './AdminStorage';
import styles from '../App.module.css';

type User = components['schemas']['AdminUser'];
type UserAction = { kind: 'create' } | { kind: 'edit' | 'delete'; user: User };

const tabs = [['library', 'Library'], ['users', 'Users'], ['system', 'System'], ['logs', 'Logs']] as const;
type AdminContext = { account: Account; readOnly: boolean };

export function AdminSectionTabs() {
  return <SectionTabs label="Administration sections" items={tabs.map(([path, label]) => ({ to: `/admin/${path}`, label }))} />;
}

export function Administration() {
  const logs = useMatch('/admin/logs');
  const { access, session: current, capabilities } = useSession();
  const context: AdminContext | null = access.kind === 'authenticated' && current?.user?.is_admin
    ? { account: access.account, readOnly: !capabilities || capabilities.demo_mode }
    : null;
  return <>
    <PageHeader title="Administration" />
    {context ? <>
      {logs ? <Outlet context={context} /> : <>
        <AdminSectionTabs />
        <div className={styles.sectionContent}><Outlet context={context} /></div>
      </>}
    </> : <p>Administrator access is required.</p>}
  </>;
}

export function AdminLibrary() {
  const context = useOutletContext<AdminContext>();
  const query = useQuery({ queryKey: storageRootsKey(context.account), enabled: !context.readOnly, queryFn: ({ signal }) => session.api.adminStorageRoots(context.account, signal) });
  const roots = query.data ?? [];
  return <div className={styles.settingsLayout}>
    {!context.readOnly && <StorageRoots account={context.account} roots={roots} error={query.error} />}
    <AdminImport {...context} roots={roots} />
    <AdminBackups {...context} />
  </div>;
}

export function AdminSystem() {
  const { account, readOnly } = useOutletContext<AdminContext>();
  return <div className={styles.settingsLayout}><SystemDetails account={account} /><AdminMaintenance account={account} readOnly={readOnly} /></div>;
}

function SystemDetails({ account }: { account: Account }) {
  const info = useQuery({ queryKey: ['admin-system', account], queryFn: ({ signal }) => session.api.adminSystem(account, signal) });
  return <Card aria-labelledby="admin-server-heading">
    <CardHeader id="admin-server-heading" title="Server" />
    <ErrorNotice error={info.error} />
    {info.isPending && <SkeletonRows label="Loading server details…" count={1} secondary={false} />}
    {info.data && <p className={styles.settingsCardFeedback}>Version: {info.data.version || 'Development build'}</p>}
  </Card>;
}

export function AdminUsers() {
  const { account, readOnly } = useOutletContext<AdminContext>();
  return <UserList key={account.userId} account={account} readOnly={readOnly} />;
}

function UserList({ account, readOnly }: { account: Account; readOnly: boolean }) {
  const formId = useId();
  const client = useQueryClient();
  const queryKey = ['admin-users', account] as const;
  const users = useInfiniteQuery({ queryKey, initialPageParam: '', queryFn: ({ pageParam, signal }) => session.api.adminUsers(account, pageParam, signal), getNextPageParam: page => page.length > 50 ? page[49]?.id : undefined });
  const [action, setAction] = useState<UserAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  function select(value: UserAction) { setError(null); setNotice(''); setAction(value); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy || readOnly) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      if (action.kind === 'create') {
        const created = await session.api.createAdminUser(account, { username: String(data.get('username')), password: String(data.get('password')), is_admin: data.has('admin') });
        setNotice(`Created ${created.id}.`);
      } else if (action.kind === 'edit') {
        const password = String(data.get('password'));
        const admin = data.has('admin');
        if (!password && admin === action.user.is_admin) { setAction(null); return; }
        await session.api.updateAdminUser(account, action.user.id, { ...(password ? { password } : {}), ...(admin !== action.user.is_admin ? { is_admin: admin } : {}) });
        setNotice(`Updated ${action.user.id}.`);
      } else {
        if (String(data.get('confirm')) !== action.user.id) throw new Error('Enter the exact username to confirm.');
        await session.api.deleteAdminUser(account, action.user.id);
        setNotice(`Deleted ${action.user.id}.`);
      }
      setAction(null);
      await client.invalidateQueries({ queryKey });
    } catch (failure) {
      const code = failure instanceof ReadingHTTPError ? failure.problem.code : '';
      setError(code === 'user_conflict' ? new Error('That username already exists.') : code === 'current_admin' ? new Error('You cannot change your own account here.') : failure);
    } finally { setBusy(false); }
  }
  const accounts = users.data?.pages.flatMap(page => page.slice(0, 50));
  return <Card density="compact" aria-labelledby="admin-users-heading">
    <CardHeader id="admin-users-heading" title={<>Users {accounts && <span className={styles.settingsCount}>{accounts.length}{users.hasNextPage ? '+' : ''}</span>}</>}
      action={<AddPill label="Add User" disabled={readOnly} onClick={() => select({ kind: 'create' })} />} />
    {notice && <p role="status">{notice}</p>}
    {readOnly && <p>Account changes are unavailable in this deployment.</p>}
    <ErrorNotice error={users.error} />
    {users.isPending && <SkeletonRows label="Loading users…" />}
    {accounts && <ul className={styles.userList}>{accounts.map(user => {
      const own = user.id === account.userId;
      const identity = <span className={styles.userIdentity}>
        <span><strong>{user.id}</strong>{own && <small className={styles.userSelf}>You</small>}</span>
        <small>{user.is_admin ? 'Administrator' : 'Member'}</small>
      </span>;
      return <li key={user.id}>{own || readOnly
        ? <div className={styles.userRow}>{identity}</div>
        : <ActionRow label={identity} aria-label={`Manage ${user.id}`} onClick={() => select({ kind: 'edit', user })} />}</li>;
    })}</ul>}
    {users.hasNextPage && <Button size="slim" disabled={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>Load more users</Button>}
    {action && <Dialog key={action.kind} title={action.kind === 'create' ? 'Add User' : action.kind === 'edit' ? `Manage ${action.user.id}` : `Delete ${action.user.id}?`} onClose={() => { if (!busy) setAction(null); }} footer={<>
      <Button size="slim" form={formId} type="submit" tone={action.kind === 'delete' ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Working…' : action.kind === 'delete' ? 'Delete user' : action.kind === 'create' ? 'Create' : 'Save changes'}</Button>
      <Button size="slim" disabled={busy} onClick={() => setAction(null)}>Cancel</Button>
    </>}>
      <form id={formId} className={styles.manageForm} onSubmit={submit}>
        <fieldset className={styles.settingsFields} disabled={busy}>
          {action.kind === 'delete' ? <><p>Deletes this account and its reading history, not shared books. A recovery snapshot is saved first.</p><label>Type {action.user.id} to confirm<input name="confirm" autoComplete="off" required /></label></> : <>
            {action.kind === 'create' && <label>Username<input name="username" autoComplete="off" maxLength={128} required /></label>}
            <label>{action.kind === 'create' ? 'Password' : 'New password (optional)'}<input name="password" type="password" autoComplete="new-password" maxLength={256} required={action.kind === 'create'} /></label>
            {action.kind === 'edit' && <p>A new password signs this user out.</p>}
            <label className={styles.settingsCheck}><input name="admin" type="checkbox" defaultChecked={action.kind === 'edit' && action.user.is_admin} /> Administrator</label>
          </>}
        </fieldset>
        {action.kind === 'edit' && <Button size="slim" tone="danger" disabled={busy} aria-label={`Delete ${action.user.id}`} onClick={() => select({ kind: 'delete', user: action.user })}>Delete account</Button>}
        <ErrorNotice error={error} />
      </form>
    </Dialog>}
  </Card>;
}
