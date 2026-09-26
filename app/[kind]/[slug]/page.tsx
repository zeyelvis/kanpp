import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EpisodeLinks } from "@/components/EpisodeLinks";
import { ExpandableText } from "@/components/ExpandableText";
import { JsonLd } from "@/components/JsonLd";
import { FollowButton } from "@/components/library/FollowButton";
import { PlayButton } from "@/components/library/PlayButton";
import { WatchStage } from "@/components/player/WatchStage";
import { TopicChips } from "@/components/TopicChips";
import { topicsForTitle } from "@/lib/domain/topics";
import { updateCadence, updateTimeline } from "@/lib/domain/updates";
import { PosterRail } from "@/components/PosterRail";
import { ScrollRail } from "@/components/ScrollRail";
import { castOtherWorks, personCredits, personSlugs } from "@/lib/data/people";
import { lookupTitleForMetadata, resolveTitleRoute } from "@/lib/data/resolve-page";
import { getLines, getSeasons, getUpdates, relatedTitles, tagTitle, type Line, type TitleDetail } from "@/lib/data/titles";
import { KIND_LABEL, KIND_SEGMENT } from "@/lib/domain/kinds";
import { countryLabel, formatRuntime, isNextEpisodeAhead, shortDate, tvStatusLabel } from "@/lib/domain/labels";
import { personPath, playFragment, seasonPath, titlePath } from "@/lib/domain/slug";
import { tmdbImage, tmdbSrcSet } from "@/lib/images";
import { describeTitle, pageTitle, titleFacts, titleJsonLd } from "@/lib/seo/title";

// Rendered on first request, then served from the edge cache (ISR). Ingest invalidates the
// title's tag after changes; nothing is prerendered at build time (the build has no D1).
export const revalidate = 3600;
export async function generateStaticParams() {
  return [];
}

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
      <dt className="w-10 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 text-ink/90">{children}</dd>
    </div>
  );
}

/** Names joined by " / ", linked to person pages where one exists. */
function Names({ people, slugs }: { people: { id: number | null; name: string }[]; slugs: Record<number, string> }) {
  return people.map((p, i) => (
    <span key={p.id ?? p.name}>
      {i > 0 ? " / " : null}
      {p.id != null && slugs[p.id] ? (
        <Link href={personPath(slugs[p.id])} className="hover:text-accent">
          {p.name}
        </Link>
      ) : (
        p.name
      )}
    </span>
  ));
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
          · 下集 {next}
          {t.next_episode_number ? `（${t.next_episode_season && t.next_episode_season > 1 ? `第${t.next_episode_season}季` : ""}第${t.next_episode_number}集）` : ""}
        </span>
      ) : null}
    </p>
  );
}

function LinesSummary({ lines }: { lines: Line[] }) {
  const unique = [...new Map(lines.map((l) => [l.sourceId, l])).values()];
  return (
    <ul className="flex flex-wrap gap-2">
      {unique.map((l) => (
        <li key={l.sourceId}>
          {/* Same-page fragment link: the player at the top opens on this line. */}
          <a
            href={playFragment({ season: l.season, line: l.sourceId })}
            className="inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm ring-1 ring-line hover:ring-accent/60"
          >
            <span className="font-medium">{l.sourceName}</span>
            <span className="text-muted">{l.remarks ?? `${l.episodes.length}集`}</span>
            {l.adIntro ? <span className="text-xs text-faint">片头广告</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default async function TitlePage({ params }: PageProps<"/[kind]/[slug]">) {
  const t = await resolveTitleRoute(await params);
  const [seasons, lines, related, slugs, updates] = await Promise.all([
    getSeasons(t.id),
    getLines(t.id, t.tmdb_type),
    relatedTitles(t, 18),
    personSlugs([...t.cast, ...t.crew].map((p) => p.id).filter((id): id is number => id != null)),
    getUpdates(t.id),
    // The page's only tag: an ingest run that changes this title refreshes it.
    tagTitle(t.id),
    // Prefetch the leads' credits alongside (request-cached): castOtherWorks needs them once
    // personSlugs has said which leads have pages.
    Promise.all(t.cast.filter((c) => c.id != null).slice(0, 5).map((c) => personCredits(c.id!))),
  ]);
  // One entry is only the state when recording began; a history needs a change after it.
  const timeline = updateTimeline(updates);
  const cadence = updateCadence(timeline);

  // Other titles by up to three leads with person pages: links between titles and people.
  const leads = t.cast.filter((c) => c.id != null && slugs[c.id]).slice(0, 3);
  const castWorks = leads.length ? await castOtherWorks(leads.map((c) => c.id!), t.id, 18) : [];
  const backdrop = tmdbImage(t.backdrop_path, "w1280");
  const poster = tmdbImage(t.poster_path, "w342");
  const directors = t.crew.filter((c) => c.job === "导演");
  const creators = t.crew.filter((c) => c.job === "主创");
  const writers = t.crew.filter((c) => c.job === "编剧");
  const latestSeason = lines.reduce<number | null>((max, l) => (l.season != null && (max == null || l.season > max) ? l.season : max), null);
  const episodeLine = lines.filter((l) => l.season === latestSeason).sort((a, b) => b.episodes.length - a.episodes.length)[0];
  const seasonName = latestSeason ? seasons.find((s) => s.season_number === latestSeason)?.name ?? `第${latestSeason}季` : null;
  const titleRef = { id: t.id, kind: t.kind, slug: t.slug, name: t.name, poster: t.poster_path, backdrop: t.backdrop_path, year: t.year, latestLabel: t.latest_label };

  const header = (
    <div className="flex gap-4 sm:gap-6">
      {poster ? (
        <img
          src={poster}
          alt={`${t.name}海报`}
          width={342}
          height={513}
          className="aspect-[2/3] w-20 shrink-0 self-start rounded-lg object-cover shadow-xl ring-1 ring-line sm:w-32"
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h1 className="text-xl font-bold leading-tight sm:text-3xl">{t.name}</h1>
          {t.original_name && t.original_name !== t.name ? <p className="mt-1 truncate text-sm text-muted">{t.original_name}</p> : null}
        </div>
        <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted">
          {t.vote_average && (t.vote_count ?? 0) >= 10 ? (
            <span className="font-semibold text-gold" title={`TMDB 评分 · ${t.vote_count} 人评价`}>
              ★ {t.vote_average.toFixed(1)}
            </span>
          ) : null}
          {t.year ? <span>{t.year}</span> : null}
          <span>{KIND_LABEL[t.kind]}</span>
          {t.genres.length ? <span>{t.genres.slice(0, 3).join(" / ")}</span> : null}
          {t.countries.length ? <span>{t.countries.slice(0, 2).map(countryLabel).join(" / ")}</span> : null}
          {t.tmdb_type === "movie" && formatRuntime(t.runtime) ? <span>{formatRuntime(t.runtime)}</span> : null}
          {t.tmdb_type === "tv" && t.number_of_seasons ? <span>共{t.number_of_seasons}季</span> : null}
        </p>
        {t.tmdb_type === "tv" ? <SeriesStatus t={t} /> : null}
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {lines.length ? <PlayButton id={t.id} defaultSeason={latestSeason} /> : null}
          <FollowButton title={titleRef} />
        </div>
      </div>
    </div>
  );

  // Beside the video until playback starts (the player then shows its own lists).
  const panel = (
    <div className="space-y-6">
      {episodeLine && episodeLine.episodes.length > 1 ? (
        <section aria-labelledby="episodes">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="episodes" className="text-base font-semibold">
              选集{seasonName && seasons.length > 1 ? ` · ${seasonName}` : ""}
              <span className="ml-2 text-sm font-normal text-muted">共{episodeLine.episodes.length}集</span>
            </h2>
            {/* Sources can carry a season TMDB does not list: only link seasons that have a page. */}
            {seasons.length > 1 && latestSeason && seasons.some((s) => s.season_number === latestSeason) ? (
              <Link href={seasonPath(t.kind, t.slug, latestSeason)} className="shrink-0 text-sm text-muted hover:text-accent">
                本季详情 ›
              </Link>
            ) : null}
          </div>
          <EpisodeLinks kind={t.kind} slug={t.slug} season={latestSeason} names={episodeLine.episodes.map((e) => e.name)} samePage compact />
        </section>
      ) : null}
      {lines.length ? (
        <section aria-labelledby="lines">
          <h2 id="lines" className="mb-3 text-base font-semibold">
            播放线路 <span className="text-sm font-normal text-muted">{new Set(lines.map((l) => l.sourceId)).size} 条</span>
          </h2>
          <LinesSummary lines={lines} />
        </section>
      ) : null}
    </div>
  );

  return (
    <article>
      <JsonLd data={titleJsonLd(t, seasons)} />

      <div className="mx-auto max-w-7xl px-4 pt-3 sm:pt-5">
        <div className="mb-3 hidden sm:block">
          <Breadcrumbs
            items={[
              { name: "首页", href: "/" },
              { name: KIND_LABEL[t.kind], href: `/${KIND_SEGMENT[t.kind]}` },
              { name: t.name, href: titlePath(t.kind, t.slug) },
            ]}
          />
        </div>
        <WatchStage title={titleRef} backdrop={backdrop} backdropSrcSet={tmdbSrcSet(t.backdrop_path, ["w780", "w1280"])} poster={poster} playable={lines.length > 0} header={header} panel={panel} />
      </div>

      <section className="mx-auto mt-10 grid max-w-7xl gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section aria-labelledby="facts">
            <h2 id="facts" className="mb-2 text-lg font-semibold">
              作品速览
            </h2>
            <p className="leading-7 text-ink/85">{titleFacts(t, lines)}</p>
            <div className="mt-3">
              <TopicChips title="相关专题" topics={topicsForTitle(t)} compact />
            </div>
          </section>
          {t.tagline ? <p className="italic text-muted">“{t.tagline}”</p> : null}
          {t.overview ? (
            <section aria-labelledby="overview">
              <h2 id="overview" className="mb-2 text-lg font-semibold">
                剧情简介
              </h2>
              <ExpandableText text={t.overview} />
            </section>
          ) : null}
          {timeline.length >= 2 ? (
            <section aria-labelledby="updates">
              <h2 id="updates" className="mb-2 text-lg font-semibold">
                更新记录
              </h2>
              {cadence ? <p className="mb-2 text-sm text-muted">{cadence}（北京时间）</p> : null}
              <ol className="space-y-1.5 text-sm">
                {timeline.map((e) => (
                  <li key={`${e.date}-${e.text}`} className="flex gap-3">
                    <time dateTime={e.date} className="w-16 shrink-0 tabular-nums text-muted">
                      {shortDate(e.date)}
                    </time>
                    <span className="text-ink/85">{e.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
        <dl className="space-y-1.5 rounded-xl bg-surface/60 p-4 ring-1 ring-line lg:self-start">
          {directors.length ? <Fact label="导演"><Names people={directors} slugs={slugs} /></Fact> : null}
          {creators.length ? <Fact label="主创"><Names people={creators} slugs={slugs} /></Fact> : null}
          {writers.length ? <Fact label="编剧"><Names people={writers} slugs={slugs} /></Fact> : null}
          {t.cast.length ? <Fact label="主演"><Names people={t.cast.slice(0, 5)} slugs={slugs} /></Fact> : null}
          {t.release_date ? <Fact label={t.tmdb_type === "tv" ? "首播" : "上映"}>{t.release_date}</Fact> : null}
          {t.countries.length ? <Fact label="地区">{t.countries.map(countryLabel).join(" / ")}</Fact> : null}
        </dl>
      </section>

      {seasons.length > 1 ? (
        <ScrollRail id="seasons" title="分季">
          {seasons.map((s) => (
            <li key={s.season_number} className="w-32 shrink-0 snap-start sm:w-40">
              <Link href={seasonPath(t.kind, t.slug, s.season_number)} className="group block">
                <div className="aspect-[2/3] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line">
                  {s.poster_path ? (
                    <img src={tmdbImage(s.poster_path, "w342")!} alt={`${t.name} ${s.name ?? ""}海报`} loading="lazy" className="size-full object-cover transition group-hover:scale-[1.03]" />
                  ) : null}
                </div>
                <p className="mt-2 truncate text-sm font-medium group-hover:text-accent">{s.name ?? `第${s.season_number}季`}</p>
                <p className="text-xs text-faint">
                  {s.air_date ? `${s.air_date.slice(0, 4)}年` : ""}
                  {s.episode_count ? ` · ${s.episode_count}集` : ""}
                  {lines.some((l) => l.season === s.season_number) ? <span className="ml-1 text-accent">可播</span> : null}
                </p>
              </Link>
            </li>
          ))}
        </ScrollRail>
      ) : null}

      {t.cast.length > 0 ? (
        <ScrollRail id="cast" title="演员">
          {t.cast.map((c) => (
            <li key={c.id ?? c.name} className="w-20 shrink-0 snap-start text-center sm:w-24">
              {(() => {
                const body = (
                  <>
                    <div className="mx-auto size-16 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line sm:size-20">
                      {c.profile ? <img src={tmdbImage(c.profile, "w185")!} alt={c.name} width={80} height={80} loading="lazy" className="size-full object-cover" /> : null}
                    </div>
                    <p className="mt-2 truncate text-sm">{c.name}</p>
                    {c.character ? <p className="truncate text-xs text-faint">{c.character}</p> : null}
                  </>
                );
                return c.id != null && slugs[c.id] ? (
                  <Link href={personPath(slugs[c.id])} className="block hover:text-accent">
                    {body}
                  </Link>
                ) : (
                  body
                );
              })()}
            </li>
          ))}
        </ScrollRail>
      ) : null}

      <PosterRail id="cast-works" title={leads.length === 1 ? `${leads[0].name}的其他作品` : "主演的其他作品"} titles={castWorks} />

      <PosterRail
        id="related"
        title={t.genres[0] ? `更多${t.genres[0]}${KIND_LABEL[t.kind]}` : `更多${KIND_LABEL[t.kind]}`}
        href={`/${KIND_SEGMENT[t.kind]}${t.genres[0] ? `?genre=${encodeURIComponent(t.genres[0])}` : ""}`}
        titles={related}
      />
    </article>
  );
}
