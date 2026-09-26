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
  vote_count: number | null;
  popularity: number | null;
}

export interface Collaborator {
  id: number;
  name: string;
  slug: string;
  profile_path: string | null;
  /** Titles made together (among this person's indexable titles). */
  shared: number;
  /** What the collaborator did on most of them: 演员, 导演, ... */
  role: string;
}

// Tagged `slugs` too: a person page cached as a 404 must appear once their slug is created.
/*
 * Person pages are ISR-cached (refreshed daily): their data is read from D1 directly, which
 * is far quicker than a data-cache miss, and they carry no tag that every ingest run expires.
 */

/** The person a slug names, or null; a miss is remembered under "slugs" (see resolveSlug). */
export const getPersonBySlug = cache(async (slug: string): Promise<PersonDetail | null> => {
  const person = await (await getDb()).first<PersonDetail>(
    "SELECT id, name, profile_path, title_count, slug, indexable, updated_at FROM people WHERE slug = ?",
    [slug],
  );
  if (!person) await cachedQuery(["person-miss", slug], [TAG.slugs], 86400, async () => null);
  return person;
});

/** The person's indexable titles, newest first, one entry per title. */
export const personCredits = cache(async (personId: number): Promise<PersonCredit[]> => {
  const rows = await (await getDb()).all<TitleCard & { role: string; character: string | null; vote_count: number | null; popularity: number | null }>(
    // CROSS JOIN fixes the join order: the person's credit ids drive primary-key lookups
    // into titles. Left to the planner, SQLite scanned every indexable title and expanded
    // the credits JSON once per title (tens of millions of steps per page).
    `SELECT ${CARD_COLUMNS}, t.vote_count, t.popularity, json_extract(c.value, '$.r') AS role, json_extract(c.value, '$.c') AS character
     FROM people p CROSS JOIN json_each(p.credits) c CROSS JOIN titles t CROSS JOIN slugs s
     WHERE p.id = ? AND t.id = json_extract(c.value, '$.t') AND t.indexable = 1
       AND s.title_id = t.id AND s.is_canonical = 1
     ORDER BY COALESCE(t.year, 0) DESC, t.popularity DESC`,
    [personId],
  );
  const byTitle = new Map<number, PersonCredit>();
  for (const { role, character, ...card } of rows) {
    const hit = byTitle.get(card.id);
    if (hit) {
      if (!hit.roles.includes(role)) hit.roles.push(role);
      hit.character ??= character;
    } else byTitle.set(card.id, { ...card, roles: [role], character });
  }
  return [...byTitle.values()];
});

/**
 * Other titles by the given people (cast with person pages), interleaved so each person is
 * represented, newest first per person, without the current title.
 */
export async function castOtherWorks(personIds: number[], excludeTitleId: number, limit: number): Promise<PersonCredit[]> {
  const lists = await Promise.all(personIds.map((id) => personCredits(id)));
  const seen = new Set([excludeTitleId]);
  const out: PersonCredit[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const t = list[i];
      if (t && !seen.has(t.id) && out.length < limit) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}

export interface PersonNetwork {
  collaborators: Collaborator[];
  /** Title id -> the person's position in its billed cast (0 = top billed); absent when not in the cast. */
  billing: Record<number, number>;
}

/**
 * From the billed cast (up to 12) and the directors/creators/writers of the person's titles:
 * the people who worked with this person most often (only people with a page, at least two
 * shared titles, most shared first), and where the person is billed on each title.
 */
export async function personNetwork(personId: number, titleIds: number[], limit = 12): Promise<PersonNetwork> {
  const db = await getDb();
  const rows: { id: number; cast_json: string; crew_json: string }[] = [];
  for (let i = 0; i < titleIds.length; i += 90) {
    const chunk = titleIds.slice(i, i + 90);
    rows.push(...(await db.all<{ id: number; cast_json: string; crew_json: string }>(
      `SELECT id, cast_json, crew_json FROM titles WHERE id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    )));
  }
  const billing: Record<number, number> = {};
  const tally = new Map<number, { name: string; profile: string | null; titles: number; roles: Map<string, number> }>();
  for (const row of rows) {
    const seen = new Map<number, string>();
    const cast = JSON.parse(row.cast_json || "[]") as { id: number | null; name: string; profile?: string | null }[];
    const position = cast.findIndex((c) => c.id === personId);
    if (position >= 0) billing[row.id] = position;
    for (const c of cast) {
      if (c.id != null && c.id !== personId && !seen.has(c.id)) seen.set(c.id, "演员");
      if (c.id != null && !tally.has(c.id)) tally.set(c.id, { name: c.name, profile: c.profile ?? null, titles: 0, roles: new Map() });
    }
    for (const c of JSON.parse(row.crew_json || "[]") as { id: number | null; name: string; job: string }[]) {
      if (c.id == null || c.id === personId) continue;
      if (!seen.has(c.id) || c.job === "导演") seen.set(c.id, c.job);
      if (!tally.has(c.id)) tally.set(c.id, { name: c.name, profile: null, titles: 0, roles: new Map() });
    }
    for (const [id, role] of seen) {
      const t = tally.get(id)!;
      t.titles++;
      t.roles.set(role, (t.roles.get(role) ?? 0) + 1);
    }
  }
  const top = [...tally.entries()]
    .filter(([, t]) => t.titles >= 2)
    .sort((a, b) => b[1].titles - a[1].titles || a[0] - b[0])
    .slice(0, 60);
  const slugs = await personSlugs(top.map(([id]) => id));
  const collaborators = top
    .filter(([id]) => slugs[id])
    .slice(0, limit)
    .map(([id, t]) => ({
      id,
      name: t.name,
      slug: slugs[id],
      profile_path: t.profile,
      shared: t.titles,
      role: [...t.roles.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }));
  return { collaborators, billing };
}

/** Slugs of the given people that have an indexable page (for linking cast lists). */
export async function personSlugs(ids: number[]): Promise<Record<number, string>> {
  const unique = [...new Set(ids)].sort((a, b) => a - b).slice(0, 90);
  if (unique.length === 0) return {};
  const rows = await (await getDb()).all<{ id: number; slug: string }>(
    // "+indexable" keeps SQLite on the primary key: with a plain term it walked the
    // indexable index (every person with a page) for each title page.
    `SELECT id, slug FROM people WHERE id IN (${unique.map(() => "?").join(",")}) AND +indexable = 1`,
    unique,
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.slug]));
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

/**
 * Everything a person page (and its Markdown version) shows; null when there is no page:
 * unknown slug, or no indexable titles left (the slug stays reserved).
 */
// Request-scoped (React cache): generateMetadata and the page share one load.
export const loadPersonPage = cache(async (slug: string): Promise<({ person: PersonDetail; credits: PersonCredit[] } & PersonNetwork) | null> => {
  const person = await getPersonBySlug(slug);
  if (!person) return null;
  const credits = await personCredits(person.id);
  if (credits.length === 0) return null;
  return { person, credits, ...(await personNetwork(person.id, credits.map((c) => c.id))) };
});

export interface PersonHit {
  name: string;
  slug: string;
  profile_path: string | null;
  title_count: number;
}

/** People with a page whose name starts with the query ("周迅", "宫崎"), most titles first. */
export function searchPeople(query: string, limit = 6): Promise<PersonHit[]> {
  const q = query.normalize("NFKC").trim();
  if (!/^\p{Script=Han}[\p{Script=Han}·・]*$/u.test(q)) return Promise.resolve([]);
  return cachedQuery(["search-people", q, limit], [TAG.catalog], 3600, async () =>
    (await getDb()).all<PersonHit>(
      `SELECT name, slug, profile_path, title_count FROM people
       WHERE slug >= ? AND slug < ? AND +indexable = 1 ORDER BY (name = ?) DESC, title_count DESC LIMIT ?`,
      [q, `${q}\u{10FFFF}`, q, limit],
    ),
  );
}
