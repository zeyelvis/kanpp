import type { Db } from "@/lib/db/types";
import { slugCandidates } from "@/lib/domain/slug";

/** A person gets an indexable page once credited on this many indexable titles. */
export const MIN_PERSON_TITLES = 3;

// Pages are for names Chinese-speaking visitors search for: Han-script names only
// ("周迅", "阿尔·帕西诺"), not untranslated ones.
const HAN_NAME = /^\p{Script=Han}[\p{Script=Han}·・]{1,11}$/u;

export function isPageableName(name: string): boolean {
  return HAN_NAME.test(name);
}

// Every credit on an indexable title: cast from cast_json, crew (导演/编剧/主创) from crew_json.
const CREDITS = `
  SELECT CAST(json_extract(je.value, '$.id') AS INTEGER) AS pid, json_extract(je.value, '$.name') AS name,
         json_extract(je.value, '$.profile') AS profile, t.id AS tid, '演员' AS role,
         json_extract(je.value, '$.character') AS ch
  FROM titles t, json_each(t.cast_json) je WHERE t.indexable = 1
  UNION ALL
  SELECT CAST(json_extract(je.value, '$.id') AS INTEGER), json_extract(je.value, '$.name'), NULL, t.id,
         json_extract(je.value, '$.job'), NULL
  FROM titles t, json_each(t.crew_json) je WHERE t.indexable = 1`;

// Rebuilds every person's credits in one statement inside the database (same SQL on D1 and on
// a local mirror). Rows are ordered before grouping so an unchanged person produces an
// identical JSON string and is not rewritten.
const RECOMPUTE = `
  WITH c AS (${CREDITS}),
  agg AS (
    SELECT pid, MAX(name) AS name, MAX(profile) AS profile,
           json_group_array(json_object('t', tid, 'r', role, 'c', ch)) AS credits, COUNT(DISTINCT tid) AS n
    FROM (SELECT * FROM c WHERE pid IS NOT NULL ORDER BY pid, tid, role)
    GROUP BY pid
  )
  INSERT INTO people (id, name, profile_path, credits, title_count)
  SELECT pid, name, profile, credits, n FROM agg WHERE true
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name, profile_path = excluded.profile_path, credits = excluded.credits,
    title_count = excluded.title_count, updated_at = datetime('now')
  WHERE people.credits IS NOT excluded.credits OR people.name IS NOT excluded.name
     OR people.profile_path IS NOT excluded.profile_path`;

// People whose titles all left the index keep their row (and slug) with no credits.
const CLEAR_GONE = `
  UPDATE people SET credits = '[]', title_count = 0, updated_at = datetime('now')
  WHERE title_count > 0 AND id NOT IN (SELECT pid FROM (${CREDITS}) WHERE pid IS NOT NULL)`;

/**
 * Recomputes people from the titles' credits, gives newly eligible people a permanent slug,
 * and updates who is indexable. Returns how many slugs were created (their pages may have
 * been cached as 404s).
 */
export async function refreshPeople(db: Db): Promise<{ changed: number; slugged: number; indexable: number }> {
  let changed = (await db.run(RECOMPUTE)).changes;
  changed += (await db.run(CLEAR_GONE)).changes;

  const candidates = await db.all<{ id: number; name: string }>(
    "SELECT id, name FROM people WHERE slug IS NULL AND title_count >= ? ORDER BY title_count DESC, id",
    [MIN_PERSON_TITLES],
  );
  let slugged = 0;
  for (const p of candidates) {
    if (!isPageableName(p.name)) continue;
    // Same-name people: the one with more titles gets the plain name, later ones name-2, name-3.
    for (const candidate of slugCandidates(p.name, null)) {
      if (await db.first("SELECT 1 FROM people WHERE slug = ?", [candidate])) continue;
      const res = await db.run("UPDATE people SET slug = ? WHERE id = ? AND slug IS NULL", [candidate, p.id]).catch(() => null);
      if (res?.changes) slugged++;
      if (res) break;
    }
  }

  changed += (
    await db.run(
      `UPDATE people SET indexable = (slug IS NOT NULL AND title_count >= ?), updated_at = datetime('now')
       WHERE indexable IS NOT (slug IS NOT NULL AND title_count >= ?)`,
      [MIN_PERSON_TITLES, MIN_PERSON_TITLES],
    )
  ).changes;
  const indexable = (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM people WHERE indexable = 1"))?.n ?? 0;
  await db.run(
    "INSERT INTO sync_state (key, value) VALUES ('count:people', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    [String(indexable)],
  );
  return { changed, slugged, indexable };
}
