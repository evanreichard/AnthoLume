import { useState, FormEvent } from 'react';
import { useGetSettings } from '../generated/anthoLumeAPIV1';

// User icon SVG
function UserIcon() {
  return (
    <svg className="w-60 h-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M12 12c-4 0-8 3-8 8h16c0-5-4-8-8-8" />
    </svg>
  );
}

// Password icon SVG
function PasswordIcon() {
  return (
    <svg className="w-15 h-15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// Clock icon SVG
function ClockIcon() {
  return (
    <svg className="w-15 h-15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export default function SettingsPage() {
  const { data, isLoading } = useGetSettings();
  const settingsData = data?.data;
  
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [timezone, setTimezone] = useState(settingsData?.timezone || '');

  const handlePasswordSubmit = (e: FormEvent) => {
    e.preventDefault();
    // TODO: Call API to change password
  };

  const handleTimezoneSubmit = (e: FormEvent) => {
    e.preventDefault();
    // TODO: Call API to change timezone
  };

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="w-full flex flex-col md:flex-row gap-4">
      {/* User Profile Card */}
      <div>
        <div
          className="flex flex-col p-4 items-center rounded shadow-lg md:w-60 lg:w-80 bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
        >
          <UserIcon />
          <p className="text-lg">{settingsData?.user?.username}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 grow">
        {/* Change Password Form */}
        <div
          className="flex flex-col gap-2 grow p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
        >
          <p className="text-lg font-semibold mb-2">Change Password</p>
          <form
            className="flex gap-4 flex-col lg:flex-row"
            onSubmit={handlePasswordSubmit}
          >
            <div className="flex flex-col grow">
              <div className="flex relative">
                <span
                  className="inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"
                >
                  <PasswordIcon />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                  placeholder="Password"
                />
              </div>
            </div>
            <div className="flex flex-col grow">
              <div className="flex relative">
                <span
                  className="inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"
                >
                  <PasswordIcon />
                </span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                  placeholder="New Password"
                />
              </div>
            </div>
            <div className="lg:w-60">
              <button
                type="submit"
                className="font-medium px-4 py-2 text-gray-800 bg-gray-500 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                Submit
              </button>
            </div>
          </form>
        </div>

        {/* Change Timezone Form */}
        <div
          className="flex flex-col grow gap-2 p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
        >
          <p className="text-lg font-semibold mb-2">Change Timezone</p>
          <form
            className="flex gap-4 flex-col lg:flex-row"
            onSubmit={handleTimezoneSubmit}
          >
            <div className="flex relative grow">
              <span
                className="inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"
              >
                <ClockIcon />
              </span>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
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
              <button
                type="submit"
                className="font-medium px-4 py-2 text-gray-800 bg-gray-500 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                Submit
              </button>
            </div>
          </form>
        </div>

        {/* Devices Table */}
        <div
          className="flex flex-col grow p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
        >
          <p className="text-lg font-semibold">Devices</p>
          <table className="min-w-full bg-white dark:bg-gray-700 text-sm">
            <thead className="text-gray-800 dark:text-gray-400">
              <tr>
                <th
                  className="p-3 pl-0 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                >
                  Name
                </th>
                <th
                  className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                >
                  Last Sync
                </th>
                <th
                  className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                >
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="text-black dark:text-white">
              {!settingsData?.devices || settingsData.devices.length === 0 ? (
                <tr>
                  <td className="text-center p-3" colSpan={3}>No Results</td>
                </tr>
              ) : (
                settingsData.devices.map((device: any) => (
                  <tr key={device.id}>
                    <td className="p-3 pl-0">
                      <p>{device.device_name || 'Unknown'}</p>
                    </td>
                    <td className="p-3">
                      <p>{device.last_synced ? new Date(device.last_synced).toLocaleString() : 'N/A'}</p>
                    </td>
                    <td className="p-3">
                      <p>{device.created_at ? new Date(device.created_at).toLocaleString() : 'N/A'}</p>
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