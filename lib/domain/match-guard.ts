/**
 * Sources sometimes carry another work's douban id: a variety show with a film's id, a TV
 * series with the film of the same name. A douban match is trusted only when the row is
 * plausible for the title; otherwise it goes through normal name matching.
 */
export interface GuardTitle {
  name: string;
  /** A documentary film (genre 纪录): making-of material may be the film itself (不破不立). */
  documentary?: boolean;
  /** A film (TMDB movie, including animated films). Series seasons legitimately carry other
   * years and numbered names ("种地吧4", 2026 on a 2023 show), so only films are checked. */
  film: boolean;
  year: number | null;
  /** Normalised aliases (aliases.norm). */
  keys: Set<string>;
}

export interface GuardRow {
  /** Channel of the source category: tv and variety are series; anime and doc hold films too. */
  kind: "movie" | "tv" | "anime" | "variety" | "doc";
  /** The row's source name, and its normalised keys (with and without a glued year). */
  name: string;
  keys: string[];
  year: number | null;
  episodes: number | null;
}

/** Films come in a few parts or versions (国语/粤语/4K); more episodes than this is a series. */
export const MAX_FILM_EPISODES = 8;

// TMDB files specials and OADs as films; sources list them as a 1-3 episode series under the
// same name plus this marker ("…特别篇", "…OAD").
const SPECIAL = /(特别篇|特别版|sp|oad|ova)$/;
// Material about a film, filed under the film's douban id: making-of documentaries, featurettes,
// retrospectives, the drama remake.
const DERIVATIVE = /纪录片|记录片|幕后|花絮|特辑|回顾|剧版/;

/** Why the row cannot belong to the title, or null when it plausibly does. */
export function matchConflict(title: GuardTitle, row: GuardRow): string | null {
  if (!title.film) return null;
  const glued = title.year ? String(title.year) : null;
  const sameName = row.keys.some(
    (k) =>
      title.keys.has(k) ||
      (SPECIAL.test(k) && title.keys.has(k.replace(SPECIAL, ""))) ||
      // "小美人鱼2023" with a wrong source year: the name carries the film's own year.
      (glued != null && k.endsWith(glued) && title.keys.has(k.slice(0, -glued.length))),
  );
  if ((row.episodes ?? 0) > MAX_FILM_EPISODES) return `film-with-${row.episodes}-episodes`;
  if (DERIVATIVE.test(row.name) && !DERIVATIVE.test(title.name) && !title.documentary) return "derivative-of-film";
  if ((row.kind === "tv" || row.kind === "variety") && !sameName) return "series-row-on-film";
  if (!sameName && row.year != null && title.year != null && Math.abs(row.year - title.year) > 2) return `name-and-year-differ(${row.year}/${title.year})`;
  return null;
}
