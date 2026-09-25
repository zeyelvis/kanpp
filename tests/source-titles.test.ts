import { describe, expect, it } from "vitest";
import { groupSourceRows, planSourceTitle, posterFor, type SourceRow } from "@/lib/ingest/source-titles";

const SYNOPSIS = "少年黑炎天生神力，梦想成为守护家园的武神英雄。随着名为噬徒的怪物不断侵袭，村庄的平静被打破，他和伙伴们一同直面危机。";

function row(over: Partial<SourceRow>): SourceRow {
  return {
    source_id: "modu", vod_id: "1", vod_name: "甲武神", vod_year: 2026, type_name: "国产动漫", area: "大陆",
    pic: "https://img.example/a.jpg", actor: "张三,李四", director: "王五", content: SYNOPSIS, classes: "动作,动画,奇幻",
    remarks: "更新至10集", vod_time: "2026-09-24 10:00:00", episode_count: 10, ...over,
  };
}

function plan(rows: SourceRow[]) {
  const [group] = [...groupSourceRows(rows).values()];
  return planSourceTitle(group.kind, group.rows);
}

describe("source-built titles", () => {
  it("creates a title when two sources agree on name and year", () => {
    const p = plan([row({}), row({ source_id: "ikun", vod_id: "9", content: null, pic: null })]);
    if ("skip" in p) throw new Error(p.skip);
    expect(p).toMatchObject({ kind: "anime", name: "甲武神", year: 2026, overview: SYNOPSIS, countries: ["CN"], cast: ["张三", "李四"], directors: ["王五"] });
    expect(p.genres).toEqual(["动画", "动作冒险", "科幻奇幻"]);
    expect(p.poster.path).toMatch(/^\/src\/[0-9a-f]{20}\.jpg$/);
    expect(p.rows).toHaveLength(2);
  });

  it("needs a second source, a synopsis and a clean name", () => {
    expect(plan([row({})])).toEqual({ skip: "single-source" });
    expect(plan([row({ content: "太短" }), row({ source_id: "ikun", content: null })])).toEqual({ skip: "no-synopsis" });
    expect(plan([row({ source_id: "ikun", vod_year: 2020 }), row({ vod_year: 2024 })])).toEqual({ skip: "single-source" });
  });

  it("keeps seasons of one show together and leaves a same-name work from another era out", () => {
    const p = plan([
      row({ vod_name: "奔跑吧少年", vod_year: 2020, type_name: "大陆综艺" }),
      row({ source_id: "ikun", vod_id: "2", vod_name: "奔跑吧少年", vod_year: 2020, type_name: "大陆综艺" }),
      row({ source_id: "ikun", vod_id: "3", vod_name: "奔跑吧少年第二季", vod_year: 2022, type_name: "大陆综艺" }),
      row({ source_id: "feifan", vod_id: "4", vod_name: "奔跑吧少年", vod_year: 2009, type_name: "大陆综艺" }),
    ]);
    if ("skip" in p) throw new Error(p.skip);
    expect(p.kind).toBe("variety");
    expect(p.year).toBe(2020);
    expect(p.rows.map((r) => [r.vod_id, r.season])).toEqual([["1", 1], ["2", 1], ["3", 2]]);
  });

  it("skips motion comics and simplifies synopses", () => {
    expect(plan([row({ vod_name: "动态漫画·某某" }), row({ source_id: "ikun", vod_name: "动态漫画·某某" })])).toEqual({ skip: "low-quality-format" });
    const p = plan([row({ content: `${SYNOPSIS}三立台湾台首檔節目` }), row({ source_id: "ikun" })]);
    if ("skip" in p) throw new Error(p.skip);
    expect(p.overview).toContain("首档节目");
  });

  it("ignores categories outside Chinese animation and variety", () => {
    expect(groupSourceRows([row({ type_name: "日韩动漫" }), row({ type_name: "国产剧" })]).size).toBe(0);
  });

  it("names poster files by URL hash", () => {
    expect(posterFor("https://x.example/a.PNG?x=1").path).toMatch(/\.png$/);
    expect(posterFor("https://x.example/a").path).toMatch(/\.jpg$/);
  });
});
