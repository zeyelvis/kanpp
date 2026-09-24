"use client";

import Link from "next/link";
import { formatClock, removeHistory, useHistory } from "@/lib/client/library";
import { watchPath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

/** "继续观看" row on the home page; renders nothing until the viewer has history. */
export function ContinueRail() {
  const history = useHistory();
  if (history.length === 0) return null;
  return (
    <section aria-labelledby="continue" className="mx-auto max-w-7xl px-4 pt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="continue" className="text-lg font-semibold sm:text-xl">
          继续观看
        </h2>
        <Link href="/me?tab=history" className="text-sm text-muted hover:text-accent">
          观看记录 ›
        </Link>
      </div>
      <ul className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {history.slice(0, 12).map((h) => {
          const pct = h.duration ? Math.min(100, Math.round((h.t / h.duration) * 100)) : null;
          return (
            <li key={h.id} className="group relative w-56 shrink-0 snap-start sm:w-64">
              <Link href={watchPath(h.kind, h.slug, { season: h.season, ep: h.ep + 1 })} className="block">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line">
                  {h.backdrop || h.poster ? (
                    <img
                      src={h.backdrop ? tmdbImage(h.backdrop, "w780")! : tmdbImage(h.poster, "w342")!}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover opacity-80 transition group-hover:opacity-100"
                    />
                  ) : null}
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="grid size-10 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/30">▶</span>
                  </span>
                  {pct != null ? (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                      <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{h.name}</p>
                <p className="truncate text-xs text-faint">
                  {h.epName} · {formatClock(h.t)}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => removeHistory(h.id)}
                aria-label={`从观看记录移除${h.name}`}
                className="absolute right-1.5 top-1.5 hidden size-6 place-items-center rounded-full bg-black/70 text-xs text-white group-hover:grid"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
