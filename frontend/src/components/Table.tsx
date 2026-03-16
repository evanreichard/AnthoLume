import React from 'react';

export interface Column<T> {
  key: keyof T;
  header: string;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  className?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  rowKey?: keyof T | ((row: T) => string);
}

export function Table<T extends Record<string, any>>({
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
    return (
      <div className="text-gray-500 dark:text-white p-4">Loading...</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full overflow-hidden rounded shadow">
        <table className="min-w-full bg-white dark:bg-gray-700">
          <thead>
            <tr className="border-b dark:border-gray-600">
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  className={`text-left p-3 text-gray-500 dark:text-white ${column.className || ''}`}
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
                  className="text-center p-3 text-gray-700 dark:text-gray-300"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr
                  key={getRowKey(row, index)}
                  className="border-b dark:border-gray-600"
                >
                  {columns.map((column) => (
                    <td
                      key={`${getRowKey(row, index)}-${String(column.key)}`}
                      className={`p-3 text-gray-700 dark:text-gray-300 ${column.className || ''}`}
                    >
                      {column.render
                        ? column.render(row[column.key], row, index)
                        : row[column.key]}
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
