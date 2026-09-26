import "server-only";
import { cachedQuery, TAG } from "@/lib/data/cache";
import { CARD_COLUMNS, CARD_JOIN, type TitleCard } from "@/lib/data/titles";
import { getDb } from "@/lib/db/server";
import type { Topic } from "@/lib/domain/topics";
import { computeTopicCounts, TOPIC_COUNTS_KEY, topicConditions, type TopicCount } from "@/lib/ingest/topic-counts";

export interface TopicData {
  count: number;
  /** Titles whose sources changed in the last 30 days. */
  recentCount: number;
  popular: TitleCard[];
  recent: TitleCard[];
  topRated: TitleCard[];
}

function filterSql(topic: Topic): { sql: string; params: (string | number)[] } {
  const own = topicConditions(topic);
  return { sql: ["t.indexable = 1", "t.kind = ?", ...own.clauses].join(" AND "), params: [topic.kind, ...own.params] };
}

/**
 * Every topic's counts, from the row the catalog ingest job stores (lib/ingest/topic-counts.ts);
 * computed here only until that row exists for this year.
 */
export function topicCounts(now = new Date().getFullYear()): Promise<Record<string, TopicCount>> {
  return cachedQuery(["topic-counts-v3", now], [TAG.catalog], 3600, async () => {
    const db = await getDb();
    const row = await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [TOPIC_COUNTS_KEY]);
    const stored = row?.value ? (JSON.parse(row.value) as { year: number; counts: Record<string, TopicCount> }) : null;
    return stored?.year === now ? stored.counts : computeTopicCounts(db, now);
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
