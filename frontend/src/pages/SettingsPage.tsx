import { useState, useEffect, SyntheticEvent } from 'react';
import { Button, LoadingState, Table, type Column, TextInput, IconInput } from '../components';
import { inputClassName } from '../components/TextInput';
import { useGetSettings, useUpdateSettings } from '../generated/anthoLumeAPIV1';
import type { Device, SettingsResponse } from '../generated/model';
import { UserIcon, PasswordIcon, ClockIcon } from '../icons';
import { useToasts } from '../components/ToastContext';
import { useMutationWithToast, useToastMutation } from '../hooks/useMutationWithToast';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemeMode } from '../utils/localSettings';
import { dataForStatus } from '../utils/apiResponses';

const formatDeviceDate = (value?: string) => (value ? new Date(value).toLocaleString() : 'N/A');

const deviceColumns: Column<Device>[] = [
  {
    id: 'name',
    header: 'Name',
    className: 'pl-0',
    render: device => device.device_name || 'Unknown',
  },
  {
    id: 'last_synced',
    header: 'Last Sync',
    render: device => formatDeviceDate(device.last_synced),
  },
  { id: 'created_at', header: 'Created', render: device => formatDeviceDate(device.created_at) },
];

const themeModes: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: 'light', label: 'Light', description: 'Always use the light palette.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark palette.' },
  { value: 'system', label: 'System', description: 'Follow your device preference.' },
];

function ProfileCard({ settings }: { settings?: SettingsResponse }) {
  return (
    <div>
      <div className="flex flex-col items-center rounded bg-surface p-4 text-content-muted shadow-lg md:w-60 lg:w-80">
        <UserIcon size={60} />
        <p className="text-lg text-content">{settings?.user.username || 'N/A'}</p>
      </div>
    </div>
  );
}

function PasswordSection({
  onSubmit,
}: {
  onSubmit: (password: string, next: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (await onSubmit(password, newPassword)) {
      setPassword('');
      setNewPassword('');
    }
  };

  return (
    <div className="flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
      <p className="mb-2 text-lg font-semibold text-content">Change Password</p>
      <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleSubmit}>
        <div className="flex grow flex-col">
          <IconInput icon={<PasswordIcon size={15} />}>
            <TextInput
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
            />
          </IconInput>
        </div>
        <div className="flex grow flex-col">
          <IconInput icon={<PasswordIcon size={15} />}>
            <TextInput
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="New Password"
            />
          </IconInput>
        </div>
        <Button variant="secondary" type="submit" className="w-full lg:w-60">
          Submit
        </Button>
      </form>
    </div>
  );
}

function AppearanceSection() {
  const { themeMode, resolvedThemeMode, setThemeMode } = useTheme();

  return (
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
  );
}

function TimezoneSection({
  timezone,
  onChange,
  onSubmit,
}: {
  timezone: string;
  onChange: (timezone: string) => void;
  onSubmit: () => void;
}) {
  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
      <p className="mb-2 text-lg font-semibold text-content">Change Timezone</p>
      <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleSubmit}>
        <IconInput className="grow" icon={<ClockIcon size={15} />}>
          <select
            value={timezone || 'UTC'}
            onChange={e => onChange(e.target.value)}
            className={inputClassName}
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
        </IconInput>
        <Button variant="secondary" type="submit" className="w-full lg:w-60">
          Submit
        </Button>
      </form>
    </div>
  );
}

function DevicesSection({ devices }: { devices: Device[] }) {
  return (
    <div className="flex grow flex-col rounded bg-surface p-4 text-content-muted shadow-lg">
      <p className="text-lg font-semibold text-content">Devices</p>
      <Table columns={deviceColumns} data={devices} rowKey="id" />
    </div>
  );
}

export default function SettingsPage() {
  const { data, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const settingsData = dataForStatus(data, 200);
  const { showError } = useToasts();
  const toastMutationOptions = useMutationWithToast();
  const runWithToast = useToastMutation();

  const [timezone, setTimezone] = useState('UTC');

  useEffect(() => {
    if (settingsData?.timezone && settingsData.timezone.trim() !== '') {
      setTimezone(settingsData.timezone);
    }
  }, [settingsData]);

  const updatePassword = async (password: string, newPassword: string) => {
    if (!password || !newPassword) {
      showError('Please enter both current and new password');
      return false;
    }

    return runWithToast(
      () => updateSettings.mutateAsync({ data: { password, new_password: newPassword } }),
      {
        success: 'Password updated successfully',
        error: 'Failed to update password',
      }
    );
  };

  const updateTimezone = () => {
    updateSettings.mutate(
      { data: { timezone } },
      toastMutationOptions({
        success: 'Timezone updated successfully',
        error: 'Failed to update timezone',
      })
    );
  };

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="flex w-full flex-col gap-4 md:flex-row">
      <ProfileCard settings={settingsData} />
      <div className="flex grow flex-col gap-4">
        <PasswordSection onSubmit={updatePassword} />
        <AppearanceSection />
        <TimezoneSection timezone={timezone} onChange={setTimezone} onSubmit={updateTimezone} />
        <DevicesSection devices={settingsData?.devices ?? []} />
      </div>
    </div>
  );
}
