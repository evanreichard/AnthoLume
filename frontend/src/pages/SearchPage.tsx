import { useState, FormEvent } from 'react';
import { useGetSearch } from '../generated/anthoLumeAPIV1';
import { GetSearchSource } from '../generated/model/getSearchSource';
import { SearchIcon, DownloadIcon } from '../icons';
import { Book } from 'lucide-react';
import { Button } from '../components/Button';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<GetSearchSource>(GetSearchSource.LibGen);

  const { data, isLoading } = useGetSearch({ query, source });
  const results = data?.data?.results;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Trigger refetch by updating query
  };

  return (
    <div className="flex w-full flex-col gap-4 md:flex-row">
      <div className="flex grow flex-col gap-4">
        {/* Search Form */}
        <div className="flex grow flex-col gap-2 rounded bg-white p-4 text-gray-500 shadow-lg dark:bg-gray-700 dark:text-white">
          <form className="flex flex-col gap-4 lg:flex-row" onSubmit={handleSubmit}>
            <div className="flex w-full grow flex-col">
              <div className="relative flex">
                <span className="inline-flex items-center border-y border-l border-gray-300 bg-white px-3 text-sm text-gray-500 shadow-sm">
                  <SearchIcon size={15} />
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
                  placeholder="Query"
                />
              </div>
            </div>
            <div className="relative flex min-w-[12em]">
              <span className="inline-flex items-center border-y border-l border-gray-300 bg-white px-3 text-sm text-gray-500 shadow-sm">
                <Book size={15} />
              </span>
              <select
                value={source}
                onChange={e => setSource(e.target.value as GetSearchSource)}
                className="w-full flex-1 appearance-none rounded-none border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-600"
              >
                <option value="LibGen">Library Genesis</option>
                <option value="Annas Archive">Annas Archive</option>
              </select>
            </div>
            <div className="lg:w-60">
              <Button variant="secondary" type="submit">
                Search
              </Button>
            </div>
          </form>
        </div>

        {/* Search Results Table */}
        <div className="inline-block min-w-full overflow-hidden rounded shadow">
          <table className="min-w-full bg-white text-sm leading-normal md:text-sm dark:bg-gray-700">
            <thead className="text-gray-800 dark:text-gray-400">
              <tr>
                <th className="w-12 border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800"></th>
                <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                  Document
                </th>
                <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                  Series
                </th>
                <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                  Type
                </th>
                <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                  Size
                </th>
                <th className="hidden border-b border-gray-200 p-3 text-left font-normal uppercase md:block dark:border-gray-800">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="text-black dark:text-white">
              {isLoading && (
                <tr>
                  <td className="p-3 text-center" colSpan={6}>
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && !results && (
                <tr>
                  <td className="p-3 text-center" colSpan={6}>
                    No Results
                  </td>
                </tr>
              )}
              {!isLoading &&
                results &&
                results.map((item: any) => (
                  <tr key={item.id}>
                    <td className="border-b border-gray-200 p-3 text-gray-500 dark:text-gray-500">
                      <button className="hover:text-purple-600" title="Download">
                        <DownloadIcon size={15} />
                      </button>
                    </td>
                    <td className="border-b border-gray-200 p-3">
                      {item.author || 'N/A'} - {item.title || 'N/A'}
                    </td>
                    <td className="border-b border-gray-200 p-3">
                      <p>{item.series || 'N/A'}</p>
                    </td>
                    <td className="border-b border-gray-200 p-3">
                      <p>{item.file_type || 'N/A'}</p>
                    </td>
                    <td className="border-b border-gray-200 p-3">
                      <p>{item.file_size || 'N/A'}</p>
                    </td>
                    <td className="hidden border-b border-gray-200 p-3 md:table-cell">
                      <p>{item.upload_date || 'N/A'}</p>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
