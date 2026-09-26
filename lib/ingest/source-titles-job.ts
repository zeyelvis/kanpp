import type { Db, Statement } from "@/lib/db/types";
import type { Kind } from "@/lib/domain/kinds";
import { slugCandidates, titlePath } from "@/lib/domain/slug";
import { cleanContent, fetchCmsByIds } from "@/lib/sources/cms";
import { getSource } from "@/lib/sources/registry";
import type { JobContext } from "./pipeline";
import { refreshTitles, storeCatalogCounts } from "./publish";
import { groupSourceRows, planSourceTitle, SOURCE_TITLE_TYPES, type SourceRow, type SourceTitlePlan } from "./source-titles";

/**
 * Builds titles from the CMS sources' own metadata for Chinese animation and variety shows
 * that TMDB does not list (rules: lib/ingest/source-titles.ts). Writes with explicit title ids,
 * so the caller must hold the catalog lease (lib/ingest/lease.ts).
 */

async function chunks<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** Unmatched rows in the eligible categories, paged by rowid (D1 responses stay small). */
async function readRows(db: Db): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  for (let after = 0; ; ) {
    const page = await db.all<SourceRow & { rid: number }>(
      `SELECT rowid AS rid, source_id, vod_id, vod_name, vod_year, type_name, area, pic, actor, director, content, classes,
              remarks, vod_time, episode_count
       FROM source_items WHERE match_status = 'unmatched' AND type_name IN (${SOURCE_TITLE_TYPES.map(() => "?").join(",")})
         AND rowid > ? ORDER BY rowid LIMIT 2000`,
      [...SOURCE_TITLE_TYPES, after],
    );
    rows.push(...page);
    if (page.length < 2000) return rows;
    after = page.at(-1)!.rid;
  }
}

/** Fetches synopses for rows that lack one (existing rows predate the content column). */
async function fillContent(ctx: JobContext, rows: SourceRow[]): Promise<number> {
  const missing = rows.filter((r) => r.content == null && getSource(r.source_id));
  const bySource = new Map<string, SourceRow[]>();
  for (const r of missing) bySource.set(r.source_id, [...(bySource.get(r.source_id) ?? []), r]);
  let filled = 0;
  await Promise.all(
    [...bySource.entries()].map(async ([sourceId, list]) => {
      const source = getSource(sourceId)!;
      await chunks(list, 20, async (chunk) => {
        const items = await fetchCmsByIds(source, chunk.map((r) => r.vod_id)).catch((err: unknown) => {
          ctx.log(`details ${sourceId} failed: ${err instanceof Error ? err.message : err}`);
          return [];
        });
        const byId = new Map(items.map((i) => [String(i.vod_id), i]));
        const updates: Statement[] = [];
        for (const r of chunk) {
          const item = byId.get(r.vod_id);
          if (!item) continue;
          // "" marks "fetched, the source has none", so later runs do not ask again.
          r.content = cleanContent(item.vod_content) ?? "";
          r.classes = item.vod_class?.trim() || null;
          if (r.content) filled++;
          updates.push({ sql: "UPDATE source_items SET content = ?, classes = ? WHERE source_id = ? AND vod_id = ?", params: [r.content, r.classes, r.source_id, r.vod_id] });
        }
        if (updates.length) await ctx.db.batch(updates);
      });
    }),
  );
  return filled;
}

/** Existing titles under any of the plans' names: norm -> title. */
async function existingByAlias(db: Db, norms: string[]): Promise<Map<string, { id: number; kind: Kind; origin: string }>> {
  const out = new Map<string, { id: number; kind: Kind; origin: string }>();
  await chunks([...new Set(norms)], 90, async (chunk) => {
    const rows = await db.all<{ norm: string; id: number; kind: Kind; origin: string }>(
      `SELECT a.norm, t.id, t.kind, t.origin FROM aliases a JOIN titles t ON t.id = a.title_id
       WHERE t.status = 'active' AND a.norm IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of rows) out.set(r.norm, { id: r.id, kind: r.kind, origin: r.origin });
  });
  return out;
}

/** First free slug per plan, checked against the database and against each other. */
async function assignSlugs(db: Db, plans: SourceTitlePlan[]): Promise<Map<SourceTitlePlan, string>> {
  const candidates = new Map(plans.map((p) => [p, [...slugCandidates(p.name, p.year)].slice(0, 10)]));
  const taken = new Set<string>();
  await chunks([...candidates.values()].flat(), 90, async (chunk) => {
    const rows = await db.all<{ slug: string }>(`SELECT slug FROM slugs WHERE slug IN (${chunk.map(() => "?").join(",")})`, chunk);
    rows.forEach((r) => taken.add(r.slug));
  });
  const out = new Map<SourceTitlePlan, string>();
  for (const [plan, list] of candidates) {
    const slug = list.find((s) => !taken.has(s));
    if (!slug) continue;
    taken.add(slug);
    out.set(plan, slug);
  }
  return out;
}

function matchRows(titleId: number, rows: SourceTitlePlan["rows"]): Statement[] {
  return rows.map((r) => ({
    sql: `UPDATE source_items SET match_status = 'matched', title_id = ?, season_number = ?, match_score = 1, match_note = 'source-only'
          WHERE source_id = ? AND vod_id = ? AND match_status = 'unmatched'`,
    params: [titleId, r.season, r.source_id, r.vod_id],
  }));
}

export async function runSourceTitles(ctx: JobContext, opts: { limit?: number; dryRun?: boolean } = {}) {
  const { db, log } = ctx;
  const rows = await readRows(db);
  const groups = [...groupSourceRows(rows).values()];
  log(`${rows.length} unmatched rows in ${groups.length} works`);

  // Pass 1: which works qualify apart from the synopsis; fetch synopses only for those.
  const needSynopsis = groups.filter((g) => {
    const p = planSourceTitle(g.kind, g.rows);
    return "skip" in p && p.skip === "no-synopsis";
  });
  log(`${needSynopsis.length} corroborated works need a synopsis: fetching details`);
  log(`synopses fetched: ${await fillContent(ctx, needSynopsis.flatMap((g) => g.rows))}`);

  // Pass 2: final plans.
  const skips: Record<string, number> = {};
  const plans: SourceTitlePlan[] = [];
  for (const g of groups) {
    const p = planSourceTitle(g.kind, g.rows);
    if ("skip" in p) skips[p.skip] = (skips[p.skip] ?? 0) + 1;
    else plans.push(p);
  }
  log(`plans ${plans.length}, skipped ${JSON.stringify(skips)}`);

  // Names already in the catalog: TMDB titles are left to the resolver (no duplicates);
  // source-built titles of the same kind take the rows (e.g. a new season).
  const existing = await existingByAlias(db, plans.flatMap((p) => p.aliasKeys.map((a) => a.norm)));
  const attach: { titleId: number; plan: SourceTitlePlan }[] = [];
  const fresh: SourceTitlePlan[] = [];
  const claimed = new Set<string>();
  let duplicates = 0;
  for (const p of plans) {
    const hit = p.aliasKeys.map((a) => existing.get(a.norm)).find(Boolean);
    if (hit) {
      if (hit.origin === "source" && hit.kind === p.kind) attach.push({ titleId: hit.id, plan: p });
      else duplicates++;
      continue;
    }
    if (p.aliasKeys.some((a) => claimed.has(a.norm))) continue;
    p.aliasKeys.forEach((a) => claimed.add(a.norm));
    fresh.push(p);
  }
  if (opts.limit) fresh.length = Math.min(fresh.length, opts.limit);
  log(`new titles ${fresh.length}, rows for existing source titles ${attach.length}, left to TMDB matching ${duplicates}`);

  if (opts.dryRun) {
    for (const p of fresh.slice(0, 20)) log(`  ${p.kind} ${p.name} (${p.year}) ${p.rows.length} rows, ${p.genres.join("/")}, ${p.overview!.slice(0, 40)}…`);
    return { created: 0, attached: 0, planned: fresh.length };
  }
  return write(ctx, fresh, attach);
}

async function write(ctx: JobContext, fresh: SourceTitlePlan[], attach: { titleId: number; plan: SourceTitlePlan }[]) {
  const { db, log } = ctx;
  const slugs = await assignSlugs(db, fresh);
  let nextId = ((await db.first<{ n: number }>("SELECT COALESCE(MAX(id), 0) AS n FROM titles"))?.n ?? 0) + 1;
  const created: { id: number; kind: Kind; slug: string; poster: string }[] = [];
  const statements: Statement[][] = [];
  for (const p of fresh) {
    const slug = slugs.get(p);
    if (!slug) continue;
    const id = nextId++;
    created.push({ id, kind: p.kind, slug, poster: p.poster.path });
    statements.push([
      {
        sql: `INSERT INTO titles (id, kind, name, year, tmdb_type, overview, poster_path, genres, countries, languages, cast_json, crew_json,
                latest_label, source_updated_at, origin, indexable, published_at)
              VALUES (?, ?, ?, ?, 'tv', ?, ?, ?, ?, '["zh"]', ?, ?, ?, ?, 'source', 1, datetime('now'))`,
        params: [
          id, p.kind, p.name, p.year, p.overview, p.poster.path, JSON.stringify(p.genres), JSON.stringify(p.countries),
          JSON.stringify(p.cast.map((name) => ({ id: null, name, character: null, profile: null }))),
          JSON.stringify(p.directors.map((name) => ({ id: null, name, job: "导演" }))),
          p.latestLabel, p.sourceUpdatedAt,
        ],
      },
      { sql: "INSERT OR IGNORE INTO source_images (key, url) VALUES (?, ?)", params: [p.poster.key, p.poster.url] },
      { sql: "INSERT INTO slugs (slug, title_id, is_canonical) VALUES (?, ?, 1)", params: [slug, id] },
      ...p.aliasKeys.map((a) => ({ sql: "INSERT OR IGNORE INTO aliases (title_id, norm, alias, lang) VALUES (?, ?, ?, ?)", params: [id, a.norm, a.alias, a.lang] })),
      ...matchRows(id, p.rows),
    ]);
  }
  for (const a of attach) statements.push(matchRows(a.titleId, a.plan.rows));

  let done = 0;
  await chunks(statements, 10, async (chunk) => {
    await db.batch(chunk.flat());
    done += chunk.length;
    if (done % 500 < 10) log(`written ${done}/${statements.length}`);
  });
  log(`created ${created.length} titles, attached rows to ${attach.length} existing ones`);

  if (attach.length) log(`refreshed ${JSON.stringify(await refreshTitles(db, [...new Set(attach.map((a) => a.titleId))]))}`);
  log(`catalog: ${JSON.stringify(await storeCatalogCounts(db))}`);
  if (!ctx.announce) return { created: created.length, attached: attach.length, broken: 0 };

  log(`revalidate: ${await ctx.notifySite({ titleIds: [...new Set(attach.map((a) => a.titleId))], created: created.length > 0, catalog: true })}`);
  log(`indexnow: ${await ctx.submitIndexNow(created.map((c) => titlePath(c.kind, c.slug)))}`);
  // Pull each new poster through our image route once, so it is in R2 before visitors ask.
  // A poster the source host no longer serves would show as a broken image: such titles
  // leave the index (a retry absorbs one-off network errors).
  const broken: number[] = [];
  const queue = [...created];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          const res = await ctx.siteFetch(`/img${c.poster}`).catch(() => null);
          ok = Boolean(res?.ok);
          await res?.arrayBuffer().catch(() => undefined);
        }
        if (!ok) broken.push(c.id);
      }
    }),
  );
  if (broken.length) {
    await chunks(broken, 90, async (ids) => {
      await db.run(`UPDATE titles SET indexable = 0, status_reason = 'source poster unavailable' WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    });
    await ctx.notifySite({ titleIds: broken, created: false, catalog: true });
  }
  log(`posters cached: ${created.length - broken.length}/${created.length}, unavailable (not indexed): ${broken.length}`);
  return { created: created.length, attached: attach.length, broken: broken.length };
}
