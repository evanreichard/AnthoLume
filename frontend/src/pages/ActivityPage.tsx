import { Link } from 'react-router-dom';
import { useGetActivity } from '../generated/anthoLumeAPIV1';
import { Table } from '../components/Table';

export default function ActivityPage() {
  const { data, isLoading } = useGetActivity({ offset: 0, limit: 100 });
  const activities = data?.data?.activities;

  const columns = [
    {
      key: 'document_id' as const,
      header: 'Document',
      render: (_: any, row: any) => (
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
      render: (value: any) => value || 'N/A',
    },
    {
      key: 'duration' as const,
      header: 'Duration',
      render: (value: any) => {
        if (!value) return 'N/A';
        // Format duration (in seconds) to readable format
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const seconds = value % 60;
        if (hours > 0) {
          return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
          return `${minutes}m ${seconds}s`;
        } else {
          return `${seconds}s`;
        }
      },
    },
    {
      key: 'end_percentage' as const,
      header: 'Percent',
      render: (value: any) => (value != null ? `${value}%` : '0%'),
    },
  ];

  return <Table columns={columns} data={activities || []} loading={isLoading} />;
}
