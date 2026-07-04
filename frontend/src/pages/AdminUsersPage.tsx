import { useState, SyntheticEvent } from 'react';
import { LoadingState, TextInput } from '../components';
import { Button } from '../components/Button';
import { Table, type Column } from '../components/Table';
import { useGetUsers, useUpdateUser } from '../generated/anthoLumeAPIV1';
import type { User } from '../generated/model';
import { AddIcon, DeleteIcon } from '../icons';
import { useMutationWithToast } from '../hooks/useMutationWithToast';
import { useToasts } from '../components/ToastContext';
import { formatDate } from '../utils/formatters';

interface AddUserFormProps {
  onCreate: (_username: string, _password: string, _isAdmin: boolean) => void;
}

function AddUserForm({ onCreate }: AddUserFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    onCreate(username, password, isAdmin);
  };

  return (
    <div className="absolute left-10 top-10 rounded bg-surface-strong p-3 shadow-lg transition-all duration-200">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 text-sm text-content">
        <TextInput
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="Username"
          className="p-2"
        />
        <TextInput
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          className="p-2"
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="new_is_admin"
            checked={isAdmin}
            onChange={e => setIsAdmin(e.target.checked)}
          />
          <label htmlFor="new_is_admin">Admin</label>
        </div>
        <Button type="submit">Create</Button>
      </form>
    </div>
  );
}

interface ResetPasswordDialogProps {
  userId: string;
  onClose: () => void;
  onSave: (_userId: string, _password: string) => void;
}

function ResetPasswordDialog({ userId, onClose, onSave }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState('');

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <form
        className="w-80 rounded bg-surface p-4 shadow-lg"
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault();
          if (!password) return;
          onSave(userId, password);
          onClose();
        }}
      >
        <p className="mb-3 text-content">Reset password for {userId}</p>
        <TextInput
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="New password"
          autoFocus
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!password}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}

const permissionButtonClass = (active: boolean) =>
  `rounded-md px-2 py-1 ${
    active
      ? 'cursor-default bg-content text-content-inverse'
      : 'cursor-pointer bg-surface-strong text-content'
  }`;

export default function AdminUsersPage() {
  const { data: usersData, isLoading, refetch } = useGetUsers({});
  const updateUser = useUpdateUser();
  const toastMutationOptions = useMutationWithToast();
  const { showError } = useToasts();

  const [showAddForm, setShowAddForm] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);

  const users = usersData?.users ?? [];

  const handleCreateUser = (username: string, password: string, isAdmin: boolean) => {
    if (!username || !password) {
      showError('Please enter username and password');
      return;
    }

    updateUser.mutate(
      {
        data: {
          operation: 'CREATE',
          user: username,
          password,
          is_admin: isAdmin,
        },
      },
      toastMutationOptions({
        success: 'User created successfully',
        error: 'Failed to create user',
        onSuccess: () => {
          setShowAddForm(false);
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
        <Button
          onClick={() => {
            setResetUserId(user.id);
          }}
          className="px-2 py-1"
        >
          Reset
        </Button>
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
    {
      id: 'created',
      header: 'Created',
      className: 'w-48',
      render: user => formatDate(user.created_at),
    },
  ];

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="relative h-full overflow-x-auto">
      {showAddForm && <AddUserForm onCreate={handleCreateUser} />}

      <Table columns={userColumns} data={users} rowKey="id" />

      {resetUserId && (
        <ResetPasswordDialog
          userId={resetUserId}
          onClose={() => setResetUserId(null)}
          onSave={handleUpdatePassword}
        />
      )}
    </div>
  );
}
