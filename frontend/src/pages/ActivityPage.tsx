import { useGetActivity } from '../generated/anthoLumeAPIV1';

export default function ActivityPage() {
  const { data, isLoading } = useGetActivity({ offset: 0, limit: 100 });
  const activities = data?.data?.activities;

  if (isLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full overflow-hidden rounded shadow">
        <table className="min-w-full bg-white dark:bg-gray-700">
          <thead>
            <tr className="border-b dark:border-gray-600">
              <th className="text-left p-3 text-gray-500 dark:text-white">Activity Type</th>
              <th className="text-left p-3 text-gray-500 dark:text-white">Document</th>
              <th className="text-left p-3 text-gray-500 dark:text-white">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {activities?.map((activity: any) => (
              <tr key={activity.id} className="border-b dark:border-gray-600">
                <td className="p-3 text-gray-700 dark:text-gray-300">
                  {activity.activity_type}
                </td>
                <td className="p-3">
                  <a href={`/documents/${activity.document_id}`} className="text-blue-600 dark:text-blue-400">
                    {activity.document_id}
                  </a>
                </td>
                <td className="p-3 text-gray-700 dark:text-gray-300">
                  {new Date(activity.timestamp).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}