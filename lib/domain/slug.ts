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

export interface WatchState {
  season?: number | null;
  /** 1-based episode number */
  ep?: number | null;
  /** source id */
  line?: string | null;
}

/** "#s=1&ep=3&line=ikun" (empty when nothing is selected). */
export function watchFragment(state: WatchState): string {
  const q = new URLSearchParams();
  if (state.season) q.set("s", String(state.season));
  if (state.ep) q.set("ep", String(state.ep));
  if (state.line) q.set("line", state.line);
  const s = q.toString();
  return s ? `#${s}` : "";
}

/** Reads a fragment (or query string) written by watchFragment; invalid values are dropped. */
export function parseWatchState(raw: string | URLSearchParams): WatchState {
  const q = typeof raw === "string" ? new URLSearchParams(raw.replace(/^[#?]/, "")) : raw;
  const num = (v: string | null) => (v && /^[1-9]\d{0,3}$/.test(v) ? Number(v) : null);
  const line = q.get("line");
  return { season: num(q.get("s")), ep: num(q.get("ep")), line: line && /^[a-z0-9_]{1,20}$/.test(line) ? line : null };
}

/**
 * Player URL. There is exactly one crawlable URL per title; season/episode/line live in the
 * fragment, which crawlers ignore, so episodes x lines no longer multiply into thousands of URLs.
 */
export function watchPath(kind: Kind, slug: string, state: WatchState = {}): string {
  return `/watch/${KIND_SEGMENT[kind]}/${encodeURIComponent(slug)}${watchFragment(state)}`;
}

/**
 * True when a route segment was percent-encoded more than once. The runtime may hand us the
 * segment raw ("%E5%85%B0...") or already decoded; one decode must yield plain text either
 * way, so anything still escaped after one pass is over-encoded. (Slugs never contain "%".)
 */
export function isOverEncoded(rawSegment: string): boolean {
  let once = rawSegment;
  try {
    once = decodeURIComponent(rawSegment);
  } catch {
    return false;
  }
  return /%[0-9a-f]{2}/i.test(once);
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
