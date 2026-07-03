import { useState, SyntheticEvent } from 'react';
import { useGetSearch } from '../generated/anthoLumeAPIV1';
import { GetSearchSource } from '../generated/model/getSearchSource';
import type { SearchItem } from '../generated/model';
import { Button } from '../components/Button';
import { TextInput } from '../components';
import { inputClassName } from '../components/TextInput';
import { Table, type Column } from '../components/Table';
import { useDebouncedState } from '../hooks/useDebouncedState';
import { Search2Icon, DownloadIcon, BookIcon } from '../icons';

const searchColumns: Column<SearchItem>[] = [
  {
    id: 'download',
    header: '',
    className: 'w-12 text-content-muted',
    render: () => (
      <button className="hover:text-primary-600" title="Download">
        <DownloadIcon size={15} />
      </button>
    ),
  },
  { id: 'document', header: 'Document', render: item => `${item.author || 'N/A'} - ${item.title || 'N/A'}` },
  { id: 'series', header: 'Series', render: item => item.series || 'N/A' },
  { id: 'type', header: 'Type', render: item => item.file_type || 'N/A' },
  { id: 'size', header: 'Size', render: item => item.file_size || 'N/A' },
  {
    id: 'date',
    header: 'Date',
    className: 'hidden md:table-cell',
    render: item => item.upload_date || 'N/A',
  },
];

interface SearchPageViewProps {
  query: string;
  source: GetSearchSource;
  isLoading: boolean;
  results: SearchItem[];
  onQueryChange: (value: string) => void;
  onSourceChange: (value: GetSearchSource) => void;
  onSubmit: (e: SyntheticEvent<HTMLFormElement>) => void;
}

export function getSearchResults(data: unknown): SearchItem[] {
  if (!data || typeof data !== 'object') {
    return [];
  }

  if (!('status' in data) || data.status !== 200) {
    return [];
  }

  if (!('data' in data) || !data.data || typeof data.data !== 'object') {
    return [];
  }

  if (!('results' in data.data) || !Array.isArray(data.data.results)) {
    return [];
  }

  return data.data.results as SearchItem[];
}

export function SearchPageView({
  query,
  source,
  isLoading,
  results,
  onQueryChange,
  onSourceChange,
  onSubmit,
}: SearchPageViewProps) {
  return (
    <div className="flex w-full flex-col gap-4 md:flex-row">
      <div className="flex grow flex-col gap-4">
        <div className="flex grow flex-col gap-2 rounded bg-surface p-4 text-content-muted shadow-lg">
          <form className="flex flex-col gap-4 lg:flex-row" onSubmit={onSubmit}>
            <div className="flex w-full grow flex-col">
              <div className="relative flex">
                <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-xs">
                  <Search2Icon size={15} hoverable={false} />
                </span>
                <TextInput
                  type="text"
                  value={query}
                  onChange={e => onQueryChange(e.target.value)}
                  placeholder="Query"
                />
              </div>
            </div>
            <div className="relative flex min-w-[12em]">
              <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-xs">
                <BookIcon size={15} />
              </span>
              <select
                value={source}
                onChange={e => onSourceChange(e.target.value as GetSearchSource)}
                className={inputClassName}
              >
                <option value={GetSearchSource.LibGen}>Library Genesis</option>
                <option value={GetSearchSource.Annas_Archive}>Annas Archive</option>
              </select>
            </div>
            <div className="lg:w-60">
              <Button variant="secondary" type="submit">
                Search
              </Button>
            </div>
          </form>
        </div>

        <Table columns={searchColumns} data={results} loading={isLoading} rowKey="id" />
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [query, setQuery, activeQuery, flushQuery] = useDebouncedState('', 300);
  const [source, setSource] = useState<GetSearchSource>(GetSearchSource.LibGen);

  const { data, isLoading } = useGetSearch(
    { query: activeQuery, source },
    {
      query: {
        enabled: activeQuery.trim().length > 0,
      },
    }
  );
  const results = getSearchResults(data);

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    flushQuery(query.trim());
  };

  return (
    <SearchPageView
      query={query}
      source={source}
      isLoading={isLoading}
      results={results}
      onQueryChange={setQuery}
      onSourceChange={setSource}
      onSubmit={handleSubmit}
    />
  );
}
