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

/**
 * Title counts of every topic, for topics.xml. One scan per kind counts all of that kind's
 * topics at once: D1 runs one query at a time, and a query per topic (80 scans) held the
 * database long enough for other requests to time out.
 */
export function topicCounts(now = new Date().getFullYear()): Promise<Record<string, number>> {
  return cachedQuery(["topic-counts", now], [TAG.related], 86400, async () => {
    const db = await getDb();
    const byKind = new Map<string, Topic[]>();
    for (const t of allTopics(now)) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);
    const out: Record<string, number> = {};
    for (const [kind, list] of byKind) {
      const parts = list.map((t) => topicConditions(t));
      const row = await db.first<Record<string, number | null>>(
        `SELECT ${parts.map((p, i) => `SUM(${p.clauses.length ? p.clauses.join(" AND ") : "1"}) AS c${i}`).join(", ")}
         FROM titles t WHERE t.indexable = 1 AND t.kind = ?`,
        [...parts.flatMap((p) => p.params), kind],
      );
      list.forEach((t, i) => (out[t.name] = row?.[`c${i}`] ?? 0));
    }
    return out;
  });
}

/**
 * Everything a topic page shows, refreshed daily: counting scans the whole kind, so this is
 * deliberately not tied to every ingest run.
 */
export function topicData(topic: Topic): Promise<TopicData> {
  return cachedQuery(["topic", topic.name], [TAG.related], 86400, async () => {
    const db = await getDb();
    const w = filterSql(topic);
    const [counts, popular, recent, topRated] = await Promise.all([
      db.first<{ n: number; recent: number | null }>(
        `SELECT COUNT(*) AS n, SUM(t.source_updated_at >= datetime('now', '-30 days')) AS recent FROM titles t WHERE ${w.sql}`,
        w.params,
      ),
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
    return { count: counts?.n ?? 0, recentCount: counts?.recent ?? 0, popular, recent, topRated };
  });
}
