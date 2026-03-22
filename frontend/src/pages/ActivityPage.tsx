import { Link } from 'react-router-dom';
import { useGetActivity } from '../generated/anthoLumeAPIV1';
import type { Activity } from '../generated/model';
import { Table } from '../components/Table';
import { formatDuration } from '../utils/formatters';

export default function ActivityPage() {
  const { data, isLoading } = useGetActivity({ offset: 0, limit: 100 });
  const activities = data?.status === 200 ? data.data.activities : [];

  const columns = [
    {
      key: 'document_id' as const,
      header: 'Document',
      render: (_value: Activity['document_id'], row: Activity) => (
        <Link
          to={`/documents/${row.document_id}`}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          {row.author || 'Unknown'} - {row.title || 'Unknown'}
        </Link>
      ),
    },
    {
      key: 'start_time' as const,
      header: 'Time',
      render: (value: Activity['start_time']) => value || 'N/A',
    },
    {
      key: 'duration' as const,
      header: 'Duration',
      render: (value: Activity['duration']) => {
        return formatDuration(value || 0);
      },
    },
    {
      key: 'end_percentage' as const,
      header: 'Percent',
      render: (value: Activity['end_percentage']) => (value != null ? `${value}%` : '0%'),
    },
  ];

  return <Table columns={columns} data={activities || []} loading={isLoading} />;
}
