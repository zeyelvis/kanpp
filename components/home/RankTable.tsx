import Link from "next/link";
import type { TitleCard } from "@/lib/data/titles";
import { titlePath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

/** A chart page's list: rank, poster, name, year and progress. */
export function RankTable({ titles }: { titles: TitleCard[] }) {
  return (
    <ol className="divide-y divide-line">
      {titles.map((t, i) => {
        const rank = i + 1;
        const poster = tmdbImage(t.poster_path, "w185");
        return (
          <li key={t.id}>
            <Link href={titlePath(t.kind, t.slug)} className="group flex items-center gap-3 py-2.5">
              <span className={`w-8 shrink-0 text-center text-lg font-bold ${rank <= 3 ? "text-accent" : "text-faint"}`}>{rank}</span>
              {poster ? (
                <img src={poster} alt={`${t.name}海报`} width={46} height={69} loading={rank <= 8 ? "eager" : "lazy"} className="h-[69px] w-[46px] shrink-0 rounded object-cover ring-1 ring-line" />
              ) : (
                <span className="h-[69px] w-[46px] shrink-0 rounded bg-surface-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium group-hover:text-accent">{t.name}</span>
                <span className="block truncate text-sm text-muted">
                  {[t.year, t.latest_label].filter(Boolean).join(" · ")}
                  {t.vote_average ? <span className="ml-2 text-gold">★ {t.vote_average.toFixed(1)}</span> : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
