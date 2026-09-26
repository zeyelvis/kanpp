import "server-only";
import { cachedQuery, TAG } from "@/lib/data/cache";
import { CARD_COLUMNS, CARD_JOIN, type TitleCard } from "@/lib/data/titles";
import { getDb } from "@/lib/db/server";
import { allTopics, type Topic } from "@/lib/domain/topics";

export interface TopicData {
  count: number;
  /** Titles whose sources changed in the last 30 days. */
  recentCount: number;
  popular: TitleCard[];
  recent: TitleCard[];
  topRated: TitleCard[];
}

/** The topic's own conditions, beyond "indexable" and its kind. */
function topicConditions(topic: Topic): { clauses: string[]; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (topic.regions?.length) {
    clauses.push(`(${topic.regions.map(() => "t.countries LIKE ?").join(" OR ")})`);
    params.push(...topic.regions.map((r) => `%"${r}"%`));
  }
  if (topic.genres?.length) {
    clauses.push(`(${topic.genres.map(() => "t.genres LIKE ?").join(" OR ")})`);
    params.push(...topic.genres.map((g) => `%"${g}"%`));
  }
  if (topic.year != null) {
    clauses.push("t.year = ?");
    params.push(topic.year);
  }
  return { clauses, params };
}

function filterSql(topic: Topic): { sql: string; params: (string | number)[] } {
  const own = topicConditions(topic);
  return { sql: ["t.indexable = 1", "t.kind = ?", ...own.clauses].join(" AND "), params: [topic.kind, ...own.params] };
}

export interface TopicCount {
  count: number;
  /** Titles whose sources changed in the last 30 days. */
  recent: number;
}

/**
 * Title counts of every topic, for topics.xml and the topic pages. One scan per kind counts
 * all of that kind's topics at once: D1 runs one query at a time, and a query per topic
 * (80 scans) held the database long enough for other requests to time out.
 */
export function topicCounts(now = new Date().getFullYear()): Promise<Record<string, TopicCount>> {
  return cachedQuery(["topic-counts-v2", now], [TAG.related], 86400, async () => {
    const db = await getDb();
    const byKind = new Map<string, Topic[]>();
    for (const t of allTopics(now)) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);
    const out: Record<string, TopicCount> = {};
    for (const [kind, list] of byKind) {
      const parts = list.map((t) => topicConditions(t));
      const cond = (p: { clauses: string[] }) => (p.clauses.length ? p.clauses.join(" AND ") : "1");
      const row = await db.first<Record<string, number | null>>(
        `SELECT ${parts
          .map((p, i) => `SUM(${cond(p)}) AS c${i}, SUM((${cond(p)}) AND t.source_updated_at >= datetime('now', '-30 days')) AS r${i}`)
          .join(", ")}
         FROM titles t WHERE t.indexable = 1 AND t.kind = ?`,
        [...parts.flatMap((p) => [...p.params, ...p.params]), kind],
      );
      list.forEach((t, i) => (out[t.name] = { count: row?.[`c${i}`] ?? 0, recent: row?.[`r${i}`] ?? 0 }));
    }
    return out;
  });
}

/**
 * Everything a topic page shows, refreshed daily and deliberately not tied to every ingest
 * run. The counts come from topicCounts (one scan per kind for all topics).
 */
export function topicData(topic: Topic): Promise<TopicData> {
  return cachedQuery(["topic", topic.name], [TAG.related], 86400, async () => {
    const db = await getDb();
    const w = filterSql(topic);
    const [counts, popular, recent, topRated] = await Promise.all([
      topicCounts().then((all) => all[topic.name] ?? { count: 0, recent: 0 }),
      db.all<TitleCard>(`SELECT ${CARD_COLUMNS} ${CARD_JOIN} WHERE ${w.sql} ORDER BY t.popularity DESC LIMIT 48`, w.params),
      db.all<TitleCard>(
        `SELECT ${CARD_COLUMNS} ${CARD_JOIN} WHERE ${w.sql} AND t.source_updated_at >= datetime('now', '-30 days')
         ORDER BY t.source_updated_at DESC LIMIT 12`,
        w.params,
      ),
      db.all<TitleCard>(
        `SELECT ${CARD_COLUMNS} ${CARD_JOIN} WHERE ${w.sql} AND t.vote_count >= 50
         ORDER BY t.vote_average DESC, t.vote_count DESC LIMIT 12`,
        w.params,
      ),
    ]);
    return { count: counts.count, recentCount: counts.recent, popular, recent, topRated };
  });
}
