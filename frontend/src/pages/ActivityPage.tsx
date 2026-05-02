import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useGetActivity } from '../generated/anthoLumeAPIV1';
import type { Activity } from '../generated/model';
import { Pagination } from '../components';
import { Table, type Column } from '../components/Table';
import { formatDuration } from '../utils/formatters';

export default function ActivityPage() {
  const [searchParams] = useSearchParams();
  const documentID = searchParams.get('document') || undefined;
  const [page, setPage] = useState(1);
  const limit = 25;

  useEffect(() => {
    setPage(1);
  }, [documentID]);

  const { data, isLoading } = useGetActivity({
    doc_filter: Boolean(documentID),
    document_id: documentID,
    page,
    limit,
  });
  const response = data?.status === 200 ? data.data : undefined;
  const activities = response?.activities ?? [];

  const columns: Column<Activity>[] = [
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
      key: 'start_time' as const,
      header: 'Time',
      render: value => String(value || 'N/A'),
    },
    {
      key: 'duration' as const,
      header: 'Duration',
      render: value => formatDuration(typeof value === 'number' ? value : 0),
    },
    {
      key: 'end_percentage' as const,
      header: 'Percent',
      render: value => (typeof value === 'number' ? `${value}%` : '0%'),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Table columns={columns} data={activities} loading={isLoading} />
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
