import { useGetProgressList } from '../generated/anthoLumeAPIV1';
import type { Progress } from '../generated/model';
import { Pagination } from '../components';
import { Table, type Column } from '../components/Table';
import { documentColumn } from '../components/documentColumn';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { formatDate } from '../utils/formatters';

const PROGRESS_PAGE_SIZE = 15;

export default function ProgressPage() {
  const { page, setPage } = usePaginatedList();
  const limit = PROGRESS_PAGE_SIZE;
  const { data, isLoading } = useGetProgressList({ page, limit });
  const response = data;
  const progress = response?.progress ?? [];

  const columns: Column<Progress>[] = [
    documentColumn,
    {
      id: 'device_name',
      header: 'Device Name',
      render: row => row.device_name || 'Unknown',
    },
    {
      id: 'percentage',
      header: 'Percentage',
      render: row => `${Math.round(row.percentage)}%`,
    },
    {
      id: 'created_at',
      header: 'Created At',
      render: row => formatDate(row.created_at),
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
