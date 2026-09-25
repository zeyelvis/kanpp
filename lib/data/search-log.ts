import "server-only";
import { getDb } from "@/lib/db/server";
import { storedSearchTerm } from "@/lib/domain/search-term";

/** Counts a submitted search for today (see migrations/0009). */
export async function recordSearch(raw: string, results: number) {
  const term = storedSearchTerm(raw);
  if (!term) return;
  await (await getDb()).run(
    `INSERT INTO search_terms (day, term, n, results) VALUES (date('now'), ?, 1, ?)
     ON CONFLICT (day, term) DO UPDATE SET n = n + 1, results = excluded.results`,
    [term, results],
  );
}
