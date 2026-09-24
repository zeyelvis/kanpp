import { KIND_SEGMENT, type Kind } from "./kinds";

const MAX_SLUG_LENGTH = 80;

/**
 * Builds the human-readable slug: Chinese title + year, e.g. "布达佩斯大饭店-2014".
 * Only letters, digits (any script) and single hyphens survive, so a slug can never
 * contain "%", "/" or other characters that get mangled by encoding.
 */
export function baseSlug(name: string, year: number | null | undefined): string {
  let s = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (s.length > MAX_SLUG_LENGTH) s = s.slice(0, MAX_SLUG_LENGTH).replace(/-$/, "");
  if (!s) s = "title";
  return year ? `${s}-${year}` : s;
}

/** Candidate slugs in order: base, base-2, base-3, ... (caller picks the first free one). */
export function* slugCandidates(name: string, year: number | null | undefined): Generator<string> {
  const base = baseSlug(name, year);
  yield base;
  for (let n = 2; n < 1000; n++) yield `${base}-${n}`;
}

export function titlePath(kind: Kind, slug: string): string {
  return `/${KIND_SEGMENT[kind]}/${encodeURIComponent(slug)}`;
}

export function seasonPath(kind: Kind, slug: string, season: number): string {
  return `${titlePath(kind, slug)}/s${season}`;
}

export function watchPath(kind: Kind, slug: string, episode?: { season?: number | null; index: number }): string {
  const base = `/watch/${KIND_SEGMENT[kind]}/${encodeURIComponent(slug)}`;
  if (!episode) return base;
  const q = new URLSearchParams();
  if (episode.season) q.set("s", String(episode.season));
  q.set("ep", String(episode.index + 1));
  return `${base}?${q}`;
}

/**
 * Route params may arrive percent-encoded (or double-encoded by old links). Decode until
 * stable, then NFC-normalize so lookups hit the stored form.
 */
export function decodeSlugParam(raw: string): string {
  let s = raw;
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(s); i++) {
    try {
      s = decodeURIComponent(s);
    } catch {
      break;
    }
  }
  return s.normalize("NFC").trim();
}
