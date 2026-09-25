import { absoluteUrl } from "@/lib/config/site";

export type TmdbSize = "w185" | "w342" | "w500" | "w780" | "w1280" | "original";

/**
 * Image URL on our own domain (see lib/edge/image-proxy.ts): pages never load images from
 * another site.
 */
export function tmdbImage(path: string | null | undefined, size: TmdbSize): string | null {
  return path ? `/img/${size}${path}` : null;
}

/** Absolute form, for structured data and feeds. */
export function tmdbImageUrl(path: string | null | undefined, size: TmdbSize): string | null {
  return path ? absoluteUrl(`/img/${size}${path}`) : null;
}
