import { useGetImportResults } from '../generated/anthoLumeAPIV1';
import { Table, type Column } from '../components';
import type { ImportResult } from '../generated/model';
import { Link } from 'react-router-dom';

export default function AdminImportResultsPage() {
  const { data: resultsData, isLoading } = useGetImportResults();
  const results = resultsData?.results ?? [];

  const columns: Column<ImportResult>[] = [
    {
      id: 'document',
      header: 'Document',
      render: result => (
        <div className="grid grid-cols-[4rem_auto] gap-y-1">
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
        </div>
      ),
    },
    { id: 'status', header: 'Status', render: result => result.status },
    { id: 'error', header: 'Error', render: result => result.error ?? '' },
  ];

  return (
    <Table
      columns={columns}
      data={results}
      loading={isLoading}
      rowKey={result => result.path ?? result.name ?? ''}
    />
  );
}
