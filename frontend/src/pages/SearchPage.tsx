import { useState, FormEvent } from 'react';
import { useGetSearch } from '../generated/anthoLumeAPIV1';
import { GetSearchSource } from '../generated/model/getSearchSource';

// Search icon SVG
function SearchIcon() {
  return (
    <svg className="w-15 h-15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-6-6" />
    </svg>
  );
}

// Documents icon SVG
function DocumentsIcon() {
  return (
    <svg className="w-15 h-15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

// Download icon SVG
function DownloadIcon() {
  return (
    <svg className="w-15 h-15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="21 15 16 10 8 10" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

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
    <div className="w-full flex flex-col md:flex-row gap-4">
      <div className="flex flex-col gap-4 grow">
        {/* Search Form */}
        <div
          className="flex flex-col gap-2 grow p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
        >
          <form className="flex gap-4 flex-col lg:flex-row" onSubmit={handleSubmit}>
            <div className="flex flex-col w-full grow">
              <div className="flex relative">
                <span
                  className="inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"
                >
                  <SearchIcon />
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                  placeholder="Query"
                />
              </div>
            </div>
            <div className="flex relative min-w-[12em]">
              <span
                className="inline-flex items-center px-3 border-t bg-white border-l border-b border-gray-300 text-gray-500 shadow-sm text-sm"
              >
                <DocumentsIcon />
              </span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as GetSearchSource)}
                className="flex-1 appearance-none rounded-none border border-gray-300 w-full py-2 px-4 bg-white text-gray-700 placeholder-gray-400 shadow-sm text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
              >
                <option value="LibGen">Library Genesis</option>
                <option value="Annas Archive">Annas Archive</option>
              </select>
            </div>
            <div className="lg:w-60">
              <button
                type="submit"
                className="font-medium px-4 py-2 text-gray-800 bg-gray-500 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                Search
              </button>
            </div>
          </form>
        </div>

        {/* Search Results Table */}
        <div className="inline-block min-w-full overflow-hidden rounded shadow">
          <table
            className="min-w-full leading-normal bg-white dark:bg-gray-700 text-sm md:text-sm"
          >
            <thead className="text-gray-800 dark:text-gray-400">
              <tr>
                <th
                  className="w-12 p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                ></th>
                <th
                  className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                >
                  Document
                </th>
                <th
                  className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                >
                  Series
                </th>
                <th
                  className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                >
                  Type
                </th>
                <th
                  className="p-3 font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                >
                  Size
                </th>
                <th
                  className="p-3 hidden md:block font-normal text-left uppercase border-b border-gray-200 dark:border-gray-800"
                >
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="text-black dark:text-white">
              {isLoading && (
                <tr>
                  <td className="text-center p-3" colSpan={6}>Loading...</td>
                </tr>
              )}
              {!isLoading && !results && (
                <tr>
                  <td className="text-center p-3" colSpan={6}>No Results</td>
                </tr>
              )}
              {!isLoading && results && results.map((item: any) => (
                <tr key={item.id}>
                  <td
                    className="p-3 border-b border-gray-200 text-gray-500 dark:text-gray-500"
                  >
                    <button
                      className="hover:text-purple-600"
                      title="Download"
                    >
                      <DownloadIcon />
                    </button>
                  </td>
                  <td className="p-3 border-b border-gray-200">
                    {item.author || 'N/A'} - {item.title || 'N/A'}
                  </td>
                  <td className="p-3 border-b border-gray-200">
                    <p>{item.series || 'N/A'}</p>
                  </td>
                  <td className="p-3 border-b border-gray-200">
                    <p>{item.file_type || 'N/A'}</p>
                  </td>
                  <td className="p-3 border-b border-gray-200">
                    <p>{item.file_size || 'N/A'}</p>
                  </td>
                  <td className="hidden md:table-cell p-3 border-b border-gray-200">
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