import { useEffect, useState } from "react";

export function usePagination<T>(items: T[], resetKey: string, pageSize = 10) {
  const [requestedPage, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  return {
    page,
    pageCount,
    pageSize,
    total: items.length,
    pageItems: items.slice((page - 1) * pageSize, page * pageSize),
    setPage,
  };
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Table pagination" className="table-pagination">
      <span>
        Showing {first}–{last} of {total}
      </span>
      <div className="table-pagination-controls">
        <button
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          aria-label="First page"
        >
          First
        </button>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
        >
          Previous
        </button>
        <span aria-live="polite">
          Page {page} of {pageCount}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === pageCount}
          aria-label="Next page"
        >
          Next
        </button>
        <button
          onClick={() => onPageChange(pageCount)}
          disabled={page === pageCount}
          aria-label="Last page"
        >
          Last
        </button>
      </div>
    </nav>
  );
}
