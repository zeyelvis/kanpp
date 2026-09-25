import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { sqliteDb } from "@/lib/db/sqlite";
import { ensureCanonicalSlug } from "@/lib/ingest/titles";
import { upsertSourceRows } from "@/lib/ingest/source-rows";
import { refreshTitles } from "@/lib/ingest/publish";

const schema = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");

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
