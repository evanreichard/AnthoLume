import { useSearchParams } from 'react-router-dom';
import { useGetActivity } from '../generated/anthoLumeAPIV1';
import type { Activity } from '../generated/model';
import { Pagination } from '../components';
import { Table, type Column } from '../components/Table';
import { documentColumn } from '../components/documentColumn';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { formatDuration, formatDateTime } from '../utils/formatters';
import { dataForStatus } from '../utils/apiResponses';

const ACTIVITY_PAGE_SIZE = 25;

export default function ActivityPage() {
  const [searchParams] = useSearchParams();
  const documentID = searchParams.get('document') || undefined;
  const { page, setPage } = usePaginatedList(documentID);
  const limit = ACTIVITY_PAGE_SIZE;

  const { data, isLoading } = useGetActivity({
    doc_filter: Boolean(documentID),
    document_id: documentID,
    page,
    limit,
  });
  const response = dataForStatus(data, 200);
  const activities = response?.activities ?? [];

  const columns: Column<Activity>[] = [
    documentColumn,
    {
      id: 'start_time',
      header: 'Time',
      render: row => formatDateTime(row.start_time),
    },
    {
      id: 'duration',
      header: 'Duration',
      render: row => formatDuration(row.duration ?? 0),
    },
    {
      id: 'end_percentage',
      header: 'Percent',
      render: row => (typeof row.end_percentage === 'number' ? `${row.end_percentage}%` : '0%'),
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
