import "server-only";
import { unstable_cache } from "next/cache";

/**
 * Cache tags. Ingest invalidates them through POST /api/revalidate:
 * - title:{id}  one title's record, seasons and lines (and the ISR pages rendered from them)
 * - slugs       slug -> title lookups; expired immediately when titles are created, so a
 *               cached "not found" never outlives the title's creation
 * - catalog     lists, counts, search, sitemaps
 * - related     related-title rails (slow-moving)
 */
export const TAG = {
  catalog: "catalog",
  slugs: "slugs",
  related: "related",
  title: (id: number) => `title:${id}`,
} as const;

/** One cached D1 read. Entries live in the OpenNext incremental cache (R2 + regional cache). */
export function cachedQuery<T>(key: (string | number | null)[], tags: string[], revalidate: number, run: () => Promise<T>): Promise<T> {
  return unstable_cache(run, key.map((k) => String(k)), { tags, revalidate })();
}
