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

/** Absolute form, for structured data and feeds. */
export function tmdbImageUrl(path: string | null | undefined, size: TmdbSize): string | null {
  const relative = tmdbImage(path, size);
  return relative ? absoluteUrl(relative) : null;
}
