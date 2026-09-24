export type TmdbSize = "w185" | "w342" | "w500" | "w780" | "w1280" | "original";

export function tmdbImage(path: string | null | undefined, size: TmdbSize): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}
