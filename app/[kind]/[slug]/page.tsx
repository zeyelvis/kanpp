import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { PosterGrid } from "@/components/PosterCard";
import { lookupTitleForMetadata, resolveTitleRoute } from "@/lib/data/resolve-page";
import { getLines, getSeasons, relatedTitles, type Line, type Season, type TitleDetail } from "@/lib/data/titles";
import { KIND_LABEL, KIND_SEGMENT } from "@/lib/domain/kinds";
import { countryLabel, formatRuntime, isNextEpisodeAhead, shortDate, tvStatusLabel } from "@/lib/domain/labels";
import { seasonPath, titlePath, watchPath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";
import { describeTitle, pageTitle, titleJsonLd } from "@/lib/seo/title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[kind]/[slug]">): Promise<Metadata> {
  const t = await lookupTitleForMetadata(await params);
  if (!t) return {};
  const path = titlePath(t.kind, t.slug);
  const image = tmdbImage(t.backdrop_path, "w1280") ?? tmdbImage(t.poster_path, "w780");
  return {
    title: pageTitle(t),
    description: describeTitle(t),
    alternates: { canonical: path },
    robots: t.indexable ? { index: true, follow: true, "max-image-preview": "large" } : { index: false, follow: true },
    openGraph: {
      type: t.tmdb_type === "tv" ? "video.tv_show" : "video.movie",
      url: path,
      title: pageTitle(t),
      description: describeTitle(t),
      ...(image ? { images: [{ url: image, alt: t.name }] } : {}),
    },
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-12 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 text-ink/90">{children}</dd>
    </div>
  );
}

function SeriesStatus({ t }: { t: TitleDetail }) {
  const status = tvStatusLabel(t.tv_status);
  const next = isNextEpisodeAhead(t) ? shortDate(t.next_episode_date) : null;
  if (!status && !t.latest_label && !next) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      {status ? <span className="rounded bg-accent-soft px-2 py-0.5 text-accent">{status}</span> : null}
      {t.latest_label ? <span className="text-ink/90">{t.latest_label}</span> : null}
      {next ? (
        <span className="text-muted">
          下集 {next}
          {t.next_episode_number ? `（${t.next_episode_season && t.next_episode_season > 1 ? `第${t.next_episode_season}季` : ""}第${t.next_episode_number}集）` : ""}
        </span>
      ) : null}
    </p>
  );
}

function LinesBlock({ t, lines, seasons }: { t: TitleDetail; lines: Line[]; seasons: Season[] }) {
  if (lines.length === 0) {
    return <p className="text-sm text-muted">暂时没有可播放的线路，我们会持续为这部作品寻找新线路。</p>;
  }
  const bySeason = new Map<number | null, Line[]>();
  for (const l of lines) bySeason.set(l.season, [...(bySeason.get(l.season) ?? []), l]);
  const groups = [...bySeason.entries()].sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0));
  return (
    <div className="space-y-6">
      {groups.map(([season, seasonLines]) => {
        const seasonName = season ? seasons.find((s) => s.season_number === season)?.name ?? `第${season}季` : null;
        const primary = seasonLines[0];
        return (
          <div key={season ?? 0}>
            {t.tmdb_type === "tv" ? <h3 className="mb-2 font-medium">{seasonName}</h3> : null}
            <ul className="flex flex-wrap gap-2">
              {seasonLines.map((l) => (
                <li key={l.sourceId}>
                  <Link
                    href={watchPath(t.kind, t.slug, { season, line: l.sourceId })}
                    className="inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-line hover:ring-accent/60"
                  >
                    <span className="font-medium">{l.sourceName}线路</span>
                    <span className="text-muted">{l.remarks ?? `${l.episodes.length}集`}</span>
                    {l.adIntro ? <span className="text-xs text-faint">片头广告</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
            {primary.episodes.length > 1 ? (
              <ol className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                {primary.episodes.map((e, i) => (
                  <li key={`${e.url}-${i}`}>
                    <Link
                      href={watchPath(t.kind, t.slug, { season, ep: i + 1 })}
                      className="block truncate rounded-md bg-surface-2 px-2 py-1.5 text-center text-sm hover:bg-accent hover:text-white"
                    >
                      {e.name}
                    </Link>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default async function TitlePage({ params }: PageProps<"/[kind]/[slug]">) {
  const t = await resolveTitleRoute(await params);
  const [seasons, lines, related] = await Promise.all([getSeasons(t.id), getLines(t.id, t.tmdb_type), relatedTitles(t, 12)]);

  const backdrop = tmdbImage(t.backdrop_path, "w1280");
  const poster = tmdbImage(t.poster_path, "w500");
  const directors = t.crew.filter((c) => c.job === "导演");
  const creators = t.crew.filter((c) => c.job === "主创");
  const writers = t.crew.filter((c) => c.job === "编剧");
  const playable = lines.length > 0;
  const firstLine = lines.slice().sort((a, b) => (b.season ?? 0) - (a.season ?? 0))[0];

  return (
    <article>
      <JsonLd data={titleJsonLd(t, seasons)} />
      <div className="relative">
        {backdrop ? (
          <div aria-hidden className="absolute inset-0 -z-10 h-[420px] overflow-hidden">
            <img src={backdrop} alt="" className="size-full object-cover opacity-30" fetchPriority="high" />
            <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/80 to-bg" />
          </div>
        ) : null}
        <div className="mx-auto max-w-7xl px-4 pt-6">
          <Breadcrumbs
            items={[
              { name: "首页", href: "/" },
              { name: KIND_LABEL[t.kind], href: `/${KIND_SEGMENT[t.kind]}` },
              { name: t.name, href: titlePath(t.kind, t.slug) },
            ]}
          />
          <div className="mt-6 grid gap-6 sm:grid-cols-[200px_1fr] md:grid-cols-[240px_1fr]">
            <div className="mx-auto w-44 sm:mx-0 sm:w-full">
              {poster ? (
                <img src={poster} alt={`${t.name}海报`} width={500} height={750} fetchPriority="high" className="aspect-[2/3] w-full rounded-xl object-cover shadow-2xl ring-1 ring-line" />
              ) : null}
            </div>
            <div className="min-w-0 space-y-4">
              <div>
                <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{t.name}</h1>
                {t.original_name && t.original_name !== t.name ? <p className="mt-1 text-muted">{t.original_name}</p> : null}
              </div>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                {t.year ? <span>{t.year}</span> : null}
                <span>{KIND_LABEL[t.kind]}</span>
                {t.genres.length ? <span>{t.genres.slice(0, 3).join(" / ")}</span> : null}
                {t.countries.length ? <span>{t.countries.slice(0, 2).map(countryLabel).join(" / ")}</span> : null}
                {t.tmdb_type === "movie" && formatRuntime(t.runtime) ? <span>{formatRuntime(t.runtime)}</span> : null}
                {t.tmdb_type === "tv" && t.number_of_seasons ? <span>共{t.number_of_seasons}季</span> : null}
              </p>
              {t.vote_average && (t.vote_count ?? 0) >= 10 ? (
                <p className="text-sm">
                  <span className="text-lg font-semibold text-gold">★ {t.vote_average.toFixed(1)}</span>
                  <span className="ml-2 text-faint">TMDB 评分 · {t.vote_count} 人评价</span>
                </p>
              ) : null}
              {t.tmdb_type === "tv" ? <SeriesStatus t={t} /> : null}
              <div>
                {playable ? (
                  <Link
                    href={watchPath(t.kind, t.slug, { season: firstLine?.season })}
                    className="inline-flex h-11 items-center rounded-full bg-accent px-7 font-semibold text-white shadow-lg shadow-accent/20 hover:brightness-110"
                  >
                    ▶ 立即播放
                  </Link>
                ) : (
                  <span className="inline-flex h-11 items-center rounded-full bg-surface-2 px-7 text-muted">暂无播放线路</span>
                )}
              </div>
              {t.overview ? (
                <section aria-labelledby="overview">
                  <h2 id="overview" className="sr-only">
                    剧情简介
                  </h2>
                  {t.tagline ? <p className="mb-2 italic text-muted">“{t.tagline}”</p> : null}
                  <p className="max-w-3xl leading-7 text-ink/85">{t.overview}</p>
                </section>
              ) : null}
              <dl className="space-y-1.5">
                {directors.length ? <Fact label="导演">{directors.map((d) => d.name).join(" / ")}</Fact> : null}
                {creators.length ? <Fact label="主创">{creators.map((d) => d.name).join(" / ")}</Fact> : null}
                {writers.length ? <Fact label="编剧">{writers.map((d) => d.name).join(" / ")}</Fact> : null}
                {t.cast.length ? <Fact label="主演">{t.cast.slice(0, 6).map((c) => c.name).join(" / ")}</Fact> : null}
                {t.release_date ? <Fact label={t.tmdb_type === "tv" ? "首播" : "上映"}>{t.release_date}</Fact> : null}
              </dl>
            </div>
          </div>
        </div>
      </div>

      <section aria-labelledby="lines" className="mx-auto max-w-7xl px-4 pt-10">
        <h2 id="lines" className="mb-4 text-xl font-semibold">
          播放线路
        </h2>
        <LinesBlock t={t} lines={lines} seasons={seasons} />
      </section>

      {seasons.length > 1 ? (
        <section aria-labelledby="seasons" className="mx-auto max-w-7xl px-4 pt-10">
          <h2 id="seasons" className="mb-4 text-xl font-semibold">
            分季
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {seasons.map((s) => (
              <li key={s.season_number}>
                <Link href={seasonPath(t.kind, t.slug, s.season_number)} className="flex gap-3 rounded-xl bg-surface p-3 ring-1 ring-line hover:ring-accent/60">
                  {s.poster_path ? (
                    <img src={tmdbImage(s.poster_path, "w185")!} alt={`${t.name} ${s.name ?? ""}海报`} width={60} height={90} loading="lazy" className="h-[90px] w-[60px] shrink-0 rounded-md object-cover" />
                  ) : null}
                  <div className="min-w-0">
                    <p className="font-medium">{s.name ?? `第${s.season_number}季`}</p>
                    <p className="mt-1 text-sm text-muted">
                      {s.air_date ? `${s.air_date.slice(0, 4)}年` : ""}
                      {s.episode_count ? ` · ${s.episode_count}集` : ""}
                      {lines.some((l) => l.season === s.season_number) ? <span className="ml-2 text-accent">可播放</span> : null}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {t.cast.length > 0 ? (
        <section aria-labelledby="cast" className="mx-auto max-w-7xl px-4 pt-10">
          <h2 id="cast" className="mb-4 text-xl font-semibold">
            演员
          </h2>
          <ul className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {t.cast.map((c) => (
              <li key={c.id} className="w-24 shrink-0 text-center">
                <div className="mx-auto size-20 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
                  {c.profile ? <img src={tmdbImage(c.profile, "w185")!} alt={c.name} width={80} height={80} loading="lazy" className="size-full object-cover" /> : null}
                </div>
                <p className="mt-2 truncate text-sm">{c.name}</p>
                {c.character ? <p className="truncate text-xs text-faint">{c.character}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section aria-labelledby="related" className="mx-auto max-w-7xl px-4 pt-10">
          <h2 id="related" className="mb-4 text-xl font-semibold">
            {t.genres[0] ? `更多${t.genres[0]}${KIND_LABEL[t.kind]}` : `更多${KIND_LABEL[t.kind]}`}
          </h2>
          <PosterGrid titles={related} />
        </section>
      ) : null}
    </article>
  );
}
