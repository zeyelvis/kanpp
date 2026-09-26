import type { Db } from "@/lib/db/types";
import { allTopics, type Topic } from "@/lib/domain/topics";

export interface TopicCount {
  count: number;
  /** Titles whose sources changed in the last 30 days. */
  recent: number;
}

/** sync_state key holding every topic's counts for the year: { year, at, counts }. */
export const TOPIC_COUNTS_KEY = "topic-counts";

/** The topic's own conditions, beyond "indexable" and its kind. */
export function topicConditions(topic: Topic): { clauses: string[]; params: (string | number)[] } {
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

/**
 * Counts of every topic: a few scans per kind count all of that kind's topics at once (a
 * scan per topic held D1, which runs one query at a time, long enough for pages to time out).
 */
export async function computeTopicCounts(db: Db, now = new Date().getFullYear()): Promise<Record<string, TopicCount>> {
  const byKind = new Map<string, Topic[]>();
  for (const t of allTopics(now)) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);
  const out: Record<string, TopicCount> = {};
  const cond = (p: { clauses: string[] }) => (p.clauses.length ? p.clauses.join(" AND ") : "1");
  for (const [kind, list] of byKind) {
    // D1 allows 100 bound parameters and 100 result columns per query: a kind's topics are
    // counted in as few batches as fit (each topic takes two columns and twice its params).
    const batches: Topic[][] = [[]];
    let params = 1;
    for (const t of list) {
      const need = topicConditions(t).params.length * 2;
      const current = batches.at(-1)!;
      if (current.length >= 40 || params + need > 95) {
        batches.push([]);
        params = 1;
      }
      batches.at(-1)!.push(t);
      params += need;
    }
    for (const batch of batches) {
      const parts = batch.map((t) => topicConditions(t));
      const row = await db.first<Record<string, number | null>>(
        `SELECT ${parts
          .map((p, i) => `SUM(${cond(p)}) AS c${i}, SUM((${cond(p)}) AND t.source_updated_at >= datetime('now', '-30 days')) AS r${i}`)
          .join(", ")}
         FROM titles t WHERE t.indexable = 1 AND t.kind = ?`,
        [...parts.flatMap((p) => [...p.params, ...p.params]), kind],
      );
      batch.forEach((t, i) => (out[t.name] = { count: row?.[`c${i}`] ?? 0, recent: row?.[`r${i}`] ?? 0 }));
    }
  }
  return out;
}

/**
 * Computed by the catalog ingest job (every 4 hours) and stored in one sync_state row, so
 * pages read one small row instead of several catalog scans: when the page cache is cold
 * (after a deploy), dozens of topic pages computed them at once.
 */
export async function storeTopicCounts(db: Db, now = new Date().getFullYear()): Promise<number> {
  const counts = await computeTopicCounts(db, now);
  await db.run(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    [TOPIC_COUNTS_KEY, JSON.stringify({ year: now, at: new Date().toISOString(), counts })],
  );
  return Object.keys(counts).length;
}
