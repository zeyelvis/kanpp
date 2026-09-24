import type { CmsSource } from "./registry";

/** Raw 苹果CMS row (only the fields we use). */
export interface CmsItem {
  vod_id: number | string;
  vod_name: string;
  vod_sub?: string;
  vod_year?: string | number;
  type_name?: string;
  vod_area?: string;
  vod_lang?: string;
  vod_douban_id?: string | number;
  vod_remarks?: string;
  vod_time?: string;
  vod_pic?: string;
  vod_actor?: string;
  vod_director?: string;
  vod_play_from?: string;
  vod_play_url?: string;
}

export interface CmsPage {
  items: CmsItem[];
  page: number;
  pageCount: number;
  total: number;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

/**
 * Fetches one page of full rows. `hours` limits to rows updated in the last N hours
 * (incremental sync); omit it to walk the whole catalog.
 */
export async function fetchCmsPage(source: CmsSource, page: number, hours?: number): Promise<CmsPage> {
  const url = new URL(source.api);
  url.searchParams.set("ac", "videolist");
  url.searchParams.set("pg", String(page));
  if (hours) url.searchParams.set("h", String(hours));

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { list?: CmsItem[]; page?: number | string; pagecount?: number | string; total?: number | string };
      return {
        items: Array.isArray(data.list) ? data.list : [],
        page: Number(data.page ?? page),
        pageCount: Number(data.pagecount ?? 1),
        total: Number(data.total ?? 0),
      };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }
  throw new Error(`${source.id} page ${page}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function cleanDoubanId(raw: string | number | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{5,10}$/.test(s) && s !== "0" ? s : null;
}

export function cleanYear(raw: string | number | null | undefined): number | null {
  const n = Number(String(raw ?? "").slice(0, 4));
  return Number.isInteger(n) && n >= 1900 && n <= new Date().getFullYear() + 2 ? n : null;
}
