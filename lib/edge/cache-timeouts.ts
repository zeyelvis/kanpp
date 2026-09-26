import type { CacheEntryType, CacheValue, IncrementalCache, NextModeTagCache, WithLastModified } from "@opennextjs/aws/types/overrides.js";

/**
 * Time limits for the OpenNext caches (open-next.config.ts). None of R2, the Cache API or the
 * tag database calls has a timeout of its own, and about one request in a thousand waited
 * ~30 s on a cache read that never reached the database (Sep 2026): the tag database (D1,
 * normally ~10 ms away) now and then stops answering for seconds. The caches only save work:
 * a read that takes too long counts as a miss (the page renders from D1 in about a second), a
 * tag check as "not revalidated" (the cached copy is served), a write is given up.
 * Slow and timed-out calls are logged as {slow: "<cache>-<op>", ...} to Workers Logs.
 */

const TIMED_OUT = Symbol("timed out");
/** Calls slower than this are logged even when they finish in time. */
const SLOW_MS = 1000;

/** The work itself keeps running after a timeout; there is nothing to cancel it with. */
async function within<T>(ms: number, work: Promise<T>): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function timed<T>(op: string, key: string, ms: number, work: Promise<T>): Promise<T | typeof TIMED_OUT> {
  const started = Date.now();
  const result = await within(ms, work);
  const elapsed = Date.now() - started;
  if (result === TIMED_OUT || elapsed >= SLOW_MS) {
    console.log(JSON.stringify({ slow: op, key: key.slice(0, 160), ms: elapsed, timedOut: result === TIMED_OUT }));
  }
  return result;
}

export function withCacheTimeouts(cache: IncrementalCache, label: string, limits: { getMs: number; setMs: number }): IncrementalCache {
  return {
    name: cache.name,
    async get<T extends CacheEntryType = "cache">(key: string, cacheType?: T): Promise<WithLastModified<CacheValue<T>> | null> {
      const result = await timed(`${label}-get`, key, limits.getMs, cache.get(key, cacheType));
      return result === TIMED_OUT ? null : result;
    },
    async set<T extends CacheEntryType = "cache">(key: string, value: CacheValue<T>, cacheType?: T): Promise<void> {
      await timed(`${label}-set`, key, limits.setMs, cache.set(key, value, cacheType));
    },
    delete: (key) => cache.delete(key),
  };
}

/**
 * After a tag check times out, the next ones in this isolate skip the database for `pauseMs`
 * and treat the entries as fresh: a stalled database would otherwise cost every request the
 * full limit, twice (a page checks hasBeenRevalidated, then isStale).
 */
export function withTagTimeouts(tagCache: NextModeTagCache, limitMs: number, pauseMs: number): NextModeTagCache {
  const key = (tags: string[]) => tags.join(",");
  let pausedUntil = 0;
  async function check<T>(op: string, tags: string[], fallback: T, work: () => Promise<T>): Promise<T> {
    if (Date.now() < pausedUntil) return fallback;
    const result = await timed(op, key(tags), limitMs, work());
    if (result !== TIMED_OUT) return result;
    pausedUntil = Date.now() + pauseMs;
    return fallback;
  }
  return {
    mode: "nextMode",
    name: tagCache.name,
    getLastRevalidated: (tags) => check("tags-last", tags, 0, () => tagCache.getLastRevalidated(tags)),
    hasBeenRevalidated: (tags, lastModified) => check("tags-check", tags, false, () => tagCache.hasBeenRevalidated(tags, lastModified)),
    // Invalidation must not be dropped: writes wait as long as they take.
    writeTags: (tags) => tagCache.writeTags(tags),
    ...(tagCache.isStale
      ? { isStale: (tags: string[], lastModified?: number) => check("tags-stale", tags, false, () => tagCache.isStale!(tags, lastModified)) }
      : {}),
    ...(tagCache.getPathsByTags ? { getPathsByTags: (tags: string[]) => tagCache.getPathsByTags!(tags) } : {}),
  };
}
