import { useGetImportResults } from '../generated/anthoLumeAPIV1';
import type { ImportResult, ImportResultsResponse } from '../generated/model';
import { Link } from 'react-router-dom';

export default function AdminImportResultsPage() {
  const { data: resultsData, isLoading } = useGetImportResults();
  const results =
    resultsData?.status === 200 ? (resultsData.data as ImportResultsResponse).results || [] : [];

  if (isLoading) {
    return <div className="text-content-muted">Loading...</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full overflow-hidden rounded shadow">
        <table className="min-w-full bg-surface text-sm leading-normal text-content">
          <thead className="text-content-muted">
            <tr>
              <th className="border-b border-border p-3 text-left font-normal uppercase">
                Document
              </th>
              <th className="border-b border-border p-3 text-left font-normal uppercase">
                Status
              </th>
              <th className="border-b border-border p-3 text-left font-normal uppercase">
                Error
              </th>
            </tr>
          </thead>
          <tbody>
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
                    className="grid border-b border-border p-3"
                    style={{ gridTemplateColumns: '4rem auto' }}
                  >
                    <span className="text-content-muted">Name:</span>
                    {result.id ? (
                      <Link to={`/documents/${result.id}`} className="text-secondary-600 hover:underline">
                        {result.name}
                      </Link>
                    ) : (
                      <span>N/A</span>
                    )}
                    <span className="text-content-muted">File:</span>
                    <span>{result.path}</span>
                  </td>
                  <td className="border-b border-border p-3">
                    <p>{result.status}</p>
                  </td>
                  <td className="border-b border-border p-3">
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
