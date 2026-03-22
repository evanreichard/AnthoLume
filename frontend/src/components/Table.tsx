import React from 'react';
import { Skeleton } from './Skeleton';
import { cn } from '../utils/cn';

export interface Column<T extends object> {
  key: keyof T;
  header: string;
  render?: (value: T[keyof T], _row: T, _index: number) => React.ReactNode;
  className?: string;
}

export interface TableProps<T extends object> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  rowKey?: keyof T | ((row: T) => string);
}

function SkeletonTable({
  rows = 5,
  columns = 4,
  className = '',
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg bg-white dark:bg-gray-700', className)}>
      <table className="min-w-full">
        <thead>
          <tr className="border-b dark:border-gray-600">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="p-3">
                <Skeleton variant="text" className="h-5 w-3/4" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex} className="border-b last:border-0 dark:border-gray-600">
              {Array.from({ length: columns }).map((_, colIndex) => (
                <td key={colIndex} className="p-3">
                  <Skeleton
                    variant="text"
                    className={colIndex === columns - 1 ? 'w-1/2' : 'w-full'}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Table<T extends object>({
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
      <div className="inline-block min-w-full overflow-hidden rounded shadow">
        <table className="min-w-full bg-white dark:bg-gray-700">
          <thead>
            <tr className="border-b dark:border-gray-600">
              {columns.map(column => (
                <th
                  key={String(column.key)}
                  className={`p-3 text-left text-gray-500 dark:text-white ${column.className || ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="p-3 text-center text-gray-700 dark:text-gray-300"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr key={getRowKey(row, index)} className="border-b dark:border-gray-600">
                  {columns.map(column => (
                    <td
                      key={`${getRowKey(row, index)}-${String(column.key)}`}
                      className={`p-3 text-gray-700 dark:text-gray-300 ${column.className || ''}`}
                    >
                      {column.render
                        ? column.render(row[column.key], row, index)
                        : (row[column.key] as React.ReactNode)}
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
