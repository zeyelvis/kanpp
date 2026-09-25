import "server-only";
import { cache } from "react";
import { cachedQuery, TAG } from "@/lib/data/cache";
import { CARD_COLUMNS, storedCount, type TitleCard } from "@/lib/data/titles";
import { getDb } from "@/lib/db/server";

export interface PersonDetail {
  id: number;
  name: string;
  profile_path: string | null;
  title_count: number;
  slug: string;
  indexable: number;
  updated_at: string;
}

export interface PersonCredit extends TitleCard {
  /** 演员, 导演, 编剧, 主创 (one title can carry several) */
  roles: string[];
  character: string | null;
}

// Tagged `slugs` too: a person page cached as a 404 must appear once their slug is created.
export const getPersonBySlug = cache((slug: string): Promise<PersonDetail | null> =>
  cachedQuery(["person", slug], [TAG.slugs, TAG.catalog], 86400, async () =>
    (await getDb()).first<PersonDetail>(
      "SELECT id, name, profile_path, title_count, slug, indexable, updated_at FROM people WHERE slug = ?",
      [slug],
    ),
  ),
);

/** The person's indexable titles, newest first, one entry per title. */
export const personCredits = cache((personId: number): Promise<PersonCredit[]> =>
  cachedQuery(["person-credits", personId], [TAG.catalog], 86400, async () => {
    const rows = await (await getDb()).all<TitleCard & { role: string; character: string | null; popularity: number | null }>(
      // CROSS JOIN fixes the join order: the person's credit ids drive primary-key lookups
      // into titles. Left to the planner, SQLite scanned every indexable title and expanded
      // the credits JSON once per title (tens of millions of steps per page).
      `SELECT ${CARD_COLUMNS}, t.popularity, json_extract(c.value, '$.r') AS role, json_extract(c.value, '$.c') AS character
       FROM people p CROSS JOIN json_each(p.credits) c CROSS JOIN titles t CROSS JOIN slugs s
       WHERE p.id = ? AND t.id = json_extract(c.value, '$.t') AND t.indexable = 1
         AND s.title_id = t.id AND s.is_canonical = 1
       ORDER BY COALESCE(t.year, 0) DESC, t.popularity DESC`,
      [personId],
    );
    const byTitle = new Map<number, PersonCredit>();
    for (const { role, character, popularity: _p, ...card } of rows) {
      const hit = byTitle.get(card.id);
      if (hit) {
        if (!hit.roles.includes(role)) hit.roles.push(role);
        hit.character ??= character;
      } else byTitle.set(card.id, { ...card, roles: [role], character });
    }
    return [...byTitle.values()];
  }),
);

/** Slugs of the given people that have an indexable page (for linking cast lists). */
export function personSlugs(ids: number[]): Promise<Record<number, string>> {
  const unique = [...new Set(ids)].sort((a, b) => a - b).slice(0, 90);
  if (unique.length === 0) return Promise.resolve({});
  // Slow-moving: refreshed daily, so title pages do not go stale on every ingest run.
  return cachedQuery(["person-slugs", unique.join(",")], [TAG.related], 86400, async () => {
    const rows = await (await getDb()).all<{ id: number; slug: string }>(
      // "+indexable" keeps SQLite on the primary key: with a plain term it walked the
      // indexable index (every person with a page) for each title page.
      `SELECT id, slug FROM people WHERE id IN (${unique.map(() => "?").join(",")}) AND +indexable = 1`,
      unique,
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.slug]));
  });
}

export function sitemapPeople(offset: number, limit: number): Promise<{ slug: string; updated_at: string }[]> {
  return cachedQuery(["sitemap-people", offset, limit], [TAG.catalog], 3600, async () =>
    (await getDb()).all<{ slug: string; updated_at: string }>(
      "SELECT slug, updated_at FROM people WHERE indexable = 1 ORDER BY id LIMIT ? OFFSET ?",
      [limit, offset],
    ),
  );
}

export function countPeople(): Promise<number> {
  return storedCount("people", "SELECT COUNT(*) AS n FROM people WHERE indexable = 1", []);
}
