import { useId, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useMatch, useOutletContext } from 'react-router';
import type { components } from '../api/schema.gen';
import { ReadingHTTPError, type Account } from '../reading';
import { session, useSession } from '../session';
import { Dialog, ErrorNotice, PageHeader } from '../ui';
import { ActionRow, CircleAction, Card, CardHeader, RadioChoices, SectionTabs, Button } from '../Controls';
import { AdminBackups } from './AdminBackups';
import { AdminImport } from './AdminImport';
import { AdminMaintenance } from './AdminMaintenance';
import { AdminMetadata } from './AdminMetadata';
import { SkeletonRows } from '../Skeleton';
import { useSnackbar } from '../Snackbar';
import { StorageRoots, storageRootsKey } from './AdminStorage';
import styles from '../App.module.css';

type User = components['schemas']['AdminUser'];
type UserAction = { kind: 'create' } | { kind: 'edit' | 'delete'; user: User };

const tabs = [['library', 'Library'], ['users', 'Users'], ['system', 'System'], ['logs', 'Logs']] as const;
type AdminContext = { account: Account; username: string };

export function AdminSectionTabs() {
  return <SectionTabs label="Administration sections" items={tabs.map(([path, label]) => ({ to: `/admin/${path}`, label }))} />;
}

export function Administration() {
  const logs = useMatch('/admin/logs');
  const { access, session: current } = useSession();
  const context: AdminContext | null = access.kind === 'authenticated' && current?.user?.is_admin
    ? { account: access.account, username: current.user.id }
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
  const { account } = useOutletContext<AdminContext>();
  const query = useQuery({ queryKey: storageRootsKey(account), queryFn: ({ signal }) => session.api.adminStorageRoots(account, signal) });
  const roots = query.data ?? [];
  return <div className={styles.settingsLayout}>
    <StorageRoots account={account} roots={roots} error={query.error} />
    <AdminImport account={account} roots={roots} />
    <AdminMetadata account={account} />
    <AdminBackups account={account} />
  </div>;
}

export function AdminSystem() {
  const { account } = useOutletContext<AdminContext>();
  return <div className={styles.settingsLayout}><SystemDetails account={account} /><AdminMaintenance account={account} /></div>;
}

function SystemDetails({ account }: { account: Account }) {
  const info = useQuery({ queryKey: ['admin-system', account], queryFn: ({ signal }) => session.api.adminSystem(account, signal) });
  return <Card density="compact" aria-labelledby="admin-server-heading">
    <CardHeader id="admin-server-heading" title="Server" />
    <ErrorNotice error={info.error} />
    {info.isPending && <SkeletonRows label="Loading server details…" count={1} secondary={false} />}
    {info.data && <p className={styles.settingsCardFeedback}>Version: {info.data.version || 'Development build'}</p>}
  </Card>;
}

export function AdminUsers() {
  const context = useOutletContext<AdminContext>();
  return <UserList key={context.account.userId} {...context} />;
}

function UserList({ account, username }: AdminContext) {
  const formId = useId();
  const client = useQueryClient();
  const queryKey = ['admin-users', account] as const;
  const users = useInfiniteQuery({ queryKey, initialPageParam: '', queryFn: ({ pageParam, signal }) => session.api.adminUsers(account, pageParam, signal), getNextPageParam: page => page.length > 50 ? page[49]?.id : undefined });
  const [action, setAction] = useState<UserAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { show } = useSnackbar(JSON.stringify(account));
  function select(value: UserAction) { setError(null); setAction(value); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      let message: string;
      if (action.kind === 'create') {
        const created = await session.api.createAdminUser(account, { username: String(data.get('username')), password: String(data.get('password')), is_admin: data.get('role') === 'administrator' });
        message = `Created ${created.id}.`;
      } else if (action.kind === 'edit') {
        const password = String(data.get('password'));
        const admin = data.get('role') === 'administrator';
        if (!password && admin === action.user.is_admin) { setAction(null); return; }
        await session.api.updateAdminUser(account, action.user.id, { ...(password ? { password } : {}), ...(admin !== action.user.is_admin ? { is_admin: admin } : {}) });
        message = `Updated ${action.user.id}.`;
      } else {
        if (String(data.get('confirm')) !== action.user.id) throw new Error('Enter the exact username to confirm.');
        await session.api.deleteAdminUser(account, action.user.id);
        message = `Deleted ${action.user.id}.`;
      }
      setAction(null);
      await client.invalidateQueries({ queryKey });
      show({ message });
    } catch (failure) {
      const code = failure instanceof ReadingHTTPError ? failure.problem.code : '';
      setError(code === 'user_conflict' ? new Error('That username already exists.') : code === 'current_admin' ? new Error('You cannot change your own account here.') : failure);
    } finally { setBusy(false); }
  }
  const accounts = users.data?.pages.flatMap(page => page.slice(0, 50));
  return <Card density="compact" aria-labelledby="admin-users-heading">
    <CardHeader id="admin-users-heading" title={<>Users {accounts && <span className={styles.settingsCount}>{accounts.length}{users.hasNextPage ? '+' : ''}</span>}</>}
      action={<CircleAction icon="add" label="Add User" onClick={() => select({ kind: 'create' })} />} />
    <ErrorNotice error={users.error} />
    {users.isPending && <SkeletonRows label="Loading users…" />}
    {accounts && <ul className={styles.userList}>{accounts.map(user => {
      const own = user.id === username;
      const identity = <span className={styles.userIdentity}>
        <span><strong>{user.id}</strong>{own && <small className={styles.userSelf}>You</small>}</span>
        <small>{user.is_admin ? 'Administrator' : 'Member'}</small>
      </span>;
      return <li key={user.id}>{own
        ? <div className={styles.userRow}>{identity}</div>
        : <ActionRow label={identity} aria-label={`Manage ${user.id}`} onClick={() => select({ kind: 'edit', user })} />}</li>;
    })}</ul>}
    {users.hasNextPage && <Button size="slim" disabled={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>Load More Users</Button>}
    {action && <Dialog key={action.kind} title={action.kind === 'create' ? 'Add User' : action.kind === 'edit' ? `Manage ${action.user.id}` : `Delete ${action.user.id}?`} dismissDisabled={busy} onClose={() => setAction(null)} footer={<>
      <Button size="slim" form={formId} type="submit" tone={action.kind === 'delete' ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Working…' : action.kind === 'delete' ? 'Delete User' : action.kind === 'create' ? 'Create' : 'Save'}</Button>
      <Button size="slim" disabled={busy} onClick={() => setAction(null)}>Cancel</Button>
      {action.kind === 'edit' && <Button size="slim" tone="danger" disabled={busy} onClick={() => select({ kind: 'delete', user: action.user })}>Delete</Button>}
    </>}>
      <form id={formId} className={styles.manageForm} onSubmit={submit}>
        <fieldset className={styles.settingsFields} disabled={busy}>
          {action.kind === 'delete' ? <><p>Permanently deletes this account and its reading history. Shared books are not deleted.</p><label>Type {action.user.id} to confirm<input name="confirm" autoComplete="off" required /></label></> : <>
            {action.kind === 'create' && <label>Username<input name="username" autoComplete="off" maxLength={128} required /></label>}
            <label>{action.kind === 'create' ? 'Password' : 'New password (optional)'}<input name="password" type="password" autoComplete="new-password" maxLength={256} required={action.kind === 'create'} /></label>
            {action.kind === 'edit' && <p>A new password signs this user out.</p>}
            <RadioChoices legend="Role" name="role" defaultValue={action.kind === 'edit' && action.user.is_admin ? 'administrator' : 'member'} options={[
              { value: 'member', label: 'Member', description: 'Use the Library and sync reading progress.' },
              { value: 'administrator', label: 'Administrator', description: 'Also manage users, storage, and backups.' },
            ]} />
          </>}
        </fieldset>
        <ErrorNotice error={error} />
      </form>
    </Dialog>}
  </Card>;
}
