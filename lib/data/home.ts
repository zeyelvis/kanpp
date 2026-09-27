import "server-only";
import { cachedQuery, TAG } from "@/lib/data/cache";
import { CARD_COLUMNS, CARD_JOIN, type FeaturedCard, type TitleCard } from "@/lib/data/titles";
import { getDb } from "@/lib/db/server";
import type { Kind } from "@/lib/domain/kinds";
import { readHotLists, type HotListKey } from "@/lib/ingest/hot-lists";

/**
 * Home page sections and charts: what Chinese-speaking viewers watch now. Douban's hot list for
 * the section leads (lib/ingest/hot-lists.ts), then the catalog's own heat fills up: how many of
 * our sources carry a title (they pick up what those viewers watch), then TMDB popularity,
 * among titles still airing (series) or recently released (films).
 */
export interface HotSpec {
  list?: HotListKey;
  kinds: Kind[];
  regions?: string[];
  /** Series: first aired this year or last. */
  current?: boolean;
  /** Series: new progress (an episode, a finish) within this many days. */
  activeDays?: number;
  /** Films: released within this many days. */
  releasedDays?: number;
}

export const GREATER_CHINA = ["CN", "HK", "TW"];
export const WESTERN = ["US", "GB", "FR", "DE", "CA", "ES", "IT", "AU"];

function heatFilter(spec: HotSpec, exclude: number[]): { sql: string; params: (string | number)[] } {
  const clauses = ["t.indexable = 1", `t.kind IN (${spec.kinds.map(() => "?").join(",")})`];
  const params: (string | number)[] = [...spec.kinds];
  if (spec.regions?.length) {
    clauses.push(`(${spec.regions.map(() => "t.countries LIKE ?").join(" OR ")})`);
    params.push(...spec.regions.map((r) => `%"${r}"%`));
  }
  if (spec.current) {
    clauses.push("t.year >= ?");
    params.push(new Date().getFullYear() - 1);
  }
  if (spec.activeDays) {
    clauses.push(`t.source_updated_at >= datetime('now', '-${spec.activeDays} days')`);
  }
  if (spec.releasedDays) {
    clauses.push(`t.release_date >= date('now', '-${spec.releasedDays} days')`);
  }
  if (exclude.length) {
    clauses.push(`t.id NOT IN (${exclude.map(() => "?").join(",")})`);
    params.push(...exclude);
  }
  return { sql: clauses.join(" AND "), params };
}

const hotListsCached = () => cachedQuery(["hot-lists"], [TAG.catalog], 900, async () => readHotLists(await getDb()));

/** Cards for title ids in their order, only those that match the section's kinds. */
async function cardsInOrder(ids: number[], kinds: Kind[]): Promise<TitleCard[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows: TitleCard[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    rows.push(
      ...(await db.all<TitleCard>(
        `SELECT ${CARD_COLUMNS} ${CARD_JOIN} WHERE t.id IN (${chunk.map(() => "?").join(",")}) AND t.indexable = 1
           AND t.kind IN (${kinds.map(() => "?").join(",")})`,
        [...chunk, ...kinds],
      )),
    );
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is TitleCard => r != null);
}

export function hotTitles(spec: HotSpec, limit: number): Promise<TitleCard[]> {
  return cachedQuery(["hot", JSON.stringify(spec), limit], [TAG.catalog], 900, async () => {
    const lists = await hotListsCached();
    const led = (await cardsInOrder((spec.list ? lists?.lists[spec.list] : null) ?? [], spec.kinds)).slice(0, limit);
    if (led.length >= limit) return led;
    const f = heatFilter(spec, led.map((t) => t.id));
    const rest = await (await getDb()).all<TitleCard>(
      `SELECT ${CARD_COLUMNS} ${CARD_JOIN} WHERE ${f.sql} ORDER BY t.source_count DESC, t.popularity DESC LIMIT ?`,
      [...f.params, limit - led.length],
    );
    return [...led, ...rest];
  });
}

/** Hero slides: the leaders of several sections, interleaved, those with a backdrop. */
export function heroTitles(specs: HotSpec[], limit: number): Promise<FeaturedCard[]> {
  return cachedQuery(["hero", JSON.stringify(specs), limit], [TAG.catalog], 900, async () => {
    const columns = await Promise.all(specs.map((s) => hotTitles(s, 6)));
    const order: number[] = [];
    for (let i = 0; i < 6; i++) for (const col of columns) if (col[i] && !order.includes(col[i].id)) order.push(col[i].id);
    if (order.length === 0) return [];
    const rows = await (await getDb()).all<FeaturedCard>(
      `SELECT ${CARD_COLUMNS}, t.backdrop_path, t.overview, t.genres, t.tmdb_type ${CARD_JOIN}
       WHERE t.id IN (${order.map(() => "?").join(",")}) AND t.backdrop_path IS NOT NULL`,
      order,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return order.map((id) => byId.get(id)).filter((r): r is FeaturedCard => r != null).slice(0, limit);
  });
}

/** Sections of the home page and the charts, in one place so both stay in step. */
export const SECTIONS = {
  tv: {
    tabs: [
      { label: "国产剧", spec: { list: "tv:国产剧", kinds: ["tv"], regions: ["CN"], current: true, activeDays: 30 } },
      { label: "韩剧", spec: { list: "tv:韩剧", kinds: ["tv"], regions: ["KR"], current: true, activeDays: 30 } },
      { label: "美剧", spec: { list: "tv:美剧", kinds: ["tv"], regions: ["US"], current: true, activeDays: 30 } },
      { label: "日剧", spec: { list: "tv:日剧", kinds: ["tv"], regions: ["JP"], current: true, activeDays: 30 } },
      { label: "港剧", spec: { list: "tv:港剧", kinds: ["tv"], regions: ["HK"], current: true, activeDays: 60 } },
    ],
    chart: { list: "tv:热门", kinds: ["tv"], current: true, activeDays: 30 },
  },
  movie: {
    tabs: [
      { label: "热门", spec: { list: "movie:热门", kinds: ["movie"], releasedDays: 180 } },
      { label: "华语", spec: { list: "movie:华语", kinds: ["movie"], regions: GREATER_CHINA, releasedDays: 365 } },
      { label: "欧美", spec: { list: "movie:欧美", kinds: ["movie"], regions: WESTERN, releasedDays: 180 } },
      { label: "韩国", spec: { list: "movie:韩国", kinds: ["movie"], regions: ["KR"], releasedDays: 365 } },
      { label: "日本", spec: { list: "movie:日本", kinds: ["movie", "anime"], regions: ["JP"], releasedDays: 365 } },
    ],
    chart: { list: "movie:热门", kinds: ["movie"], releasedDays: 180 },
  },
  anime: {
    tabs: [
      { label: "国漫", spec: { kinds: ["anime"], regions: ["CN"], current: true, activeDays: 30 } },
      { label: "日漫新番", spec: { list: "tv:日本动画", kinds: ["anime"], regions: ["JP"], current: true, activeDays: 30 } },
    ],
    chart: { kinds: ["anime"], current: true, activeDays: 30 },
  },
  variety: {
    tabs: [
      { label: "大陆综艺", spec: { list: "tv:综艺", kinds: ["variety"], regions: ["CN"], activeDays: 30 } },
      { label: "韩国综艺", spec: { kinds: ["variety"], regions: ["KR"], activeDays: 30 } },
    ],
    chart: { list: "tv:综艺", kinds: ["variety"], activeDays: 30 },
  },
} satisfies Record<string, { tabs: { label: string; spec: HotSpec }[]; chart: HotSpec }>;

export type ChartKind = keyof typeof SECTIONS;

/** When Douban's lists were last fetched (ISO), for the charts' "updated" line. */
export function hotListsUpdatedAt(): Promise<string | null> {
  return hotListsCached().then((l) => l?.at ?? null);
}

/** Chart pages: a kind's overall chart and one per tab, longer than on the home page. */
export async function chartData(kind: ChartKind, overall = 50, perTab = 30) {
  const section = SECTIONS[kind];
  const [chart, tabs] = await Promise.all([
    hotTitles(section.chart, overall),
    Promise.all(section.tabs.map(async (t) => ({ label: t.label, titles: await hotTitles(t.spec, perTab) }))),
  ]);
  return { chart, tabs };
}
