import { absoluteUrl, site } from "@/lib/config/site";
import type { Season, TitleDetail } from "@/lib/data/titles";
import { KIND_LABEL, KIND_SEGMENT } from "@/lib/domain/kinds";
import { countryLabel } from "@/lib/domain/labels";
import { seasonPath, titlePath } from "@/lib/domain/slug";
import { tmdbImageUrl } from "@/lib/images";

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
export function describeTitle(t: TitleDetail, max = 150): string {
  const region = t.countries.slice(0, 2).map(countryLabel).join("、");
  const genres = t.genres.slice(0, 2).join("、");
  let lead = `《${t.name}》是${t.year ? `${t.year}年` : ""}${region ? `${region}` : ""}${genres ? `${genres}` : ""}${KIND_LABEL[t.kind]}`;
  const directors = t.crew.filter((c) => c.job === "导演" || c.job === "主创").slice(0, 2).map((c) => c.name);
  if (directors.length) lead += `，${directors.join("、")}${t.tmdb_type === "tv" ? "主创" : "执导"}`;
  const actors = t.cast.slice(0, 3).map((c) => c.name);
  if (actors.length) lead += `，${actors.join("、")}主演`;
  lead += "。";
  return clip(`${lead}${t.overview ?? ""}`, max);
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
