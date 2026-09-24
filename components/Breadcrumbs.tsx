import Link from "next/link";

export interface Crumb {
  name: string;
  href: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="面包屑" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1">
            {i > 0 ? <span aria-hidden className="text-faint">›</span> : null}
            {i === items.length - 1 ? (
              <span aria-current="page" className="text-ink/80">
                {c.name}
              </span>
            ) : (
              <Link href={c.href} className="hover:text-accent">
                {c.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
