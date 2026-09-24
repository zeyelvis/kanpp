"use client";

import Link from "next/link";
import { useState } from "react";
import type { Kind } from "@/lib/domain/kinds";
import { watchPath } from "@/lib/domain/slug";

const RANGE = 50;

/** Episode shortcuts on title/season pages; long runs are split into 50-episode ranges. */
export function EpisodeLinks({ kind, slug, season, names }: { kind: Kind; slug: string; season: number | null; names: string[] }) {
  const ranges = names.length > 60 ? Math.ceil(names.length / RANGE) : 1;
  const [range, setRange] = useState(ranges - 1); // newest episodes first for long-running shows
  const start = ranges > 1 ? range * RANGE : 0;
  const shown = ranges > 1 ? names.slice(start, start + RANGE) : names;
  return (
    <div>
      {ranges > 1 ? (
        <div className="scrollbar-none mb-3 flex gap-2 overflow-x-auto">
          {Array.from({ length: ranges }, (_, r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`shrink-0 rounded-md px-3 py-1 text-xs ${r === range ? "bg-ink text-black" : "bg-surface-2 text-muted hover:text-ink"}`}
            >
              {r * RANGE + 1}-{Math.min((r + 1) * RANGE, names.length)}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
        {shown.map((name, k) => (
          <li key={start + k}>
            <Link
              href={watchPath(kind, slug, { season, ep: start + k + 1 })}
              className="block truncate rounded-md bg-surface-2 px-2 py-2 text-center text-sm transition hover:bg-accent hover:text-white"
            >
              {name}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
