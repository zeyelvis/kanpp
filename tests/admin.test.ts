import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sqliteDb } from "@/lib/db/sqlite";

const schema = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`migrations/${f}`, "utf8"))
  .join("\n");

function freshDb() {
  const db = sqliteDb(":memory:");
  db.exec(schema);
  return db;
}

describe("back office access", () => {
  it("refuses everyone until Access is configured, and without a valid token", async () => {
    const { accessUser } = await import("../admin/auth");
    const req = (headers: Record<string, string> = {}) => new Request("https://admin.kanpp.tv/", { headers });
    expect(await accessUser(req(), {})).toEqual({ error: expect.stringContaining("尚未启用") });
    const env = { ACCESS_TEAM_DOMAIN: "kanpp.cloudflareaccess.com", ACCESS_AUD: "aud", ADMIN_EMAILS: "owner@example.com" };
    expect(await accessUser(req(), env)).toEqual({ error: expect.stringContaining("登录") });
    // A token that is not a signed Access token.
    const fake = `${btoa(JSON.stringify({ alg: "none" }))}.${btoa(JSON.stringify({ email: "owner@example.com" }))}.`;
    expect(await accessUser(req({ "cf-access-jwt-assertion": fake }), env)).toEqual({ error: expect.stringContaining("无效") });
  });

  it("sends a 403 with noindex and renders nothing when refused", async () => {
    const { default: app } = await import("../admin/worker");
    const res = await app.request("/", {}, { DB: freshDb() });
    expect(res.status).toBe(403);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
});

describe("back office pages", () => {
  it("render from the catalog database", async () => {
    vi.resetModules();
    vi.doMock("../admin/auth", () => ({ accessUser: async () => ({ email: "owner@example.com" }) }));
    vi.doMock("../lib/db/d1", () => ({ d1Db: (db: unknown) => db }));
    const { default: app } = await import("../admin/worker");
    const db = freshDb();
    await db.run("INSERT INTO titles (kind, name, year, tmdb_type, tmdb_id, indexable) VALUES ('tv', '繁花', 2023, 'tv', 1, 1)");
    await db.run("INSERT INTO sync_state (key, value) VALUES ('job:updates', ?)", [JSON.stringify({ ok: true, job: "updates", startedAt: "2026-09-28T01:35:00Z", ms: 41000, summary: { warmed: "9/9" } })]);
    await db.run("INSERT INTO playback_daily (day, country, source_id, ok, fail, ttff_ms_sum) VALUES (date('now'), 'CN', 'modu', 8, 2, 24000)");
    const overview = await (await app.request("/", {}, { DB: db })).text();
    expect(overview).toContain("看片片后台");
    expect(overview).toContain("可收录作品");
    expect(overview).toContain("updates");
    expect(overview).toContain("魔都");
    expect(overview).toContain("80.0%");
    const seo = await app.request("/seo", {}, { DB: db });
    expect(seo.status).toBe(200);
    expect(seo.headers.get("x-robots-tag")).toContain("noindex");
    expect(await seo.text()).toContain("Google 收录抽查");
    vi.doUnmock("../admin/auth");
    vi.doUnmock("../lib/db/d1");
  });
});
