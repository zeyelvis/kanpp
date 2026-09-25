import type { Metadata } from "next";
import Link from "next/link";
import { HeroCarousel } from "@/components/HeroCarousel";
import { ContinueRail } from "@/components/library/ContinueRail";
import { PosterRail } from "@/components/PosterRail";
import { TopicChips } from "@/components/TopicChips";
import { featuredTopics } from "@/lib/domain/topics";
import { ScrollRail } from "@/components/ScrollRail";
import { site } from "@/lib/config/site";
import { featuredTitles, latestByKind, topRated, upcomingEpisodes } from "@/lib/data/titles";
import { KIND_SEGMENT, type Kind } from "@/lib/domain/kinds";
import { shortDate } from "@/lib/domain/labels";
import { titlePath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

export const revalidate = 600;

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
  const [featured, upcoming, rated, ...rails] = await Promise.all([
    featuredTitles(8),
    upcomingEpisodes(7, 16),
    topRated(18),
    ...RAILS.map((r) => latestByKind(r.kind, 18)),
  ]);

  return (
    <>
      <h1 className="sr-only">
        {site.name} - {site.tagline}
      </h1>

      {featured.length > 0 ? (
        <HeroCarousel
          slides={featured.map((t) => ({
            id: t.id,
            kind: t.kind,
            slug: t.slug,
            name: t.name,
            year: t.year,
            genres: JSON.parse(t.genres) as string[],
            label: t.latest_label,
            overview: t.overview,
            backdrop: t.backdrop_path,
            rating: t.vote_average,
          }))}
        />
      ) : null}

      <ContinueRail />

      {upcoming.length > 0 ? (
        <ScrollRail id="upcoming" title="本周待播" href="/schedule">
          {upcoming.map((t) => (
            <li key={t.id} className="w-60 shrink-0 snap-start sm:w-64">
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
        </ScrollRail>
      ) : null}

      {RAILS.map((r, i) => (
        <PosterRail key={r.kind} id={`rail-${r.kind}`} title={r.title} href={`/${KIND_SEGMENT[r.kind]}`} titles={rails[i]} eager={i === 0 && featured.length === 0} />
      ))}

      <PosterRail id="rail-rated" title="高分佳作" titles={rated} />

      <div className="mx-auto max-w-7xl px-4 pt-10">
        <TopicChips title="热门专题" topics={featuredTopics()} />
        <Link href="/topic" className="mt-3 inline-block text-sm text-muted hover:text-accent">
          全部专题 ›
        </Link>
      </div>
    </>
  );
}
