import { useState, FormEvent } from 'react';
import { useGetLogs } from '../generated/anthoLumeAPIV1';
import { Button } from '../components/Button';
import { Search } from 'lucide-react';

export default function AdminLogsPage() {
  const [filter, setFilter] = useState('');

  const { data: logsData, isLoading, refetch } = useGetLogs(
    filter ? { filter } : {}
  );

  const logs = logsData?.data?.logs || [];

  const handleFilterSubmit = (e: FormEvent) => {
    e.preventDefault();
    refetch();
  };

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div>
      {/* Filter Form */}
      <div
        className="flex flex-col gap-2 grow p-4 mb-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
      >
        <form className="flex gap-4 flex-col lg:flex-row" onSubmit={handleFilterSubmit}>
          <div className="flex flex-col w-full grow">
            <div className="flex relative">
              <span
                className="inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"
              >
                <Search size={15} />
              </span>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-2 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                placeholder="JQ Filter"
              />
            </div>
          </div>
          <div className="lg:w-60">
            <Button variant="secondary" type="submit">Filter</Button>
          </div>
        </form>
      </div>

      {/* Log Display */}
      <div
        className="flex flex-col-reverse text-black dark:text-white w-full overflow-scroll"
        style={{ fontFamily: 'monospace' }}
      >
        {logs.map((log: string, index: number) => (
          <span key={index} className="whitespace-nowrap hover:whitespace-pre">
            {log}
          </span>
        ))}
      </div>
    </div>
  );
}