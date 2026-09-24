import Link from "next/link";
import type { ReactNode } from "react";

export function Rail({ title, href, children, id }: { title: string; href?: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-7xl px-4 pt-10">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 id={id} className="text-xl font-semibold">
          {title}
        </h2>
        {href ? (
          <Link href={href} className="text-sm text-muted hover:text-accent">
            查看全部 ›
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
