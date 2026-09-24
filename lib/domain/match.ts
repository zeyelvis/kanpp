/**
 * Decides whether a source row and a candidate title are the same work.
 *
 * Names must match exactly after normalization (on any alias). There is no substring or
 * fuzzy name matching: "生化危机" can never absorb "生化危机：爆发夜". Year and people only
 * confirm or weaken an exact-name match.
 */

export interface SourceSignal {
  keys: string[]; // normalized name keys (with and without a glued year)
  season: number | null;
  year: number | null;
  tmdbType: "movie" | "tv";
  people: string[];
  /** Long-running variety shows: the row's year is the current year, not the premiere. */
  ongoing?: boolean;
}

export interface CandidateSignal {
  keys: Set<string>;
  year: number | null;
  seasonYears: Map<number, number>;
  tmdbType: "movie" | "tv";
  people: string[];
}

export type Decision = "same" | "review" | "different";

export interface MatchResult {
  score: number;
  decision: Decision;
  reasons: string[];
}

export const SAME_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.6;

const HAN = /[一-龥]/;
const personKey = (name: string) => name.normalize("NFKC").replace(/[\s·・.．\-]/g, "").toLowerCase();

function yearScore(src: SourceSignal, cand: CandidateSignal, reasons: string[]): number | null {
  if (src.year == null) {
    reasons.push("year:unknown");
    return 0.5;
  }
  let target = cand.year;
  if (cand.tmdbType === "tv" && src.season != null) {
    target = cand.seasonYears.get(src.season) ?? null;
    if (target == null && cand.seasonYears.size > 0) {
      // TMDB often lags on a brand-new season: accept seasons just past the last known
      // one when the row is not older than that last season.
      const lastSeason = Math.max(...cand.seasonYears.keys());
      const lastYear = cand.seasonYears.get(lastSeason)!;
      if (src.season <= lastSeason + 2 && src.year >= lastYear) {
        reasons.push(`season:${src.season}-not-in-tmdb-yet`);
        return 0.8;
      }
      reasons.push(`season:${src.season}-missing`);
      return null;
    }
  }
  if (target == null) {
    reasons.push("year:unknown");
    return 0.5;
  }
  if (cand.tmdbType === "tv" && src.season == null && src.year > target) {
    if (src.ongoing) {
      reasons.push(`year:ongoing(+${src.year - target})`);
      return 0.8;
    }
    // A later year on an unmarked row could be a later season or a different show.
    reasons.push(`year:after-first-season(+${src.year - target})`);
    return 0.4;
  }
  const delta = Math.abs(src.year - target);
  if (delta === 0) return 1;
  if (delta === 1) {
    reasons.push("year:±1");
    return 0.8;
  }
  if (delta === 2) {
    reasons.push("year:±2");
    return 0.5;
  }
  reasons.push(`year:Δ${delta}`);
  return null; // hard reject
}

/**
 * People only count when both sides use Chinese names: a foreign cast listed in English
 * on TMDB and in Chinese transliteration on the source proves nothing either way.
 */
function peopleScore(src: SourceSignal, cand: CandidateSignal, reasons: string[]): number {
  const srcHan = src.people.filter((p) => HAN.test(p));
  const candHan = cand.people.filter((p) => HAN.test(p));
  if (srcHan.length === 0 || candHan.length < 2) return 0.5;
  const candKeys = new Set(candHan.map(personKey));
  const overlap = new Set(srcHan.map(personKey).filter((p) => candKeys.has(p))).size;
  reasons.push(`people:${overlap}`);
  if (overlap >= 2) return 1;
  if (overlap === 1) return 0.75;
  return 0.25;
}

export function scoreMatch(src: SourceSignal, cand: CandidateSignal): MatchResult {
  const reasons: string[] = [];
  if (src.tmdbType !== cand.tmdbType) {
    return { score: 0, decision: "different", reasons: [`type:${src.tmdbType}≠${cand.tmdbType}`] };
  }
  if (!src.keys.some((k) => cand.keys.has(k))) {
    return { score: 0, decision: "different", reasons: ["name:no-exact-alias"] };
  }
  const y = yearScore(src, cand, reasons);
  if (y == null) return { score: 0, decision: "different", reasons };
  const p = peopleScore(src, cand, reasons);
  const score = Math.round((0.55 + 0.25 * y + 0.2 * p) * 1000) / 1000;
  const decision: Decision = score >= SAME_THRESHOLD ? "same" : score >= REVIEW_THRESHOLD ? "review" : "different";
  return { score, decision, reasons };
}
