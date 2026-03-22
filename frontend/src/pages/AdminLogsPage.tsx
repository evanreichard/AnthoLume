import { useState, FormEvent } from 'react';
import { useGetLogs } from '../generated/anthoLumeAPIV1';
import type { LogsResponse } from '../generated/model';
import { Button } from '../components/Button';
import { SearchIcon } from '../icons';

export default function AdminLogsPage() {
  const [filter, setFilter] = useState('');

  const { data: logsData, isLoading, refetch } = useGetLogs(filter ? { filter } : {});

  const logs = logsData?.status === 200 ? ((logsData.data as LogsResponse).logs ?? []) : [];

  const handleFilterSubmit = (e: FormEvent) => {
    e.preventDefault();
    refetch();
  };

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div>
      <div className="mb-4 flex grow flex-col gap-2 rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white">
        <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleFilterSubmit}>
          <div className="flex w-full grow flex-col">
            <div className="relative flex">
              <span className="inline-flex items-center border-y border-l border-gray-300 bg-white px-3 text-sm text-gray-500 shadow-sm">
                <SearchIcon size={15} />
              </span>
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white p-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
                placeholder="JQ Filter"
              />
            </div>
          </div>
          <div className="lg:w-60">
            <Button variant="secondary" type="submit">
              Filter
            </Button>
          </div>
        </form>
      </div>

      <div
        className="flex w-full flex-col-reverse overflow-scroll text-black dark:text-white"
        style={{ fontFamily: 'monospace' }}
      >
        {logs.map((log, index) => (
          <span key={index} className="whitespace-nowrap hover:whitespace-pre">
            {typeof log === 'string' ? log : JSON.stringify(log)}
          </span>
        ))}
      </div>
    </div>
  );
}
