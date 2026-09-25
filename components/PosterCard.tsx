import Link from "next/link";
import type { TitleCard } from "@/lib/data/titles";
import { titlePath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

/** `note`: an extra line under the year, e.g. the role on a person page. */
export function PosterCard({ title, eager = false, note = null }: { title: TitleCard; eager?: boolean; note?: string | null }) {
  const poster = tmdbImage(title.poster_path, "w342");
  return (
    <Link href={titlePath(title.kind, title.slug)} className="group block min-w-0">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line">
        {poster ? (
          // Plain <img>: TMDB serves pre-sized posters, no optimizer round-trip needed.
          <img
            src={poster}
            alt={`${title.name}海报`}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            width={342}
            height={513}
            className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center p-2 text-center text-sm text-muted">{title.name}</div>
        )}
        {title.latest_label ? (
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-6 text-xs text-ink/90">
            {title.latest_label}
          </span>
        ) : null}
      </div>
      <p className="mt-2 truncate text-sm font-medium text-ink group-hover:text-accent">{title.name}</p>
      <p className="truncate text-xs text-faint">
        {title.year ?? ""}
        {title.vote_average ? <span className="ml-2 text-gold">★ {title.vote_average.toFixed(1)}</span> : null}
      </p>
      {note ? <p className="truncate text-xs text-muted">{note}</p> : null}
    </Link>
  );
}

export function PosterGrid({ titles, eagerCount = 0 }: { titles: TitleCard[]; eagerCount?: number }) {
  return (
    <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {titles.map((t, i) => (
        <li key={t.id}>
          <PosterCard title={t} eager={i < eagerCount} />
        </li>
      ))}
    </ul>
  );
}
