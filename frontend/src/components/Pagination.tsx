interface PaginationProps {
  page: number;
  previousPage?: number;
  nextPage?: number;
  total?: number;
  limit?: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  previousPage,
  nextPage,
  total,
  limit,
  onPageChange,
}: PaginationProps) {
  if (!previousPage && !nextPage) {
    return null;
  }

  const totalPages = total && limit ? Math.ceil(total / limit) : undefined;

  return (
    <div className="mt-4 flex w-full items-center justify-center gap-4 text-content">
      {previousPage && previousPage > 0 ? (
        <button
          type="button"
          onClick={() => onPageChange(previousPage)}
          className="w-24 rounded bg-surface p-2 text-center text-sm font-medium shadow-lg hover:bg-surface-strong focus:outline-hidden"
        >
          ◄
        </button>
      ) : null}
      {totalPages ? (
        <span className="text-sm text-content-muted">
          Page {page} of {totalPages}
        </span>
      ) : null}
      {nextPage && nextPage > 0 ? (
        <button
          type="button"
          onClick={() => onPageChange(nextPage)}
          className="w-24 rounded bg-surface p-2 text-center text-sm font-medium shadow-lg hover:bg-surface-strong focus:outline-hidden"
        >
          ►
        </button>
      ) : null}
    </div>
  );
}
