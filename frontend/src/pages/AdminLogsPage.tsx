import { SyntheticEvent } from 'react';
import { useGetLogs } from '../generated/anthoLumeAPIV1';
import { Button } from '../components/Button';
import { LoadingState, TextInput } from '../components';
import { useDebouncedState } from '../hooks/useDebouncedState';
import { Search2Icon } from '../icons';

export default function AdminLogsPage() {
  const [filter, setFilter, activeFilter, flushFilter] = useDebouncedState('', 300);

  const { data: logsData, isLoading } = useGetLogs(activeFilter ? { filter: activeFilter } : {});

  const logs = logsData?.status === 200 ? (logsData.data.logs ?? []) : [];

  const handleFilterSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    flushFilter();
  };

  return (
    <div>
      <div className="mb-4 flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
        <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleFilterSubmit}>
          <div className="flex w-full grow flex-col">
            <div className="relative flex">
              <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-xs">
                <Search2Icon size={15} hoverable={false} />
              </span>
              <TextInput
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="p-2"
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

      <div className="flex w-full flex-col-reverse overflow-scroll font-mono text-content">
        {isLoading ? (
          <LoadingState className="min-h-40 w-full" />
        ) : (
          // Key By Index - Log lines have no stable id and can repeat; this list is append-only and fully replaced on refetch.
          logs.map((log, index) => (
            <span key={index} className="whitespace-nowrap hover:whitespace-pre">
              {typeof log === 'string' ? log : JSON.stringify(log)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
