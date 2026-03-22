import { useState, useEffect, FormEvent } from 'react';
import { useGetSettings, useUpdateSettings } from '../generated/anthoLumeAPIV1';
import type { Device, SettingsResponse } from '../generated/model';
import { UserIcon, PasswordIcon, ClockIcon } from '../icons';
import { Button } from '../components/Button';
import { useToasts } from '../components/ToastContext';
import { getErrorMessage } from '../utils/errors';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeMode } from '../utils/localSettings';

const themeModes: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: 'light', label: 'Light', description: 'Always use the light palette.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark palette.' },
  { value: 'system', label: 'System', description: 'Follow your device preference.' },
];

export default function SettingsPage() {
  const { data, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const settingsData = data?.status === 200 ? (data.data as SettingsResponse) : null;
  const { showInfo, showError } = useToasts();
  const { themeMode, resolvedThemeMode, setThemeMode } = useTheme();

  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [timezone, setTimezone] = useState('UTC');

  useEffect(() => {
    if (settingsData?.timezone && settingsData.timezone.trim() !== '') {
      setTimezone(settingsData.timezone);
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
          password,
          new_password: newPassword,
        },
      });
      showInfo('Password updated successfully');
      setPassword('');
      setNewPassword('');
    } catch (error) {
      showError('Failed to update password: ' + getErrorMessage(error));
    }
  };

  const handleTimezoneSubmit = async (e: FormEvent) => {
    e.preventDefault();

    try {
      await updateSettings.mutateAsync({
        data: {
          timezone,
        },
      });
      showInfo('Timezone updated successfully');
    } catch (error) {
      showError('Failed to update timezone: ' + getErrorMessage(error));
    }
  };

  if (isLoading) {
    return (
      <div className="flex w-full flex-col gap-4 md:flex-row">
        <div>
          <div className="flex flex-col items-center rounded bg-surface p-4 shadow-lg md:w-60 lg:w-80">
            <div className="mb-4 size-16 rounded-full bg-gray-200 dark:bg-gray-600" />
            <div className="h-6 w-32 rounded bg-gray-200 dark:bg-gray-600" />
          </div>
        </div>
        <div className="flex grow flex-col gap-4">
          <div className="flex flex-col gap-2 rounded bg-surface p-4 shadow-lg">
            <div className="mb-4 h-6 w-48 rounded bg-gray-200 dark:bg-gray-600" />
            <div className="flex gap-4">
              <div className="h-12 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
              <div className="h-12 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
              <div className="h-10 w-40 rounded bg-gray-200 dark:bg-gray-600" />
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded bg-surface p-4 shadow-lg">
            <div className="mb-4 h-6 w-48 rounded bg-gray-200 dark:bg-gray-600" />
            <div className="flex gap-4">
              <div className="h-12 flex-1 rounded bg-gray-200 dark:bg-gray-600" />
              <div className="h-10 w-40 rounded bg-gray-200 dark:bg-gray-600" />
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded bg-surface p-4 shadow-lg">
            <div className="mb-4 h-6 w-48 rounded bg-gray-200 dark:bg-gray-600" />
            <div className="grid gap-3 md:grid-cols-3">
              {themeModes.map(mode => (
                <div key={mode.value} className="h-24 rounded bg-gray-200 dark:bg-gray-600" />
              ))}
            </div>
          </div>
          <div className="flex flex-col rounded bg-surface p-4 shadow-lg">
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
      <div>
        <div className="flex flex-col items-center rounded bg-surface p-4 text-content-muted shadow-lg md:w-60 lg:w-80">
          <UserIcon size={60} />
          <p className="text-lg text-content">{settingsData?.user.username || 'N/A'}</p>
        </div>
      </div>

      <div className="flex grow flex-col gap-4">
        <div className="flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
          <p className="mb-2 text-lg font-semibold text-content">Change Password</p>
          <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handlePasswordSubmit}>
            <div className="flex grow flex-col">
              <div className="relative flex">
                <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-sm">
                  <PasswordIcon size={15} />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full flex-1 appearance-none rounded-none border border-border bg-surface px-4 py-2 text-base text-content shadow-sm placeholder:text-content-subtle focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
                  placeholder="Password"
                />
              </div>
            </div>
            <div className="flex grow flex-col">
              <div className="relative flex">
                <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-sm">
                  <PasswordIcon size={15} />
                </span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full flex-1 appearance-none rounded-none border border-border bg-surface px-4 py-2 text-base text-content shadow-sm placeholder:text-content-subtle focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
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

        <div className="flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="mb-1 text-lg font-semibold text-content">Appearance</p>
              <p>
                Active mode: <span className="font-medium text-content">{resolvedThemeMode}</span>
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {themeModes.map(mode => {
              const isSelected = themeMode === mode.value;

              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setThemeMode(mode.value)}
                  className={`rounded border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-primary-500 bg-primary-50 text-content dark:bg-primary-100/20'
                      : 'border-border bg-surface-muted text-content-muted hover:border-primary-300 hover:bg-surface'
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-base font-semibold text-content">{mode.label}</span>
                    <span
                      className={`inline-flex size-4 rounded-full border ${
                        isSelected ? 'border-primary-500 bg-primary-500' : 'border-border-strong'
                      }`}
                    />
                  </div>
                  <p className="text-sm">{mode.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
          <p className="mb-2 text-lg font-semibold text-content">Change Timezone</p>
          <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleTimezoneSubmit}>
            <div className="relative flex grow">
              <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-sm">
                <ClockIcon size={15} />
              </span>
              <select
                value={timezone || 'UTC'}
                onChange={e => setTimezone(e.target.value)}
                className="w-full flex-1 appearance-none rounded-none border border-border bg-surface px-4 py-2 text-base text-content shadow-sm placeholder:text-content-subtle focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
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

        <div className="flex grow flex-col rounded bg-surface p-4 text-content-muted shadow-lg">
          <p className="text-lg font-semibold text-content">Devices</p>
          <table className="min-w-full bg-surface text-sm">
            <thead className="text-content-muted">
              <tr>
                <th className="border-b border-border p-3 pl-0 text-left font-normal uppercase">
                  Name
                </th>
                <th className="border-b border-border p-3 text-left font-normal uppercase">
                  Last Sync
                </th>
                <th className="border-b border-border p-3 text-left font-normal uppercase">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="text-content">
              {!settingsData?.devices || settingsData.devices.length === 0 ? (
                <tr>
                  <td className="p-3 text-center" colSpan={3}>
                    No Results
                  </td>
                </tr>
              ) : (
                settingsData.devices.map((device: Device) => (
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
