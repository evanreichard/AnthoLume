import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetProgressList } from '../generated/anthoLumeAPIV1';
import type { Progress } from '../generated/model';
import { Pagination } from '../components';
import { Table, type Column } from '../components/Table';

export default function ProgressPage() {
  const [page, setPage] = useState(1);
  const limit = 15;
  const { data, isLoading } = useGetProgressList({ page, limit });
  const response = data?.status === 200 ? data.data : undefined;
  const progress = response?.progress ?? [];

  const columns: Column<Progress>[] = [
    {
      key: 'document_id' as const,
      header: 'Document',
      render: (_value, row) => (
        <Link to={`/documents/${row.document_id}`} className="text-secondary-600 hover:underline">
          {row.author || 'Unknown'} - {row.title || 'Unknown'}
        </Link>
      ),
    },
    {
      key: 'device_name' as const,
      header: 'Device Name',
      render: value => String(value || 'Unknown'),
    },
    {
      key: 'percentage' as const,
      header: 'Percentage',
      render: value => (typeof value === 'number' ? `${Math.round(value)}%` : '0%'),
    },
    {
      key: 'created_at' as const,
      header: 'Created At',
      render: value =>
        typeof value === 'string' && value ? new Date(value).toLocaleDateString() : 'N/A',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Table columns={columns} data={progress} loading={isLoading} />
      <Pagination
        page={page}
        previousPage={response?.previous_page}
        nextPage={response?.next_page}
        total={response?.total}
        limit={limit}
        onPageChange={setPage}
      />
    </div>
  );
}
