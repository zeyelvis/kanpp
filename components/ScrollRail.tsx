"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";

/**
 * Horizontal, swipeable row with arrow buttons on pointer devices. Items are server-rendered
 * children, so the content stays in the HTML.
 */
export function ScrollRail({ title, href, id, children }: { title: string; href?: string; id: string; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
  const arrow = "hidden size-8 place-items-center rounded-full bg-surface ring-1 ring-line hover:ring-accent/60 sm:grid";
  return (
    <section aria-labelledby={id} className="mx-auto max-w-7xl px-4 pt-8 sm:pt-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold sm:text-xl">
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {href ? (
            <Link href={href} className="mr-1 text-sm text-muted hover:text-accent">
              更多 ›
            </Link>
          ) : null}
          <button type="button" aria-label="向左滚动" onClick={() => scroll(-1)} className={arrow}>
            ‹
          </button>
          <button type="button" aria-label="向右滚动" onClick={() => scroll(1)} className={arrow}>
            ›
          </button>
        </div>
      </div>
      <ul ref={ref} className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2">
        {children}
      </ul>
    </section>
  );
}
