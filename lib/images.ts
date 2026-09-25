import { absoluteUrl } from "@/lib/config/site";

export type TmdbSize = "w185" | "w342" | "w500" | "w780" | "w1280" | "original";

/**
 * Image URL on our own domain (see lib/edge/image-proxy.ts): pages never load images from
 * another site.
 */
export function tmdbImage(path: string | null | undefined, size: TmdbSize): string | null {
  if (!path) return null;
  // Source posters ("/src/{key}.jpg") come in one size.
  return path.startsWith("/src/") ? `/img${path}` : `/img/${size}${path}`;
}

const WIDTH: Partial<Record<TmdbSize, number>> = { w185: 185, w342: 342, w500: 500, w780: 780, w1280: 1280 };

/**
 * srcset over TMDB sizes, so phones do not download the desktop image. Undefined for source
 * posters, which come in one size.
 */
export function tmdbSrcSet(path: string | null | undefined, sizes: TmdbSize[]): string | undefined {
  if (!path || path.startsWith("/src/")) return undefined;
  return sizes.map((size) => `${tmdbImage(path, size)} ${WIDTH[size]}w`).join(", ");
}

/** Absolute form, for structured data and feeds. */
export function tmdbImageUrl(path: string | null | undefined, size: TmdbSize): string | null {
  const relative = tmdbImage(path, size);
  return relative ? absoluteUrl(relative) : null;
}
