import { useState, FormEvent } from 'react';
import { useGetUsers, useUpdateUser } from '../generated/anthoLumeAPIV1';
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

  const users = usersData?.data?.users || [];

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
        onError: error => {
          showError('Failed to create user: ' + getErrorMessage(error));
        },
      }
    );
  };

  const handleDeleteUser = (userId: string) => {
    updateUser.mutate(
      {
        data: {
          operation: 'DELETE',
          user: userId,
        },
      },
      {
        onSuccess: () => {
          showInfo('User deleted successfully');
          refetch();
        },
        onError: error => {
          showError('Failed to delete user: ' + getErrorMessage(error));
        },
      }
    );
  };

  const handleUpdatePassword = (userId: string, password: string) => {
    if (!password) return;

    updateUser.mutate(
      {
        data: {
          operation: 'UPDATE',
          user: userId,
          password: password,
        },
      },
      {
        onSuccess: () => {
          showInfo('Password updated successfully');
          refetch();
        },
        onError: error => {
          showError('Failed to update password: ' + getErrorMessage(error));
        },
      }
    );
  };

  const handleToggleAdmin = (userId: string, isAdmin: boolean) => {
    updateUser.mutate(
      {
        data: {
          operation: 'UPDATE',
          user: userId,
          is_admin: isAdmin,
        },
      },
      {
        onSuccess: () => {
          const role = isAdmin ? 'admin' : 'user';
          showInfo(`User permissions updated to ${role}`);
          refetch();
        },
        onError: error => {
          showError('Failed to update admin status: ' + getErrorMessage(error));
        },
      }
    );
  };

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="relative h-full overflow-x-auto">
      {/* Add User Form */}
      {showAddForm && (
        <div className="absolute left-10 top-10 rounded bg-gray-200 p-3 shadow-lg shadow-gray-500 transition-all duration-200 dark:bg-gray-600 dark:shadow-gray-900">
          <form
            onSubmit={handleCreateUser}
            className="flex flex-col gap-2 text-sm text-black dark:text-white"
          >
            <input
              type="text"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              placeholder="Username"
              className="bg-gray-300 p-2 text-black dark:bg-gray-700 dark:text-white"
            />
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Password"
              className="bg-gray-300 p-2 text-black dark:bg-gray-700 dark:text-white"
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
              className="bg-gray-500 px-2 py-1 font-medium text-white hover:bg-gray-800 dark:text-gray-800 dark:hover:bg-gray-100"
              type="submit"
            >
              Create
            </button>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="min-w-full overflow-scroll rounded shadow">
        <table className="min-w-full bg-white text-sm leading-normal dark:bg-gray-700">
          <thead className="text-gray-800 dark:text-gray-400">
            <tr>
              <th className="w-12 border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                <button onClick={() => setShowAddForm(!showAddForm)}>
                  <AddIcon size={20} />
                </button>
              </th>
              <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                User
              </th>
              <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                Password
              </th>
              <th className="border-b border-gray-200 p-3 text-center font-normal uppercase dark:border-gray-800">
                Permissions
              </th>
              <th className="w-48 border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="text-black dark:text-white">
            {users.length === 0 ? (
              <tr>
                <td className="p-3 text-center" colSpan={5}>
                  No Results
                </td>
              </tr>
            ) : (
              users.map(user => (
                <tr key={user.id}>
                  {/* Delete Button */}
                  <td className="relative cursor-pointer border-b border-gray-200 p-3 text-gray-800 dark:text-gray-400">
                    <button onClick={() => handleDeleteUser(user.id)}>
                      <DeleteIcon size={20} />
                    </button>
                  </td>
                  {/* User ID */}
                  <td className="border-b border-gray-200 p-3">
                    <p>{user.id}</p>
                  </td>
                  {/* Password Reset */}
                  <td className="border-b border-gray-200 px-3">
                    <button
                      onClick={() => {
                        const password = prompt(`Enter new password for ${user.id}`);
                        if (password) handleUpdatePassword(user.id, password);
                      }}
                      className="bg-gray-500 px-2 py-1 font-medium text-white hover:bg-gray-800 dark:text-gray-800 dark:hover:bg-gray-100"
                    >
                      Reset
                    </button>
                  </td>
                  {/* Admin Toggle */}
                  <td className="flex min-w-40 justify-center gap-2 border-b border-gray-200 p-3 text-center">
                    <button
                      onClick={() => handleToggleAdmin(user.id, true)}
                      disabled={user.admin}
                      className={`rounded-md px-2 py-1 text-white dark:text-black ${
                        user.admin
                          ? 'cursor-default bg-gray-800 dark:bg-gray-100'
                          : 'cursor-pointer bg-gray-400 dark:bg-gray-600'
                      }`}
                    >
                      admin
                    </button>
                    <button
                      onClick={() => handleToggleAdmin(user.id, false)}
                      disabled={!user.admin}
                      className={`rounded-md px-2 py-1 text-white dark:text-black ${
                        !user.admin
                          ? 'cursor-default bg-gray-800 dark:bg-gray-100'
                          : 'cursor-pointer bg-gray-400 dark:bg-gray-600'
                      }`}
                    >
                      user
                    </button>
                  </td>
                  {/* Created Date */}
                  <td className="border-b border-gray-200 p-3">
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
