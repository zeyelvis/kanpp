import type { Db } from "@/lib/db/types";

/**
 * Douban's hot lists, the best public signal of what Chinese-speaking viewers watch right now.
 * Only their order is used, mapped to our titles by Douban id (external_ids): the home page
 * sections and charts (lib/data/home.ts) put these first and fill up with the catalog's own heat.
 * Fetched every 4 hours by the catalog job, one request per list, a second apart.
 */
export const HOT_LISTS = [
  ["tv:热门", "tv", "热门"],
  ["tv:国产剧", "tv", "国产剧"],
  ["tv:韩剧", "tv", "韩剧"],
  ["tv:美剧", "tv", "美剧"],
  ["tv:日剧", "tv", "日剧"],
  ["tv:港剧", "tv", "港剧"],
  ["tv:日本动画", "tv", "日本动画"],
  ["tv:综艺", "tv", "综艺"],
  ["movie:热门", "movie", "热门"],
  ["movie:华语", "movie", "华语"],
  ["movie:欧美", "movie", "欧美"],
  ["movie:韩国", "movie", "韩国"],
  ["movie:日本", "movie", "日本"],
] as const;

export type HotListKey = (typeof HOT_LISTS)[number][0];

/** sync_state key: { at, lists: { [key]: title ids in Douban's order } }. */
export const HOT_LISTS_KEY = "hot-lists";

export interface HotLists {
  at: string;
  lists: Partial<Record<HotListKey, number[]>>;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

async function fetchList(type: string, tag: string, fetcher: typeof fetch): Promise<string[]> {
  const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&page_limit=50&page_start=0`;
  const res = await fetcher(url, { headers: { "User-Agent": UA, Referer: "https://movie.douban.com/" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { subjects?: { id: string }[] };
  return (body.subjects ?? []).map((s) => String(s.id)).filter((id) => /^\d{5,10}$/.test(id));
}

/** Douban ids -> our title ids, in the given order (unknown ids dropped). */
export async function titlesForDoubanIds(db: Db, ids: string[]): Promise<number[]> {
  const map = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await db.all<{ external_id: string; title_id: number }>(
      `SELECT external_id, title_id FROM external_ids WHERE provider = 'douban' AND external_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of rows) map.set(r.external_id, r.title_id);
  }
  return [...new Set(ids.map((id) => map.get(id)).filter((id): id is number => id != null))];
}

export async function readHotLists(db: Db): Promise<HotLists | null> {
  const row = await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [HOT_LISTS_KEY]);
  return row?.value ? (JSON.parse(row.value) as HotLists) : null;
}

/** Refreshes the lists; one that fails keeps its previous version. Returns a short summary. */
export async function storeHotLists(db: Db, fetcher: typeof fetch = fetch, pauseMs = 1000): Promise<string> {
  const lists: HotLists["lists"] = { ...((await readHotLists(db))?.lists ?? {}) };
  let fetched = 0;
  const failed: string[] = [];
  for (const [key, type, tag] of HOT_LISTS) {
    try {
      lists[key] = await titlesForDoubanIds(db, await fetchList(type, tag, fetcher));
      fetched++;
    } catch (err) {
      failed.push(`${key} ${err instanceof Error ? err.message : err}`);
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  if (fetched > 0) {
    await db.run(
      "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      [HOT_LISTS_KEY, JSON.stringify({ at: new Date().toISOString(), lists } satisfies HotLists)],
    );
  }
  const sizes = HOT_LISTS.map(([key]) => lists[key]?.length ?? 0);
  return `${fetched}/${HOT_LISTS.length} lists (${sizes.join(",")} titles)${failed.length ? `, failed: ${failed.slice(0, 2).join("; ")}` : ""}`;
}
