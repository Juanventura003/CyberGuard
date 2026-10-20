export default function ListPagination({
  page,
  total,
  pageSize,
  onPage,
  busy = false,
  label,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  busy?: boolean;
  label: string;
}) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return (
    <nav className="org-pagination" aria-label={`${label} pages`}>
      <span>
        Page {page + 1} of {pages} · {total} {label}
      </span>
      <div>
        <button disabled={busy || page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button
          disabled={busy || page + 1 >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
