import { absoluteUrl, site } from "@/lib/config/site";
import type { Season, TitleDetail } from "@/lib/data/titles";
import { KIND_LABEL, KIND_SEGMENT } from "@/lib/domain/kinds";
import { countryLabel, formatRuntime, isNextEpisodeAhead, shortDate, tvStatusLabel } from "@/lib/domain/labels";
import { seasonPath, titlePath } from "@/lib/domain/slug";
import { tmdbImageUrl } from "@/lib/images";
import { lastModified } from "@/lib/seo/sitemap";

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function pageTitle(t: TitleDetail): string {
  return `${t.name}${t.year ? `（${t.year}）` : ""} - ${KIND_LABEL[t.kind]}在线观看`;
}

/**
 * One factual sentence built only from fields we have, then the synopsis. Missing facts are
 * left out rather than filled with defaults.
 */
function factLead(t: TitleDetail): string {
  const region = t.countries.slice(0, 2).map(countryLabel).join("、");
  const genres = t.genres.slice(0, 2).join("、");
  let lead = `《${t.name}》是${t.year ? `${t.year}年` : ""}${region ? `${region}` : ""}${genres ? `${genres}` : ""}${KIND_LABEL[t.kind]}`;
  const directors = t.crew.filter((c) => c.job === "导演" || c.job === "主创").slice(0, 2).map((c) => c.name);
  if (directors.length) lead += `，${directors.join("、")}${t.tmdb_type === "tv" ? "主创" : "执导"}`;
  const actors = t.cast.slice(0, 3).map((c) => c.name);
  if (actors.length) lead += `，${actors.join("、")}主演`;
  return `${lead}。`;
}

export function describeTitle(t: TitleDetail, max = 150): string {
  return clip(`${factLead(t)}${t.overview ?? ""}`, max);
}

/** "2026年9月25日" (China time) from the later of the record's and the sources' update times. */
function updatedOn(t: TitleDetail): string | null {
  const iso = lastModified(t.updated_at, t.source_updated_at);
  if (!iso) return null;
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/**
 * The page's fact summary: short sentences built only from data we hold (no defaults), easy
 * for readers to scan and for AI answers to quote.
 */
export function titleFacts(t: TitleDetail, lines: { sourceId: string; adIntro: boolean }[]): string {
  const sentences = [factLead(t).slice(0, -1)];
  if (t.tmdb_type === "tv") {
    const bits: string[] = [];
    if (t.number_of_seasons) bits.push(`共${t.number_of_seasons}季`);
    const status = tvStatusLabel(t.tv_status);
    if (status) bits.push(status);
    const label = t.latest_label?.trim();
    if (label) {
      if (/^更新/.test(label)) bits.push(`目前${label}`);
      else if (/完结|全/.test(label)) bits.push(label);
      else if (/^第?\d+集$/.test(label)) bits.push(`已更新到${label.startsWith("第") ? label : `第${label}`}`);
      else bits.push(`最新一期：${label}`);
    }
    const next = isNextEpisodeAhead(t) ? shortDate(t.next_episode_date) : null;
    if (next) bits.push(`下一集预计${next}播出`);
    if (bits.length) sentences.push(bits.join("，"));
  } else {
    const runtime = formatRuntime(t.runtime);
    if (runtime) sentences.push(`片长${runtime}`);
  }
  const sources = new Map(lines.map((l) => [l.sourceId, l.adIntro]));
  if (sources.size) {
    const clean = [...sources.values()].filter((ad) => !ad).length;
    sentences.push(`${site.name}有${sources.size}条播放线路${clean > 0 && clean < sources.size ? `，其中${clean}条没有片头广告` : ""}`);
  }
  const updated = updatedOn(t);
  if (updated) sentences.push(`资料更新于${updated}`);
  return `${sentences.join("。")}。`;
}

function isoDuration(minutes: number | null): string | undefined {
  return minutes ? `PT${minutes}M` : undefined;
}

export function titleJsonLd(t: TitleDetail, seasons: Season[]) {
  const url = absoluteUrl(titlePath(t.kind, t.slug));
  const isSeries = t.tmdb_type === "tv";
  const person = (name: string) => ({ "@type": "Person", name });
  const work: Record<string, unknown> = {
    "@type": isSeries ? "TVSeries" : "Movie",
    "@id": `${url}#work`,
    name: t.name,
    url,
    ...(t.original_name && t.original_name !== t.name ? { alternateName: t.original_name } : {}),
    ...(t.poster_path ? { image: tmdbImageUrl(t.poster_path, "w780") } : {}),
    ...(t.overview ? { description: t.overview } : {}),
    ...(t.genres.length ? { genre: t.genres } : {}),
    ...(t.release_date ? { [isSeries ? "startDate" : "datePublished"]: t.release_date } : {}),
    ...(t.countries.length ? { countryOfOrigin: t.countries.map((c) => ({ "@type": "Country", name: countryLabel(c) })) } : {}),
    ...(t.languages[0] ? { inLanguage: t.languages[0] } : {}),
    ...(t.cast.length ? { actor: t.cast.slice(0, 8).map((c) => person(c.name)) } : {}),
  };
  const directors = t.crew.filter((c) => c.job === "导演").map((c) => person(c.name));
  if (directors.length) work.director = directors;
  if (isSeries) {
    const creators = t.crew.filter((c) => c.job === "主创").map((c) => person(c.name));
    if (creators.length) work.creator = creators;
    if (t.number_of_seasons) work.numberOfSeasons = t.number_of_seasons;
    if (t.number_of_episodes) work.numberOfEpisodes = t.number_of_episodes;
    if (seasons.length) {
      work.containsSeason = seasons.map((s) => ({
        "@type": "TVSeason",
        seasonNumber: s.season_number,
        ...(s.name ? { name: s.name } : {}),
        ...(s.episode_count ? { numberOfEpisodes: s.episode_count } : {}),
        ...(s.air_date ? { startDate: s.air_date } : {}),
        url: absoluteUrl(seasonPath(t.kind, t.slug, s.season_number)),
      }));
    }
  } else if (t.runtime) {
    work.duration = isoDuration(t.runtime);
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      work,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: site.name, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: KIND_LABEL[t.kind], item: absoluteUrl(`/${KIND_SEGMENT[t.kind]}`) },
          { "@type": "ListItem", position: 3, name: t.name, item: url },
        ],
      },
    ],
  };
}
