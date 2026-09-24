import type { Metadata } from "next";
import Link from "next/link";
import { PosterGrid } from "@/components/PosterCard";
import { Rail } from "@/components/Rail";
import { site } from "@/lib/config/site";
import { latestByKind, upcomingEpisodes } from "@/lib/data/titles";
import { KIND_LABEL, KIND_SEGMENT, type Kind } from "@/lib/domain/kinds";
import { shortDate } from "@/lib/domain/labels";
import { titlePath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

const RAILS: { kind: Kind; title: string }[] = [
  { kind: "tv", title: "剧集更新" },
  { kind: "movie", title: "最新电影" },
  { kind: "anime", title: "动漫更新" },
  { kind: "variety", title: "综艺更新" },
  { kind: "doc", title: "纪录片" },
];

export default async function HomePage() {
  const [upcoming, ...rails] = await Promise.all([upcomingEpisodes(7, 12), ...RAILS.map((r) => latestByKind(r.kind, 12))]);

  return (
    <>
      <section className="mx-auto max-w-7xl px-4 pt-8">
        <h1 className="text-2xl font-bold sm:text-3xl">
          {site.name}
          <span className="ml-3 text-base font-normal text-muted sm:text-lg">{site.tagline}</span>
        </h1>
      </section>

      {upcoming.length > 0 ? (
        <Rail title="本周待播" id="upcoming" href="/schedule">
          <ul className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {upcoming.map((t) => (
              <li key={t.id} className="w-64 shrink-0">
                <Link href={titlePath(t.kind, t.slug)} className="flex gap-3 rounded-xl bg-surface p-2 ring-1 ring-line hover:ring-accent/60">
                  {t.poster_path ? (
                    <img src={tmdbImage(t.poster_path, "w185")!} alt={`${t.name}海报`} width={64} height={96} loading="lazy" className="h-24 w-16 shrink-0 rounded-md object-cover" />
                  ) : null}
                  <div className="min-w-0 py-1">
                    <p className="truncate font-medium">{t.name}</p>
                    <p className="mt-1 text-sm text-accent">{shortDate(t.next_episode_date)}</p>
                    {t.next_episode_number ? (
                      <p className="text-xs text-muted">
                        {t.next_episode_season && t.next_episode_season > 1 ? `第${t.next_episode_season}季 ` : ""}第{t.next_episode_number}集
                      </p>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Rail>
      ) : null}

      {RAILS.map((r, i) =>
        rails[i].length > 0 ? (
          <Rail key={r.kind} title={r.title} href={`/${KIND_SEGMENT[r.kind]}`} id={`rail-${r.kind}`}>
            <PosterGrid titles={rails[i]} eagerCount={i === 0 ? 6 : 0} />
          </Rail>
        ) : null,
      )}

      {rails.every((r) => r.length === 0) ? (
        <p className="mx-auto max-w-7xl px-4 pt-10 text-muted">片库正在建设中，请稍后再来。{KIND_LABEL.movie}、{KIND_LABEL.tv}即将上线。</p>
      ) : null}
    </>
  );
}
