import { useGetImportResults } from '../generated/anthoLumeAPIV1';
import type { ImportResult } from '../generated/model/importResult';
import { Link } from 'react-router-dom';

export default function AdminImportResultsPage() {
  const { data: resultsData, isLoading } = useGetImportResults();
  const results = resultsData?.data?.results || [];

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full overflow-hidden rounded shadow">
        <table className="min-w-full bg-white text-sm leading-normal dark:bg-gray-700">
          <thead className="text-gray-800 dark:text-gray-400">
            <tr>
              <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                Document
              </th>
              <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                Status
              </th>
              <th className="border-b border-gray-200 p-3 text-left font-normal uppercase dark:border-gray-800">
                Error
              </th>
            </tr>
          </thead>
          <tbody className="text-black dark:text-white">
            {results.length === 0 ? (
              <tr>
                <td className="p-3 text-center" colSpan={3}>
                  No Results
                </td>
              </tr>
            ) : (
              results.map((result: ImportResult, index: number) => (
                <tr key={index}>
                  <td
                    className="grid border-b border-gray-200 p-3"
                    style={{ gridTemplateColumns: '4rem auto' }}
                  >
                    <span className="text-gray-800 dark:text-gray-400">Name:</span>
                    {result.id ? (
                      <Link to={`/documents/${result.id}`}>{result.name}</Link>
                    ) : (
                      <span>N/A</span>
                    )}
                    <span className="text-gray-800 dark:text-gray-400">File:</span>
                    <span>{result.path}</span>
                  </td>
                  <td className="border-b border-gray-200 p-3">
                    <p>{result.status}</p>
                  </td>
                  <td className="border-b border-gray-200 p-3">
                    <p>{result.error || ''}</p>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
