import { useState, useEffect, FormEvent } from 'react';
import { useGetSettings, useUpdateSettings } from '../generated/anthoLumeAPIV1';
import { UserIcon, PasswordIcon, ClockIcon } from '../icons';
import { Button } from '../components/Button';
import { useToasts } from '../components/ToastContext';

export default function SettingsPage() {
  const { data, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const settingsData = data;
  const { showInfo, showError } = useToasts();

  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [timezone, setTimezone] = useState('UTC');

  useEffect(() => {
    if (settingsData?.data.timezone && settingsData.data.timezone.trim() !== '') {
      setTimezone(settingsData.data.timezone);
    }
  }, [settingsData]);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!password || !newPassword) {
      showError('Please enter both current and new password');
      return;
    }

    try {
      await updateSettings.mutateAsync({
        data: {
          password: password,
          new_password: newPassword,
        },
      });
      showInfo('Password updated successfully');
      setPassword('');
      setNewPassword('');
    } catch (error: any) {
      showError(
        'Failed to update password: ' +
          (error.response?.data?.message || error.message || 'Unknown error')
      );
    }
  };

  const handleTimezoneSubmit = async (e: FormEvent) => {
    e.preventDefault();

    try {
      await updateSettings.mutateAsync({
        data: {
          timezone: timezone,
        },
      });
      showInfo('Timezone updated successfully');
    } catch (error: any) {
      showError(
        'Failed to update timezone: ' +
          (error.response?.data?.message || error.message || 'Unknown error')
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex w-full flex-col gap-4 md:flex-row">
        <div>
          <div className="flex flex-col items-center rounded bg-white p-4 shadow-lg md:w-60 lg:w-80 dark:bg-gray-700">
            <div className="mb-4 size-16 rounded-full bg-gray-200 dark:bg-gray-600" />
            <div className="h-6 w-32 rounded bg-gray-200 dark:bg-gray-600" />
          </div>
        </div>
        <div className="flex grow flex-col gap-4">
          <div className="flex flex-col gap-2 rounded bg-white p-4 shadow-lg dark:bg-gray-700">
            <div className="mb-4 h-6 w-48 rounded bg-gray-200 dark:bg-gray-600" />
            <div className="flex gap-4">
              <div className="h-12 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
              <div className="h-12 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
              <div className="h-10 w-40 rounded bg-gray-200 dark:bg-gray-600" />
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded bg-white p-4 shadow-lg dark:bg-gray-700">
            <div className="mb-4 h-6 w-48 rounded bg-gray-200 dark:bg-gray-600" />
            <div className="flex gap-4">
              <div className="h-12 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
              <div className="h-10 w-40 rounded bg-gray-200 dark:bg-gray-600" />
            </div>
          </div>
          <div className="flex flex-col rounded bg-white p-4 shadow-lg dark:bg-gray-700">
            <div className="mb-4 h-6 w-24 rounded bg-gray-200 dark:bg-gray-600" />
            <div className="mb-4 flex gap-4">
              <div className="h-6 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
              <div className="h-6 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
              <div className="h-6 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
            </div>
            <div className="h-32 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 md:flex-row">
      {/* User Profile Card */}
      <div>
        <div className="flex flex-col items-center rounded bg-white p-4 text-gray-500 shadow-lg md:w-60 lg:w-80 dark:bg-gray-700 dark:text-white">
          <UserIcon size={60} />
          <p className="text-lg">{settingsData?.data.user.username || 'N/A'}</p>
        </div>
      </div>

      <div className="flex grow flex-col gap-4">
        {/* Change Password Form */}
        <div className="flex grow flex-col gap-2 rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white">
          <p className="mb-2 text-lg font-semibold">Change Password</p>
          <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handlePasswordSubmit}>
            <div className="flex grow flex-col">
              <div className="relative flex">
                <span className="inline-flex items-center border-y border-l border-gray-300 bg-white px-3 text-sm text-gray-500 shadow-sm">
                  <PasswordIcon size={15} />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
                  placeholder="Password"
                />
              </div>
            </div>
            <div className="flex grow flex-col">
              <div className="relative flex">
                <span className="inline-flex items-center border-y border-l border-gray-300 bg-white px-3 text-sm text-gray-500 shadow-sm">
                  <PasswordIcon size={15} />
                </span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
                  placeholder="New Password"
                />
              </div>
            </div>
            <div className="lg:w-60">
              <Button variant="secondary" type="submit">
                Submit
              </Button>
            </div>
          </form>
        </div>

        {/* Change Timezone Form */}
        <div className="flex grow flex-col gap-2 rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white">
          <p className="mb-2 text-lg font-semibold">Change Timezone</p>
          <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleTimezoneSubmit}>
            <div className="relative flex grow">
              <span className="inline-flex items-center border-y border-l border-gray-300 bg-white px-3 text-sm text-gray-500 shadow-sm">
                <ClockIcon size={15} />
              </span>
              <select
                value={timezone || 'UTC'}
                onChange={e => setTimezone(e.target.value)}
                className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Chicago">America/Chicago</option>
                <option value="America/Denver">America/Denver</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Paris">Europe/Paris</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="Australia/Sydney">Australia/Sydney</option>
              </select>
            </div>
            <div className="lg:w-60">
              <Button variant="secondary" type="submit">
                Submit
              </Button>
            </div>
          </form>
        </div>

        {/* Devices Table */}
        <div className="flex grow flex-col rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white">
          <p className="text-lg font-semibold">Devices</p>
          <table className="min-w-full bg-white text-sm dark:bg-gray-700">
            <thead className="text-gray-800 dark:text-gray-400">
              <tr>
                <th className="border-b border-gray-200 p-3 pl-0 text-left font-normal uppercase dark:border-gray-800">
                  Name
                </th>
                <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                  Last Sync
                </th>
                <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="text-black dark:text-white">
              {!settingsData?.data.devices || settingsData.data.devices.length === 0 ? (
                <tr>
                  <td className="p-3 text-center" colSpan={3}>
                    No Results
                  </td>
                </tr>
              ) : (
                settingsData.data.devices.map((device: any) => (
                  <tr key={device.id}>
                    <td className="p-3 pl-0">
                      <p>{device.device_name || 'Unknown'}</p>
                    </td>
                    <td className="p-3">
                      <p>
                        {device.last_synced ? new Date(device.last_synced).toLocaleString() : 'N/A'}
                      </p>
                    </td>
                    <td className="p-3">
                      <p>
                        {device.created_at ? new Date(device.created_at).toLocaleString() : 'N/A'}
                      </p>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
