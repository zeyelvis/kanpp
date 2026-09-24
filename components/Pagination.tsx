import Link from "next/link";

export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

export function Pagination({ basePath, page, totalPages }: { basePath: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const window = [page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= totalPages);
  const cls = "grid h-9 min-w-9 place-items-center rounded-md px-3 text-sm";
  return (
    <nav aria-label="分页" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={pageHref(basePath, page - 1)} rel="prev" className={`${cls} bg-surface hover:bg-surface-2`}>
          上一页
        </Link>
      ) : null}
      {window.map((p) =>
        p === page ? (
          <span key={p} aria-current="page" className={`${cls} bg-accent text-white`}>
            {p}
          </span>
        ) : (
          <Link key={p} href={pageHref(basePath, p)} className={`${cls} bg-surface hover:bg-surface-2`}>
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={pageHref(basePath, page + 1)} rel="next" className={`${cls} bg-surface hover:bg-surface-2`}>
          下一页
        </Link>
      ) : null}
    </nav>
  );
}
