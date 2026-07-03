import { ReactNode } from 'react';
import { SkeletonTable } from './Skeleton';
import { cn } from '../utils/cn';

export interface Column<T> {
  id: string;
  header: ReactNode;
  className?: string;
  render: (row: T, index: number) => ReactNode;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: ReactNode;
  rowKey?: keyof T | ((row: T) => string);
}

export function Table<T>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No Results',
  rowKey,
}: TableProps<T>) {
  const getRowKey = (row: T, index: number): string => {
    if (typeof rowKey === 'function') {
      return rowKey(row);
    }
    if (rowKey) {
      return String(row[rowKey] ?? index);
    }
    return `row-${index}`;
  };

  if (loading) {
    return <SkeletonTable rows={5} columns={columns.length} />;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full overflow-hidden rounded shadow-sm">
        <table className="min-w-full bg-surface">
          <thead>
            <tr className="border-b border-border">
              {columns.map(column => (
                <th
                  key={column.id}
                  className={cn('p-3 text-left text-content-muted', column.className)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-3 text-center text-content-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr key={getRowKey(row, index)} className="border-b border-border">
                  {columns.map(column => (
                    <td key={column.id} className={cn('p-3 text-content', column.className)}>
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
