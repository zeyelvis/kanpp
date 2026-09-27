import type { Metadata } from "next";
import Link from "next/link";
import { HeroCarousel } from "@/components/HeroCarousel";
import { HotSection } from "@/components/home/HotSection";
import { ContinueRail } from "@/components/library/ContinueRail";
import { PosterRail } from "@/components/PosterRail";
import { TopicChips } from "@/components/TopicChips";
import { featuredTopics } from "@/lib/domain/topics";
import { ScrollRail } from "@/components/ScrollRail";
import { DEFAULT_OG_IMAGE, site } from "@/lib/config/site";
import { heroTitles, hotTitles, SECTIONS, type ChartKind, type HotSpec } from "@/lib/data/home";
import { latestByKind, topRated, upcomingEpisodes } from "@/lib/data/titles";
import { KIND_SEGMENT } from "@/lib/domain/kinds";
import { shortDate } from "@/lib/domain/labels";
import { titlePath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

export const revalidate = 600;

export const metadata: Metadata = {
  // The brand alone is not searched: name what the site has.
  title: { absolute: `${site.name} - 在线看电视剧、电影、动漫、综艺 | ${site.tagline}` },
  alternates: { canonical: "/" },
  openGraph: { url: "/", images: [DEFAULT_OG_IMAGE] },
};

// Sections in the order Chinese streaming sites use; each with its chart (lib/data/home.ts).
const SECTION_META: { kind: ChartKind; title: string; chart: string }[] = [
  { kind: "tv", title: "热播剧集", chart: "电视剧热播榜" },
  { kind: "movie", title: "热门电影", chart: "电影热度榜" },
  { kind: "anime", title: "动漫番剧", chart: "动漫热播榜" },
  { kind: "variety", title: "热门综艺", chart: "综艺热播榜" },
];

const HERO_SPECS: HotSpec[] = [
  SECTIONS.tv.tabs[0].spec,
  SECTIONS.movie.tabs[0].spec,
  SECTIONS.anime.tabs[0].spec,
  SECTIONS.tv.tabs[1].spec,
  SECTIONS.movie.tabs[1].spec,
  SECTIONS.anime.tabs[1].spec,
  SECTIONS.variety.tabs[0].spec,
];

export default async function HomePage() {
  const [featured, upcoming, rated, latest, sections] = await Promise.all([
    heroTitles(HERO_SPECS, 8),
    upcomingEpisodes(7, 16),
    topRated(18),
    latestByKind(null, 18),
    Promise.all(
      SECTION_META.map(async (m) => ({
        ...m,
        tabs: await Promise.all(SECTIONS[m.kind].tabs.map(async (t) => ({ label: t.label, titles: await hotTitles(t.spec, 12) }))),
        chartTitles: await hotTitles(SECTIONS[m.kind].chart, 10),
      })),
    ),
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

      {sections.map((s, i) => (
        <HotSection
          key={s.kind}
          id={`hot-${s.kind}`}
          title={s.title}
          href={`/${KIND_SEGMENT[s.kind]}`}
          tabs={s.tabs}
          chart={{ title: s.chart, href: `/rank/${s.kind}`, titles: s.chartTitles }}
          eager={i === 0 && featured.length === 0}
        />
      ))}

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

      <PosterRail id="rail-latest" title="最近更新" titles={latest} />
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
