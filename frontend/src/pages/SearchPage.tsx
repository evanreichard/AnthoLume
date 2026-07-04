import { useState, SyntheticEvent } from 'react';
import { useGetSearch } from '../generated/anthoLumeAPIV1';
import { GetSearchSource } from '../generated/model/getSearchSource';
import type { SearchItem } from '../generated/model';
import { Button, Table, type Column, TextInput, IconInput } from '../components';
import { inputClassName } from '../components/TextInput';
import { useDebouncedState } from '../hooks/useDebouncedState';
import { Search2Icon, BookIcon } from '../icons';
import { dataForStatus } from '../utils/apiResponses';

const searchColumns: Column<SearchItem>[] = [
  {
    id: 'document',
    header: 'Document',
    render: item => `${item.author || 'N/A'} - ${item.title || 'N/A'}`,
  },
  { id: 'series', header: 'Series', render: item => item.series || 'N/A' },
  { id: 'type', header: 'Type', render: item => item.file_type || 'N/A' },
  { id: 'size', header: 'Size', render: item => item.file_size || 'N/A' },
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
              <IconInput icon={<Search2Icon size={15} hoverable={false} />}>
                <TextInput
                  type="text"
                  value={query}
                  onChange={e => onQueryChange(e.target.value)}
                  placeholder="Query"
                />
              </IconInput>
            </div>
            <IconInput className="min-w-[12em]" icon={<BookIcon size={15} />}>
              <select
                value={source}
                onChange={e => onSourceChange(e.target.value as GetSearchSource)}
                className={inputClassName}
              >
                <option value={GetSearchSource.LibGen}>Library Genesis</option>
                <option value={GetSearchSource.Annas_Archive}>Annas Archive</option>
              </select>
            </IconInput>
            <Button variant="secondary" type="submit" className="w-full lg:w-60">
              Search
            </Button>
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
  const results = dataForStatus(data, 200)?.results ?? [];

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
