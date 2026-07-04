import { SyntheticEvent } from 'react';
import { useGetLogs } from '../generated/anthoLumeAPIV1';
import { Button, LoadingState, TextInput, IconInput } from '../components';
import { useDebouncedState } from '../hooks/useDebouncedState';
import { Search2Icon } from '../icons';

export default function AdminLogsPage() {
  const [filter, setFilter, activeFilter, flushFilter] = useDebouncedState('', 300);

  const { data: logsData, isLoading } = useGetLogs(activeFilter ? { filter: activeFilter } : {});

  const logs = logsData?.logs ?? [];

  const handleFilterSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    flushFilter();
  };

  return (
    <div>
      <div className="mb-4 flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
        <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleFilterSubmit}>
          <div className="flex w-full grow flex-col">
            <IconInput icon={<Search2Icon size={15} hoverable={false} />}>
              <TextInput
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="p-2"
                placeholder="JQ Filter"
              />
            </IconInput>
          </div>
          <Button variant="secondary" type="submit" className="w-full lg:w-60">
            Filter
          </Button>
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
