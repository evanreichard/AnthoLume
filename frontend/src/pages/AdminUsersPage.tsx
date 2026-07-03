import { useState, SyntheticEvent } from 'react';
import { LoadingState, TextInput } from '../components';
import { Button } from '../components/Button';
import { Table, type Column } from '../components/Table';
import { useGetUsers, useUpdateUser } from '../generated/anthoLumeAPIV1';
import type { User } from '../generated/model';
import { AddIcon, DeleteIcon } from '../icons';
import { useMutationWithToast } from '../hooks/useMutationWithToast';

export default function AdminUsersPage() {
  const { data: usersData, isLoading, refetch } = useGetUsers({});
  const updateUser = useUpdateUser();
  const toastMutationOptions = useMutationWithToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const users = usersData?.status === 200 ? (usersData.data.users ?? []) : [];

  const handleCreateUser = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;

    updateUser.mutate(
      {
        data: {
          operation: 'CREATE',
          user: newUsername,
          password: newPassword,
          is_admin: newIsAdmin,
        },
      },
      toastMutationOptions({
        success: 'User created successfully',
        error: 'Failed to create user',
        onSuccess: () => {
          setShowAddForm(false);
          setNewUsername('');
          setNewPassword('');
          setNewIsAdmin(false);
          refetch();
        },
      })
    );
  };

  const handleDeleteUser = (userId: string) => {
    updateUser.mutate(
      {
        data: { operation: 'DELETE', user: userId },
      },
      toastMutationOptions({
        success: 'User deleted successfully',
        error: 'Failed to delete user',
        onSuccess: refetch,
      })
    );
  };

  const handleUpdatePassword = (userId: string, password: string) => {
    if (!password) return;

    updateUser.mutate(
      {
        data: { operation: 'UPDATE', user: userId, password },
      },
      toastMutationOptions({
        success: 'Password updated successfully',
        error: 'Failed to update password',
        onSuccess: refetch,
      })
    );
  };

  const handleToggleAdmin = (userId: string, isAdmin: boolean) => {
    updateUser.mutate(
      {
        data: { operation: 'UPDATE', user: userId, is_admin: isAdmin },
      },
      toastMutationOptions({
        success: `User permissions updated to ${isAdmin ? 'admin' : 'user'}`,
        error: 'Failed to update admin status',
        onSuccess: refetch,
      })
    );
  };

  const permissionButtonClass = (active: boolean) =>
    `rounded-md px-2 py-1 ${
      active
        ? 'cursor-default bg-content text-content-inverse'
        : 'cursor-pointer bg-surface-strong text-content'
    }`;

  const userColumns: Column<User>[] = [
    {
      id: 'actions',
      className: 'w-12',
      header: (
        <button onClick={() => setShowAddForm(!showAddForm)} aria-label="Add user">
          <AddIcon size={20} />
        </button>
      ),
      render: user => (
        <button onClick={() => handleDeleteUser(user.id)} aria-label="Delete user">
          <DeleteIcon size={20} />
        </button>
      ),
    },
    { id: 'user', header: 'User', render: user => user.id },
    {
      id: 'password',
      header: 'Password',
      render: user => (
        <button
          onClick={() => {
            setResetUserId(user.id);
            setResetPassword('');
          }}
          className="bg-primary-500 px-2 py-1 font-medium text-primary-foreground hover:bg-primary-700"
        >
          Reset
        </button>
      ),
    },
    {
      id: 'permissions',
      header: 'Permissions',
      className: 'text-center',
      render: user => (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => handleToggleAdmin(user.id, true)}
            disabled={user.admin}
            className={permissionButtonClass(user.admin)}
          >
            admin
          </button>
          <button
            onClick={() => handleToggleAdmin(user.id, false)}
            disabled={!user.admin}
            className={permissionButtonClass(!user.admin)}
          >
            user
          </button>
        </div>
      ),
    },
    { id: 'created', header: 'Created', className: 'w-48', render: user => user.created_at },
  ];

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="relative h-full overflow-x-auto">
      {showAddForm && (
        <div className="absolute left-10 top-10 rounded bg-surface-strong p-3 shadow-lg transition-all duration-200">
          <form onSubmit={handleCreateUser} className="flex flex-col gap-2 text-sm text-content">
            <input
              type="text"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              placeholder="Username"
              className="bg-surface p-2 text-content"
            />
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Password"
              className="bg-surface p-2 text-content"
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="new_is_admin"
                checked={newIsAdmin}
                onChange={e => setNewIsAdmin(e.target.checked)}
              />
              <label htmlFor="new_is_admin">Admin</label>
            </div>
            <button
              className="bg-primary-500 px-2 py-1 font-medium text-primary-foreground hover:bg-primary-700"
              type="submit"
            >
              Create
            </button>
          </form>
        </div>
      )}

      <Table columns={userColumns} data={users} rowKey="id" />

      {resetUserId && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
          onClick={() => setResetUserId(null)}
        >
          <form
            className="w-80 rounded bg-surface p-4 shadow-lg"
            onClick={e => e.stopPropagation()}
            onSubmit={e => {
              e.preventDefault();
              if (!resetPassword) return;
              handleUpdatePassword(resetUserId, resetPassword);
              setResetUserId(null);
            }}
          >
            <p className="mb-3 text-content">Reset password for {resetUserId}</p>
            <TextInput
              type="password"
              value={resetPassword}
              onChange={e => setResetPassword(e.target.value)}
              placeholder="New password"
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResetUserId(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!resetPassword}>
                Save
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
