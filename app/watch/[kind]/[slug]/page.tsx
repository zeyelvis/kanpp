import type { Metadata } from "next";
import Link from "next/link";
import { Player } from "@/components/player/Player";
import { lookupTitleForMetadata, resolveTitleRoute } from "@/lib/data/resolve-page";
import { getLines, getSeasons } from "@/lib/data/titles";
import { titlePath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function generateMetadata({ params }: PageProps<"/watch/[kind]/[slug]">): Promise<Metadata> {
  const t = await lookupTitleForMetadata(await params);
  if (!t) return { robots: { index: false, follow: false } };
  return {
    title: `正在播放：${t.name}`,
    // The title page is the indexable document; the player is a utility page.
    robots: { index: false, follow: true },
    alternates: { canonical: titlePath(t.kind, t.slug) },
  };
}

export default async function WatchPage({ params, searchParams }: PageProps<"/watch/[kind]/[slug]">) {
  const q = await searchParams;
  const query = new URLSearchParams();
  for (const k of ["s", "ep", "line"] as const) {
    const v = one(q[k]);
    if (v) query.set(k, v);
  }
  const qs = query.toString() ? `?${query}` : "";
  const t = await resolveTitleRoute(await params, (canonical) => `/watch${canonical}${qs}`);
  const [lines, seasons] = await Promise.all([getLines(t.id, t.tmdb_type), getSeasons(t.id)]);

  const seasonNumbers = [...new Set(lines.map((l) => l.season).filter((s): s is number => s != null))].sort((a, b) => a - b);
  const requestedSeason = Number(one(q.s));
  const season = t.tmdb_type === "tv" ? (seasonNumbers.includes(requestedSeason) ? requestedSeason : seasonNumbers.at(-1) ?? null) : null;
  const ep = Math.max(1, Number(one(q.ep)) || 1);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {t.name}
          {t.year ? <span className="ml-2 text-base font-normal text-muted">{t.year}</span> : null}
        </h1>
        <Link href={titlePath(t.kind, t.slug)} className="text-sm text-muted hover:text-accent">
          ‹ 返回详情
        </Link>
      </div>
      <Player
        titleId={t.id}
        titleName={t.name}
        poster={tmdbImage(t.backdrop_path, "w1280")}
        lines={lines}
        seasons={seasonNumbers.map((n) => ({ number: n, name: seasons.find((s) => s.season_number === n)?.name ?? `第${n}季` }))}
        initial={{ season, ep, line: one(q.line) ?? null }}
      />
      {t.overview ? <p className="mt-8 max-w-3xl text-sm leading-7 text-muted">{t.overview}</p> : null}
    </div>
  );
}
