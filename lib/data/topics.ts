import "server-only";
import { cachedQuery, TAG } from "@/lib/data/cache";
import { CARD_COLUMNS, CARD_JOIN, type TitleCard } from "@/lib/data/titles";
import { getDb } from "@/lib/db/server";
import type { Topic } from "@/lib/domain/topics";

export interface TopicData {
  count: number;
  /** Titles whose sources changed in the last 30 days. */
  recentCount: number;
  popular: TitleCard[];
  recent: TitleCard[];
  topRated: TitleCard[];
}

function filterSql(topic: Topic): { sql: string; params: (string | number)[] } {
  const clauses = ["t.indexable = 1", "t.kind = ?"];
  const params: (string | number)[] = [topic.kind];
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
  return { sql: clauses.join(" AND "), params };
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
