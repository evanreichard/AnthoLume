import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetProgressList } from '../generated/anthoLumeAPIV1';
import type { Progress } from '../generated/model';
import { Pagination } from '../components';
import { Table, type Column } from '../components/Table';
import { dataForStatus } from '../utils/apiResponses';

const PROGRESS_PAGE_SIZE = 15;

export default function ProgressPage() {
  const [page, setPage] = useState(1);
  const limit = PROGRESS_PAGE_SIZE;
  const { data, isLoading } = useGetProgressList({ page, limit });
  const response = dataForStatus(data, 200);
  const progress = response?.progress ?? [];

  const columns: Column<Progress>[] = [
    {
      id: 'document',
      header: 'Document',
      render: row => (
        <Link to={`/documents/${row.document_id}`} className="text-secondary-600 hover:underline">
          {row.author || 'Unknown'} - {row.title || 'Unknown'}
        </Link>
      ),
    },
    {
      id: 'device_name',
      header: 'Device Name',
      render: row => row.device_name || 'Unknown',
    },
    {
      id: 'percentage',
      header: 'Percentage',
      render: row => (typeof row.percentage === 'number' ? `${Math.round(row.percentage)}%` : '0%'),
    },
    {
      id: 'created_at',
      header: 'Created At',
      render: row => (row.created_at ? new Date(row.created_at).toLocaleDateString() : 'N/A'),
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
