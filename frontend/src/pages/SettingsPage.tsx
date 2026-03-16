import { useState, FormEvent } from 'react';
import { useGetSettings } from '../generated/anthoLumeAPIV1';
import { User, Lock, Clock } from 'lucide-react';
import { Button } from '../components/Button';

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
          <User size={60} />
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
                  <Lock size={15} />
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
                  <Lock size={15} />
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
              <Button variant="secondary" type="submit">Submit</Button>
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
                <Clock size={15} />
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
              <Button variant="secondary" type="submit">Submit</Button>
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