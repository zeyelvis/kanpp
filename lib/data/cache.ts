import "server-only";
import { unstable_cache } from "next/cache";
import { isBuildPhase } from "@/lib/db/server";

/**
 * Cache tags. Ingest invalidates them through POST /api/revalidate:
 * - title:{id}  the ISR pages of one title (its title and season pages, tagged by tagTitle)
 * - slugs       remembered misses (slug-miss, person-miss), i.e. 404 pages; expired
 *               immediately when titles are created, so a cached 404 never outlives the
 *               creation. Pages of existing titles and people never carry it.
 * - catalog     lists, counts, search, sitemaps (refreshed stale-while-revalidate)
 * - related     topic page data (slow-moving, daily)
 *
 * Title and person pages read their own data from D1 directly (lib/data/titles.ts): a
 * data-cache miss costs 500-900 ms (R2 read, tag check, R2 write) against ~50 ms for the
 * query, and the pages themselves are ISR-cached anyway. Every tag a page carries is one
 * more reason for it to go stale: pages that carried "slugs" and "catalog" were re-rendered
 * after every ingest run, so crawlers mostly met cold pages.
 */
export const TAG = {
  catalog: "catalog",
  slugs: "slugs",
  related: "related",
  title: (id: number) => `title:${id}`,
} as const;

/** A cached read slower than this (cache lookup included) is logged to Workers Logs. */
const SLOW_MS = 300;

/** One cached D1 read. Entries live in the OpenNext incremental cache (R2 + regional cache). */
export function cachedQuery<T>(key: (string | number | null)[], tags: string[], revalidate: number, run: () => Promise<T>): Promise<T> {
  // Build-time data is empty (see getDb) and must not be deployed as cache entries.
  if (isBuildPhase) return run();
  const started = Date.now();
  let dbMs: number | null = null;
  const timed = async () => {
    const t = Date.now();
    try {
      return await run();
    } finally {
      dbMs = Date.now() - t;
    }
  };
  return unstable_cache(timed, key.map((k) => String(k)), { tags, revalidate })().finally(() => {
    const ms = Date.now() - started;
    // db: null means a cache hit; otherwise the D1 part of the time.
    if (ms >= SLOW_MS) console.log(JSON.stringify({ slow: "cachedQuery", key: String(key[0]), ms, db: dbMs }));
  });
}
