import { Link } from 'react-router-dom';
import { useGetProgressList } from '../generated/anthoLumeAPIV1';
import type { Progress } from '../generated/model';
import { Table } from '../components/Table';

export default function ProgressPage() {
  const { data, isLoading } = useGetProgressList({ page: 1, limit: 15 });
  const progress = data?.status === 200 ? (data.data.progress ?? []) : [];

  const columns = [
    {
      key: 'document_id' as const,
      header: 'Document',
      render: (_value: Progress['document_id'], row: Progress) => (
        <Link
          to={`/documents/${row.document_id}`}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          {row.author || 'Unknown'} - {row.title || 'Unknown'}
        </Link>
      ),
    },
    {
      key: 'device_name' as const,
      header: 'Device Name',
      render: (value: Progress['device_name']) => value || 'Unknown',
    },
    {
      key: 'percentage' as const,
      header: 'Percentage',
      render: (value: Progress['percentage']) => (value ? `${Math.round(value)}%` : '0%'),
    },
    {
      key: 'created_at' as const,
      header: 'Created At',
      render: (value: Progress['created_at']) =>
        value ? new Date(value).toLocaleDateString() : 'N/A',
    },
  ];

  return <Table columns={columns} data={progress || []} loading={isLoading} />;
}
