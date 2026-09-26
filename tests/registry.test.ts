import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { sqliteDb } from "@/lib/db/sqlite";
import { ensureCanonicalSlug } from "@/lib/ingest/titles";
import { upsertSourceRows } from "@/lib/ingest/source-rows";
import { refreshPeople } from "@/lib/ingest/people";
import { refreshTitles } from "@/lib/ingest/publish";
import { Resolver } from "@/lib/ingest/resolve";
import type { TmdbClient } from "@/lib/tmdb/client";

// Every migration, in order: the same schema production has.
const dir = new URL("../migrations/", import.meta.url);
const schema = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

function freshDb() {
  const db = sqliteDb(":memory:");
  db.exec(schema);
  return db;
}

async function insertTitle(db: ReturnType<typeof freshDb>, name: string, year: number, extra: Record<string, unknown> = {}) {
  const res = await db.run(
    "INSERT INTO titles (kind, name, year, tmdb_type, tmdb_id, poster_path, overview) VALUES ('movie', ?, ?, 'movie', ?, ?, ?)",
    [
      name,
      year,
      Math.floor(Math.random() * 1e9),
      "poster_path" in extra ? (extra.poster_path as string | null) : "/p.jpg",
      "overview" in extra ? (extra.overview as string | null) : "这是一段足够长的剧情简介，用来通过发布门槛的最低长度要求。",
    ],
  );
  return res.lastRowId!;
}

describe("registry invariants", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it("never reuses a title id", async () => {
    const a = await insertTitle(db, "甲", 2020);
    const b = await insertTitle(db, "乙", 2021);
    expect(b).toBeGreaterThan(a);
    await expect(db.run("DELETE FROM titles WHERE id = ?", [b])).rejects.toThrow(/never deleted/);
  });

  it("keeps slugs permanent", async () => {
    const id = await insertTitle(db, "布达佩斯大饭店", 2014);
    const slug = await ensureCanonicalSlug(db, id, "布达佩斯大饭店", 2014);
    await expect(db.run("UPDATE slugs SET title_id = 999 WHERE slug = ?", [slug])).rejects.toThrow(/permanent/);
    await expect(db.run("DELETE FROM slugs WHERE slug = ?", [slug])).rejects.toThrow(/permanent/);
  });

  it("gives same-name titles distinct slugs and is idempotent", async () => {
    const a = await insertTitle(db, "小丑", 2019);
    const b = await insertTitle(db, "小丑", 2019);
    const sa = await ensureCanonicalSlug(db, a, "小丑", 2019);
    const sb = await ensureCanonicalSlug(db, b, "小丑", 2019);
    expect(sa).toBe("小丑-2019");
    expect(sb).toBe("小丑-2019-2");
    expect(await ensureCanonicalSlug(db, a, "小丑", 2019)).toBe(sa);
  });

  it("allows one title per TMDB entity", async () => {
    await db.run("INSERT INTO titles (kind, name, tmdb_type, tmdb_id) VALUES ('movie', 'x', 'movie', 1)");
    await expect(db.run("INSERT INTO titles (kind, name, tmdb_type, tmdb_id) VALUES ('movie', 'y', 'movie', 1)")).rejects.toThrow();
  });

  it("re-resolves a source row when its name changes", async () => {
    const id = await insertTitle(db, "布达佩斯大饭店", 2014);
    const item = { vod_id: 7, vod_name: "布达佩斯大饭店", vod_year: "2014", type_name: "剧情片", vod_play_from: "m3u8", vod_play_url: "正片$https://a.com/x/index.m3u8" };
    await upsertSourceRows(db, "feifan", [item]);
    await db.run("UPDATE source_items SET match_status = 'matched', title_id = ? WHERE vod_id = '7'", [id]);

    const same = await upsertSourceRows(db, "feifan", [{ ...item, vod_remarks: "HD" }]);
    expect(same.touchedTitleIds).toEqual([id]);
    expect((await db.first<{ match_status: string }>("SELECT match_status FROM source_items"))!.match_status).toBe("matched");

    await upsertSourceRows(db, "feifan", [{ ...item, vod_name: "完全不同的片" }]);
    const row = await db.first<{ match_status: string; title_id: number | null }>("SELECT match_status, title_id FROM source_items");
    expect(row).toEqual({ match_status: "pending", title_id: null });
  });

  it("gives a title one canonical slug when two workers race", async () => {
    const id = await insertTitle(db, "飞天小女警", 1998);
    const [a, b] = await Promise.all([ensureCanonicalSlug(db, id, "飞天小女警", 1998), ensureCanonicalSlug(db, id, "飞天小女警", 1998)]);
    expect(a).toBe("飞天小女警-1998");
    expect(b).toBe(a);
  });

  it("skips blocked categories at the door", async () => {
    const stats = await upsertSourceRows(db, "feifan", [
      { vod_id: 1, vod_name: "某伦理片", type_name: "伦理片" },
      { vod_id: 2, vod_name: "某解说", type_name: "影视解说" },
      { vod_id: 3, vod_name: "正常电影", type_name: "动作片" },
    ]);
    expect(stats.written).toBe(1);
    expect(stats.skipped["category-blocked"]).toBe(2);
  });

  it("publishes only titles that pass the gate", async () => {
    const good = await insertTitle(db, "布达佩斯大饭店", 2014);
    const noPoster = await insertTitle(db, "无海报", 2014, { poster_path: null });
    const english = await insertTitle(db, "The Bill", 1984);
    for (const [vod, title] of [[1, good], [2, noPoster], [3, english]] as const) {
      await db.run(
        "INSERT INTO source_items (source_id, vod_id, vod_name, match_status, title_id, episode_count, vod_time, remarks) VALUES ('feifan', ?, 'x', 'matched', ?, 1, '2026-09-24 10:00:00', 'HD')",
        [String(vod), title],
      );
    }
    const res = await refreshTitles(db, [good, noPoster, english]);
    expect(res.indexable).toBe(1);
    const rows = await db.all<{ id: number; indexable: number; published_at: string | null; latest_label: string }>("SELECT id, indexable, published_at, latest_label FROM titles ORDER BY id");
    expect(rows.map((r) => r.indexable)).toEqual([1, 0, 0]);
    expect(rows[0].published_at).not.toBeNull();
    expect(rows[0].latest_label).toBe("HD");
    expect(res.changed).toEqual([good]);
  });

  it("reports a published page as changed only when it gets a new episode label", async () => {
    const id = await insertTitle(db, "漫长的季节", 2023);
    await db.run(
      "INSERT INTO source_items (source_id, vod_id, vod_name, match_status, title_id, episode_count, vod_time, remarks) VALUES ('feifan', '1', 'x', 'matched', ?, 1, '2026-09-24 10:00:00', '更新至第1集')",
      [id],
    );
    expect((await refreshTitles(db, [id])).changed).toEqual([id]); // newly published
    expect((await refreshTitles(db, [id])).changed).toEqual([]); // nothing new
    await db.run("UPDATE source_items SET remarks = '更新至第2集', vod_time = '2026-09-25 10:00:00' WHERE title_id = ?", [id]);
    expect((await refreshTitles(db, [id])).changed).toEqual([id]);
  });
});

describe("resolver: trailing number as season", () => {
  // TMDB knows nothing here: only the local registry can match.
  const noTmdb = { search: async () => [], details: async () => Promise.reject(new Error("unused")) } as unknown as TmdbClient;

  async function series(db: ReturnType<typeof freshDb>, name: string, seasons: [number, string][]) {
    const { lastRowId } = await db.run(
      "INSERT INTO titles (kind, name, year, tmdb_type, tmdb_id) VALUES ('tv', ?, ?, 'tv', ?)",
      [name, Number(seasons[0][1].slice(0, 4)), Math.floor(Math.random() * 1e9)],
    );
    await db.run("INSERT INTO aliases (title_id, norm, alias) VALUES (?, ?, ?)", [lastRowId, name, name]);
    for (const [n, date] of seasons) await db.run("INSERT INTO seasons (title_id, season_number, air_date) VALUES (?, ?, ?)", [lastRowId, n, date]);
    return lastRowId!;
  }

  const row = (vod_name: string, vod_year: number) => ({ source_id: "modu", vod_id: "1", vod_name, vod_year, type_name: "大陆剧", douban_id: null, actor: null, director: null, episode_count: null });

  it("reads 乡村爱情18 as season 18 when no work has that exact name", async () => {
    const db = freshDb();
    const id = await series(db, "乡村爱情", [[1, "2006-01-01"], [17, "2025-01-20"], [18, "2026-01-20"]]);
    const out = await new Resolver(db, noTmdb).resolveRow(row("乡村爱情18", 2026));
    expect(out).toMatchObject({ status: "matched", titleId: id, season: 18 });
  });

  it("does not trust a douban id that belongs to another work", async () => {
    const db = freshDb();
    const { lastRowId: film } = await db.run("INSERT INTO titles (kind, name, year, tmdb_type, tmdb_id) VALUES ('movie', '一线希望', 2025, 'movie', 99)");
    await db.run("INSERT INTO aliases (title_id, norm, alias) VALUES (?, '一线希望', '一线希望')", [film]);
    await db.run("INSERT INTO external_ids (provider, external_id, title_id) VALUES ('douban', '123', ?)", [film]);
    const resolver = new Resolver(db, noTmdb);
    const variety = { ...row("女人我最大2020", 2020), type_name: "港台综艺", douban_id: "123", episode_count: 254 };
    expect(await resolver.resolveRow(variety)).toMatchObject({ status: "unmatched" });
    const same = { ...row("一线希望", 2025), type_name: "剧情片", douban_id: "123", episode_count: 1 };
    expect(await resolver.resolveRow(same)).toMatchObject({ status: "matched", titleId: film, note: "douban" });
  });

  it("prefers a work whose name really ends in the number", async () => {
    const db = freshDb();
    await series(db, "中国奇谭", [[1, "2023-01-01"], [2, "2026-01-01"]]);
    const sequel = await series(db, "中国奇谭2", [[1, "2026-01-01"]]);
    const out = await new Resolver(db, noTmdb).resolveRow(row("中国奇谭2", 2026));
    expect(out).toMatchObject({ status: "matched", titleId: sequel });
  });
});

describe("people", () => {
  async function titleWith(db: ReturnType<typeof freshDb>, name: string, cast: { id: number; name: string }[], crew: { id: number; name: string; job: string }[] = []) {
    const { lastRowId } = await db.run(
      "INSERT INTO titles (kind, name, year, tmdb_type, tmdb_id, indexable, cast_json, crew_json) VALUES ('tv', ?, 2020, 'tv', ?, 1, ?, ?)",
      [name, Math.floor(Math.random() * 1e9), JSON.stringify(cast.map((c) => ({ ...c, character: "角色", profile: null }))), JSON.stringify(crew)],
    );
    return lastRowId!;
  }

  it("gives a page to Chinese-named people with three indexable titles, and keeps it stable", async () => {
    const db = freshDb();
    const zhou = { id: 1, name: "周迅" };
    const en = { id: 2, name: "Tom Hanks" };
    const two = { id: 3, name: "张三" };
    const a = await titleWith(db, "甲", [zhou, en, two]);
    await titleWith(db, "乙", [zhou, en, two]);
    await titleWith(db, "丙", [en], [{ id: 1, name: "周迅", job: "导演" }]);

    const first = await refreshPeople(db);
    expect(first.slugged).toBe(1);
    const rows = await db.all<{ id: number; slug: string | null; indexable: number; title_count: number }>("SELECT id, slug, indexable, title_count FROM people ORDER BY id");
    expect(rows).toEqual([
      { id: 1, slug: "周迅", indexable: 1, title_count: 3 },
      { id: 2, slug: null, indexable: 0, title_count: 3 }, // not a Han-script name
      { id: 3, slug: null, indexable: 0, title_count: 2 }, // too few titles
    ]);
    expect((await refreshPeople(db)).changed).toBe(0);

    // A title leaves the index: the page is no longer indexable, but the slug is kept.
    await db.run("UPDATE titles SET indexable = 0 WHERE id = ?", [a]);
    await refreshPeople(db);
    expect(await db.first("SELECT slug, indexable, title_count FROM people WHERE id = 1")).toEqual({ slug: "周迅", indexable: 0, title_count: 2 });
    await expect(db.run("UPDATE people SET slug = 'x' WHERE id = 1")).rejects.toThrow(/permanent/);
  });

  it("disambiguates people who share a name", async () => {
    const db = freshDb();
    for (const n of ["一", "二", "三", "四"]) await titleWith(db, n, [{ id: 10, name: "王伟" }]);
    for (const n of ["五", "六", "七"]) await titleWith(db, n, [{ id: 11, name: "王伟" }]);
    await refreshPeople(db);
    expect(await db.all("SELECT id, slug FROM people ORDER BY id")).toEqual([
      { id: 10, slug: "王伟" },
      { id: 11, slug: "王伟-2" },
    ]);
  });
});
