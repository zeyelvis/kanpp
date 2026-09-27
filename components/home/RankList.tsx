import Link from "next/link";
import type { TitleCard } from "@/lib/data/titles";
import { titlePath } from "@/lib/domain/slug";

/** A numbered chart: the first three stand out. */
export function RankList({ titles, start = 1 }: { titles: TitleCard[]; start?: number }) {
  return (
    <ol className="space-y-1">
      {titles.map((t, i) => {
        const rank = start + i;
        return (
          <li key={t.id}>
            <Link href={titlePath(t.kind, t.slug)} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <span
                className={`grid size-6 shrink-0 place-items-center rounded text-xs font-bold ${rank <= 3 ? "bg-accent text-black" : "bg-surface-2 text-muted"}`}
              >
                {rank}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm group-hover:text-accent">{t.name}</span>
              {t.latest_label ? <span className="max-w-[40%] shrink-0 truncate text-xs text-faint">{t.latest_label}</span> : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
