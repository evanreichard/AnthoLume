import { Link } from 'react-router-dom';
import { useGetProgressList } from '../generated/anthoLumeAPIV1';

export default function ProgressPage() {
  const { data, isLoading } = useGetProgressList({ page: 1, limit: 15 });
  const progress = data?.data?.progress;

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full overflow-hidden rounded shadow">
        <table className="min-w-full bg-white dark:bg-gray-700">
          <thead>
            <tr className="border-b dark:border-gray-600">
              <th className="text-left p-3 text-gray-500 dark:text-white">Document</th>
              <th className="text-left p-3 text-gray-500 dark:text-white">Device Name</th>
              <th className="text-left p-3 text-gray-500 dark:text-white">Percentage</th>
              <th className="text-left p-3 text-gray-500 dark:text-white">Created At</th>
            </tr>
          </thead>
          <tbody>
            {progress?.map((row: any) => (
              <tr key={row.document_id} className="border-b dark:border-gray-600">
                <td className="p-3">
                  <Link 
                    to={`/documents/${row.document_id}`} 
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {row.author || 'Unknown'} - {row.title || 'Unknown'}
                  </Link>
                </td>
                <td className="p-3 text-gray-700 dark:text-gray-300">
                  {row.device_name || 'Unknown'}
                </td>
                <td className="p-3 text-gray-700 dark:text-gray-300">
                  {row.percentage ? Math.round(row.percentage) : 0}%
                </td>
                <td className="p-3 text-gray-700 dark:text-gray-300">
                  {row.created_at ? new Date(row.created_at).toLocaleDateString() : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}