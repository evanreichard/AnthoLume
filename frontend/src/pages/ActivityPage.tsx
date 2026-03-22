import { Link } from 'react-router-dom';
import { useGetActivity } from '../generated/anthoLumeAPIV1';
import type { Activity } from '../generated/model';
import { Table, type Column } from '../components/Table';
import { formatDuration } from '../utils/formatters';

export default function ActivityPage() {
  const { data, isLoading } = useGetActivity({ offset: 0, limit: 100 });
  const activities = data?.status === 200 ? data.data.activities : [];

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

  return <Table columns={columns} data={activities || []} loading={isLoading} />;
}
