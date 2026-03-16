import { useState, FormEvent } from 'react';
import { useGetUsers, useUpdateUser } from '../generated/anthoLumeAPIV1';
import { Plus, Trash2 } from 'lucide-react';
import { useToasts } from '../components/ToastContext';

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
        onError: (error: any) => {
          showError('Failed to create user: ' + error.message);
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
        onError: (error: any) => {
          showError('Failed to delete user: ' + error.message);
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
        onError: (error: any) => {
          showError('Failed to update password: ' + error.message);
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
        onError: (error: any) => {
          showError('Failed to update admin status: ' + error.message);
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
        <div className="absolute top-10 left-10 p-3 transition-all duration-200 bg-gray-200 rounded shadow-lg shadow-gray-500 dark:shadow-gray-900 dark:bg-gray-600">
          <form onSubmit={handleCreateUser}
                className="flex flex-col gap-2 text-black dark:text-white text-sm">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username"
              className="p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password"
              className="p-2 bg-gray-300 text-black dark:bg-gray-700 dark:text-white"
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="new_is_admin"
                checked={newIsAdmin}
                onChange={(e) => setNewIsAdmin(e.target.checked)}
              />
              <label htmlFor="new_is_admin">Admin</label>
            </div>
            <button
              className="font-medium px-2 py-1 text-white bg-gray-500 dark:text-gray-800 hover:bg-gray-800 dark:hover:bg-gray-100"
              type="submit"
            >
              Create
            </button>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="min-w-full overflow-scroll rounded shadow">
        <table className="min-w-full leading-normal bg-white dark:bg-gray-700 text-sm">
          <thead className="text-gray-800 dark:text-gray-400">
            <tr>
              <th className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800 w-12">
                <button onClick={() => setShowAddForm(!showAddForm)}>
                  <Plus size={20} />
                </button>
              </th>
              <th className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800">User</th>
              <th className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800">Password</th>
              <th className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800 text-center">
                Permissions
              </th>
              <th className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800 w-48">Created</th>
            </tr>
          </thead>
          <tbody className="text-black dark:text-white">
            {users.length === 0 ? (
              <tr>
                <td className="text-center p-3" colSpan={5}>No Results</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id}>
                  {/* Delete Button */}
                  <td className="p-3 border-b border-gray-200 text-gray-800 dark:text-gray-400 cursor-pointer relative">
                    <button onClick={() => handleDeleteUser(user.id)}>
                      <Trash2 size={20} />
                    </button>
                  </td>
                  {/* User ID */}
                  <td className="p-3 border-b border-gray-200">
                    <p>{user.id}</p>
                  </td>
                  {/* Password Reset */}
                  <td className="border-b border-gray-200 px-3">
                    <button
                      onClick={() => {
                        const password = prompt(`Enter new password for ${user.id}`);
                        if (password) handleUpdatePassword(user.id, password);
                      }}
                      className="font-medium px-2 py-1 text-white bg-gray-500 dark:text-gray-800 hover:bg-gray-800 dark:hover:bg-gray-100"
                    >
                      Reset
                    </button>
                  </td>
                  {/* Admin Toggle */}
                  <td className="flex gap-2 justify-center p-3 border-b border-gray-200 text-center min-w-40">
                    <button
                      onClick={() => handleToggleAdmin(user.id, true)}
                      disabled={user.admin}
                      className={`px-2 py-1 rounded-md text-white dark:text-black ${
                        user.admin
                          ? 'bg-gray-800 dark:bg-gray-100 cursor-default'
                          : 'bg-gray-400 dark:bg-gray-600 cursor-pointer'
                      }`}
                    >
                      admin
                    </button>
                    <button
                      onClick={() => handleToggleAdmin(user.id, false)}
                      disabled={!user.admin}
                      className={`px-2 py-1 rounded-md text-white dark:text-black ${
                        !user.admin
                          ? 'bg-gray-800 dark:bg-gray-100 cursor-default'
                          : 'bg-gray-400 dark:bg-gray-600 cursor-pointer'
                      }`}
                    >
                      user
                    </button>
                  </td>
                  {/* Created Date */}
                  <td className="p-3 border-b border-gray-200">
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