import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EpisodeLinks } from "@/components/EpisodeLinks";
import { lookupTitleForMetadata, resolveTitleRoute } from "@/lib/data/resolve-page";
import { getLines, getSeasons, type Season, type TitleDetail } from "@/lib/data/titles";
import { KIND_LABEL, KIND_SEGMENT } from "@/lib/domain/kinds";
import { seasonPath, titlePath, watchPath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

export const dynamic = "force-dynamic";

function parseSeason(segment: string): number | null {
  const m = segment.match(/^s([1-9]\d?)$/);
  return m ? Number(m[1]) : null;
}

function seasonTitle(t: TitleDetail, s: Season): string {
  return `${t.name} ${s.name ?? `第${s.season_number}季`}`;
}

function seasonDescription(t: TitleDetail, s: Season): string {
  const facts = [
    s.air_date ? `${s.air_date}首播` : null,
    s.episode_count ? `共${s.episode_count}集` : null,
  ].filter(Boolean);
  const lead = `《${t.name}》${s.name ?? `第${s.season_number}季`}${facts.length ? `，${facts.join("，")}` : ""}。`;
  return `${lead}${s.overview ?? ""}`.slice(0, 150);
}

export async function generateMetadata({ params }: PageProps<"/[kind]/[slug]/[season]">): Promise<Metadata> {
  const p = await params;
  const n = parseSeason(p.season);
  const t = n ? await lookupTitleForMetadata(p) : null;
  if (!t || !n) return {};
  const s = (await getSeasons(t.id)).find((x) => x.season_number === n);
  if (!s) return {};
  const hasLines = (await getLines(t.id, t.tmdb_type)).some((l) => l.season === n);
  // A season page earns its own index entry only with its own synopsis and something to play.
  const indexable = Boolean(t.indexable && hasLines && (s.overview?.length ?? 0) >= 20);
  const path = seasonPath(t.kind, t.slug, n);
  return {
    title: `${seasonTitle(t, s)}${s.air_date ? `（${s.air_date.slice(0, 4)}）` : ""} - 在线观看`,
    description: seasonDescription(t, s),
    alternates: { canonical: path },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { url: path, ...(s.poster_path ? { images: [tmdbImage(s.poster_path, "w500")!] } : {}) },
  };
}

export default async function SeasonPage({ params }: PageProps<"/[kind]/[slug]/[season]">) {
  const p = await params;
  const n = parseSeason(p.season);
  if (!n) notFound();
  const t = await resolveTitleRoute(p, (canonical) => `${canonical}/s${n}`);
  if (t.tmdb_type !== "tv") notFound();
  const [seasons, lines] = await Promise.all([getSeasons(t.id), getLines(t.id, t.tmdb_type)]);
  const s = seasons.find((x) => x.season_number === n);
  if (!s) notFound();
  const seasonLines = lines.filter((l) => l.season === n);
  const poster = tmdbImage(s.poster_path ?? t.poster_path, "w342");

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6">
      <Breadcrumbs
        items={[
          { name: "首页", href: "/" },
          { name: KIND_LABEL[t.kind], href: `/${KIND_SEGMENT[t.kind]}` },
          { name: t.name, href: titlePath(t.kind, t.slug) },
          { name: s.name ?? `第${n}季`, href: seasonPath(t.kind, t.slug, n) },
        ]}
      />
      <div className="mt-6 grid gap-6 sm:grid-cols-[180px_1fr]">
        {poster ? <img src={poster} alt={`${seasonTitle(t, s)}海报`} width={342} height={513} className="mx-auto w-40 rounded-xl ring-1 ring-line sm:w-full" /> : null}
        <div className="space-y-3">
          <h1 className="text-2xl font-bold">{seasonTitle(t, s)}</h1>
          <p className="text-sm text-muted">
            {[s.air_date ? `${s.air_date} 首播` : null, s.episode_count ? `共${s.episode_count}集` : null].filter(Boolean).join(" · ")}
          </p>
          {s.overview ? <p className="max-w-3xl leading-7 text-ink/85">{s.overview}</p> : null}
          {seasonLines.length ? (
            <Link
              href={watchPath(t.kind, t.slug, { season: n })}
              className="inline-flex h-11 items-center rounded-full bg-accent px-7 font-semibold text-white hover:brightness-110"
            >
              ▶ 播放第{n}季
            </Link>
          ) : (
            <p className="text-sm text-muted">这一季暂时没有可播放的线路。</p>
          )}
        </div>
      </div>

      {seasonLines[0] && seasonLines[0].episodes.length > 0 ? (
        <section aria-labelledby="episodes" className="pt-10">
          <h2 id="episodes" className="mb-4 text-xl font-semibold">
            分集 <span className="text-sm font-normal text-muted">共{seasonLines[0].episodes.length}集</span>
          </h2>
          <EpisodeLinks kind={t.kind} slug={t.slug} season={n} names={seasonLines[0].episodes.map((e) => e.name)} />
        </section>
      ) : null}

      {seasons.length > 1 ? (
        <nav aria-label="其他季" className="pt-10">
          <h2 className="mb-3 text-lg font-semibold">其他季</h2>
          <ul className="flex flex-wrap gap-2">
            {seasons.map((x) => (
              <li key={x.season_number}>
                <Link
                  href={seasonPath(t.kind, t.slug, x.season_number)}
                  aria-current={x.season_number === n ? "page" : undefined}
                  className={`inline-block rounded-md px-3 py-1.5 text-sm ${x.season_number === n ? "bg-accent text-white" : "bg-surface hover:bg-surface-2"}`}
                >
                  {x.name ?? `第${x.season_number}季`}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
