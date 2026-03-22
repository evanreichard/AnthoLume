import { useState, FormEvent } from 'react';
import { useGetUsers, useUpdateUser } from '../generated/anthoLumeAPIV1';
import type { User, UsersResponse } from '../generated/model';
import { AddIcon, DeleteIcon } from '../icons';
import { useToasts } from '../components/ToastContext';
import { getErrorMessage } from '../utils/errors';

export default function AdminUsersPage() {
  const { data: usersData, isLoading, refetch } = useGetUsers({});
  const updateUser = useUpdateUser();
  const { showInfo, showError } = useToasts();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);

  const users = usersData?.status === 200 ? ((usersData.data as UsersResponse).users ?? []) : [];

  const handleCreateUser = (e: FormEvent) => {
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
      {
        onSuccess: () => {
          showInfo('User created successfully');
          setShowAddForm(false);
          setNewUsername('');
          setNewPassword('');
          setNewIsAdmin(false);
          refetch();
        },
        onError: error => showError('Failed to create user: ' + getErrorMessage(error)),
      }
    );
  };

  const handleDeleteUser = (userId: string) => {
    updateUser.mutate(
      {
        data: { operation: 'DELETE', user: userId },
      },
      {
        onSuccess: () => {
          showInfo('User deleted successfully');
          refetch();
        },
        onError: error => showError('Failed to delete user: ' + getErrorMessage(error)),
      }
    );
  };

  const handleUpdatePassword = (userId: string, password: string) => {
    if (!password) return;

    updateUser.mutate(
      {
        data: { operation: 'UPDATE', user: userId, password },
      },
      {
        onSuccess: () => {
          showInfo('Password updated successfully');
          refetch();
        },
        onError: error => showError('Failed to update password: ' + getErrorMessage(error)),
      }
    );
  };

  const handleToggleAdmin = (userId: string, isAdmin: boolean) => {
    updateUser.mutate(
      {
        data: { operation: 'UPDATE', user: userId, is_admin: isAdmin },
      },
      {
        onSuccess: () => {
          showInfo(`User permissions updated to ${isAdmin ? 'admin' : 'user'}`);
          refetch();
        },
        onError: error => showError('Failed to update admin status: ' + getErrorMessage(error)),
      }
    );
  };

  if (isLoading) {
    return <div className="text-content-muted">Loading...</div>;
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

      <div className="min-w-full overflow-scroll rounded shadow">
        <table className="min-w-full bg-surface text-sm leading-normal text-content">
          <thead className="text-content-muted">
            <tr>
              <th className="w-12 border-b border-border p-3 text-left font-normal uppercase">
                <button onClick={() => setShowAddForm(!showAddForm)}>
                  <AddIcon size={20} />
                </button>
              </th>
              <th className="border-b border-border p-3 text-left font-normal uppercase">User</th>
              <th className="border-b border-border p-3 text-left font-normal uppercase">Password</th>
              <th className="border-b border-border p-3 text-center font-normal uppercase">
                Permissions
              </th>
              <th className="w-48 border-b border-border p-3 text-left font-normal uppercase">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td className="p-3 text-center" colSpan={5}>
                  No Results
                </td>
              </tr>
            ) : (
              users.map((user: User) => (
                <tr key={user.id}>
                  <td className="relative cursor-pointer border-b border-border p-3 text-content-muted">
                    <button onClick={() => handleDeleteUser(user.id)}>
                      <DeleteIcon size={20} />
                    </button>
                  </td>
                  <td className="border-b border-border p-3">
                    <p>{user.id}</p>
                  </td>
                  <td className="border-b border-border px-3">
                    <button
                      onClick={() => {
                        const password = prompt(`Enter new password for ${user.id}`);
                        if (password) handleUpdatePassword(user.id, password);
                      }}
                      className="bg-primary-500 px-2 py-1 font-medium text-primary-foreground hover:bg-primary-700"
                    >
                      Reset
                    </button>
                  </td>
                  <td className="flex min-w-40 justify-center gap-2 border-b border-border p-3 text-center">
                    <button
                      onClick={() => handleToggleAdmin(user.id, true)}
                      disabled={user.admin}
                      className={`rounded-md px-2 py-1 ${
                        user.admin
                          ? 'cursor-default bg-content text-content-inverse'
                          : 'cursor-pointer bg-surface-strong text-content'
                      }`}
                    >
                      admin
                    </button>
                    <button
                      onClick={() => handleToggleAdmin(user.id, false)}
                      disabled={!user.admin}
                      className={`rounded-md px-2 py-1 ${
                        !user.admin
                          ? 'cursor-default bg-content text-content-inverse'
                          : 'cursor-pointer bg-surface-strong text-content'
                      }`}
                    >
                      user
                    </button>
                  </td>
                  <td className="border-b border-border p-3">
                    <p>{user.created_at}</p>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
