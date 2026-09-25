import { describe, expect, it } from "vitest";
import { scoreMatch, type CandidateSignal, type SourceSignal } from "@/lib/domain/match";
import { cleanDisplayName, normalizeKey, stripGluedYear } from "@/lib/domain/normalize";
import { hasAdultSignal, isPublishableName } from "@/lib/domain/safety";
import { extractSeason, parseChineseNumber, trailingSeason } from "@/lib/domain/season";
import { baseSlug, decodeSlugParam, isOverEncoded, parseWatchState, titlePath, watchPath } from "@/lib/domain/slug";
import { isNextEpisodeAhead, latestEpisodeNumber } from "@/lib/domain/labels";
import { rankLines } from "@/lib/domain/line-rank";
import { classifyCategory } from "@/lib/sources/categories";
import { parsePlayGroups, pickHlsEpisodes, pickHlsGroup, serializeGroup } from "@/lib/sources/playurl";

describe("normalizeKey", () => {
  it("strips release annotations but keeps the title", () => {
    expect(normalizeKey("战狼2 国语中字")).toBe("战狼2");
    expect(normalizeKey("流浪地球【抢先版】")).toBe("流浪地球");
    expect(normalizeKey("沙丘2 HD")).toBe("沙丘2");
    expect(normalizeKey("生化危机：爆发夜")).toBe("生化危机爆发夜");
  });
  it("does not eat ASCII tags inside words", () => {
    expect(normalizeKey("Cats")).toBe("cats");
    expect(normalizeKey("The Bill")).toBe("thebill");
  });
  it("cleans search queries without mangling titles", () => {
    expect(cleanDisplayName("死有对证国语")).toBe("死有对证");
    expect(cleanDisplayName("米奇妙妙车队第2季国语")).toBe("米奇妙妙车队第2季");
    expect(cleanDisplayName("索斯机械兽WILD ZERO日语")).toBe("索斯机械兽WILD ZERO");
    expect(cleanDisplayName("八面埋伏2026", 2026)).toBe("八面埋伏");
    expect(cleanDisplayName("请回答1988", 2015)).toBe("请回答1988");
    expect(cleanDisplayName("2012", 2012)).toBe("2012");
    expect(extractSeason(cleanDisplayName("米奇妙妙车队第2季国语"))).toEqual({ base: "米奇妙妙车队", season: 2 });
  });
  it("keeps digits that are part of the title", () => {
    expect(normalizeKey("请回答1988")).toBe("请回答1988");
    expect(stripGluedYear(normalizeKey("请回答1988"), 2015)).toBe("请回答1988");
    expect(stripGluedYear(normalizeKey("生化危机：爆发夜2026"), 2026)).toBe("生化危机爆发夜");
    expect(stripGluedYear("2012", 2012)).toBe("2012");
  });
});

describe("extractSeason", () => {
  it("reads explicit season markers", () => {
    expect(extractSeason("庆余年第二季")).toEqual({ base: "庆余年", season: 2 });
    expect(extractSeason("龙之家族 第2季")).toEqual({ base: "龙之家族", season: 2 });
    expect(extractSeason("Loki S02")).toEqual({ base: "Loki", season: 2 });
    expect(extractSeason("名侦探柯南 第十二季")).toEqual({ base: "名侦探柯南", season: 12 });
  });
  it("treats a bare trailing number as part of the title (sequels)", () => {
    expect(extractSeason("唐人街探案2")).toEqual({ base: "唐人街探案2", season: null });
    expect(extractSeason("请回答1988")).toEqual({ base: "请回答1988", season: null });
  });
  it("parses Chinese numerals", () => {
    expect(parseChineseNumber("二十三")).toBe(23);
    expect(parseChineseNumber("十")).toBe(10);
    expect(parseChineseNumber("两")).toBe(2);
  });
});

describe("slugs", () => {
  it("builds readable, encoding-safe slugs", () => {
    expect(baseSlug("布达佩斯大饭店", 2014)).toBe("布达佩斯大饭店-2014");
    expect(baseSlug("生化危机：爆发夜", 2026)).toBe("生化危机-爆发夜-2026");
    expect(baseSlug("100%狼", null)).toBe("100-狼");
    expect(baseSlug("Spider-Man: No Way Home", 2021)).toBe("spider-man-no-way-home-2021");
  });
  it("round-trips through the URL", () => {
    const path = titlePath("movie", "布达佩斯大饭店-2014");
    const param = path.split("/")[2];
    expect(decodeSlugParam(param)).toBe("布达佩斯大饭店-2014");
    expect(decodeSlugParam(encodeURIComponent(param))).toBe("布达佩斯大饭店-2014"); // double-encoded
  });
  it("detects over-encoding whether or not the runtime pre-decoded the segment", () => {
    const slug = "布达佩斯大饭店-2014";
    expect(isOverEncoded(slug)).toBe(false); // runtime decoded
    expect(isOverEncoded(encodeURIComponent(slug))).toBe(false); // raw segment
    expect(isOverEncoded(encodeURIComponent(encodeURIComponent(slug)))).toBe(true);
  });
});

describe("content policy", () => {
  it("matches Latin blacklist words as whole words only", () => {
    expect(hasAdultSignal("The Prestige")).toBe(false);
    expect(hasAdultSignal("Episode 1")).toBe(false);
    expect(hasAdultSignal("FBI 2018")).toBe(false);
    expect(hasAdultSignal("SSIS-123 xxx")).toBe(true);
    expect(hasAdultSignal("JAV 合集")).toBe(true);
  });
  it("requires a clean Chinese display name", () => {
    expect(isPublishableName("星球大战")).toBe(true);
    expect(isPublishableName("布达佩斯大饭店")).toBe(true);
    expect(isPublishableName("The Bill")).toBe(false);
    expect(isPublishableName("ど根性物語 銭の踊り")).toBe(false);
    expect(isPublishableName("悪魔からの勲章")).toBe(false);
    expect(isPublishableName("某某电影解说")).toBe(false);
  });
});

describe("categories", () => {
  it("classifies CMS categories", () => {
    expect(classifyCategory("伦理片")).toBeNull();
    expect(classifyCategory("电影解说")).toBeNull();
    expect(classifyCategory("短剧")).toBeNull();
    expect(classifyCategory("动作片")).toEqual({ kind: "movie", tmdbType: "movie" });
    expect(classifyCategory("国产剧")).toEqual({ kind: "tv", tmdbType: "tv" });
    expect(classifyCategory("日本动漫", "名侦探柯南")).toEqual({ kind: "anime", tmdbType: "tv" });
    expect(classifyCategory("日本动漫", "名侦探柯南：剧场版")).toEqual({ kind: "anime", tmdbType: "movie" });
    expect(classifyCategory("奇怪分类")).toBeUndefined();
  });
});

describe("play urls", () => {
  const from = "gsyun$$$gsm3u8";
  const url = "第01集$https://a.com/play/x#第02集$https://a.com/play/y$$$第01集$https://a.com/1/index.m3u8#第02集$https://a.com/2/index.m3u8";
  it("splits groups and episodes", () => {
    const groups = parsePlayGroups(from, url);
    expect(groups).toHaveLength(2);
    expect(groups[1].episodes[1]).toEqual({ name: "第02集", url: "https://a.com/2/index.m3u8" });
  });
  it("only returns directly playable HLS", () => {
    expect(pickHlsEpisodes(from, url).map((e) => e.url)).toEqual(["https://a.com/1/index.m3u8", "https://a.com/2/index.m3u8"]);
    expect(pickHlsEpisodes("gsyun", "正片$https://a.com/play/x")).toEqual([]);
  });
});

describe("scoreMatch", () => {
  const cand = (over: Partial<CandidateSignal> = {}): CandidateSignal => ({
    keys: new Set(["布达佩斯大饭店"]),
    year: 2014,
    seasonYears: new Map(),
    tmdbType: "movie",
    people: ["韦斯·安德森", "拉尔夫·费因斯"],
    ...over,
  });
  const src = (over: Partial<SourceSignal> = {}): SourceSignal => ({
    keys: ["布达佩斯大饭店"],
    season: null,
    year: 2014,
    tmdbType: "movie",
    people: [],
    ...over,
  });

  it("accepts exact name + year", () => {
    expect(scoreMatch(src(), cand()).decision).toBe("same");
  });
  it("never lets a parent title absorb a subtitled sequel", () => {
    const parent = cand({ keys: new Set(["生化危机"]), year: 2002 });
    expect(scoreMatch(src({ keys: ["生化危机爆发夜"], year: 2026 }), parent).decision).toBe("different");
  });
  it("rejects movie vs series", () => {
    expect(scoreMatch(src({ tmdbType: "tv" }), cand()).decision).toBe("different");
  });
  it("rejects same-name remakes far apart in time", () => {
    expect(scoreMatch(src({ year: 1998 }), cand()).decision).toBe("different");
  });
  it("sends an unmarked later-year series row to review, not auto-match", () => {
    const show = cand({ keys: new Set(["某剧"]), year: 2020, tmdbType: "tv", people: [] });
    expect(scoreMatch(src({ keys: ["某剧"], year: 2023, tmdbType: "tv" }), show).decision).toBe("review");
  });
  it("matches a season row against that season's air year", () => {
    const show = cand({ keys: new Set(["龙之家族"]), year: 2022, tmdbType: "tv", seasonYears: new Map([[1, 2022], [2, 2024]]), people: [] });
    expect(scoreMatch(src({ keys: ["龙之家族"], year: 2024, season: 2, tmdbType: "tv" }), show).decision).toBe("same");
    expect(scoreMatch(src({ keys: ["龙之家族"], year: 2026, season: 5, tmdbType: "tv" }), show).decision).toBe("different");
    // TMDB has not added season 3 yet, but the row is newer than season 2.
    expect(scoreMatch(src({ keys: ["龙之家族"], year: 2026, season: 3, tmdbType: "tv" }), show).decision).toBe("same");
  });
  it("lets long-running variety rows carry the current year", () => {
    const show = cand({ keys: new Set(["全民星攻略"]), year: 2019, tmdbType: "tv", people: [] });
    const row = src({ keys: ["全民星攻略"], year: 2020, tmdbType: "tv" });
    expect(scoreMatch(row, show).decision).toBe("review");
    expect(scoreMatch({ ...row, ongoing: true }, show).decision).toBe("same");
  });
  it("ignores foreign casts listed in other scripts", () => {
    const foreign = cand({ people: ["Ralph Fiennes", "Tony Revolori"] });
    expect(scoreMatch(src({ year: 2015, people: ["拉尔夫·费因斯"] }), foreign).decision).toBe("same");
  });
  it("uses people overlap to confirm a match without a year", () => {
    const withPeople = src({ year: null, people: ["韦斯·安德森", "拉尔夫 费因斯"] });
    expect(scoreMatch(withPeople, cand()).decision).toBe("same");
    expect(scoreMatch(src({ year: null }), cand()).decision).toBe("review");
  });
});

describe("next-episode freshness", () => {
  it("parses episode counts out of source labels", () => {
    expect(latestEpisodeNumber("更新至第30集")).toBe(30);
    expect(latestEpisodeNumber("更新第30集")).toBe(30);
    expect(latestEpisodeNumber("30集全")).toBe(30);
    expect(latestEpisodeNumber("HD")).toBeNull();
  });
  it("hides a TMDB next episode the sources already have", () => {
    const base = { next_episode_date: "2026-09-24", next_episode_number: 29, latest_label: "更新第30集" };
    expect(isNextEpisodeAhead(base, "2026-09-24")).toBe(false);
    expect(isNextEpisodeAhead({ ...base, next_episode_number: 31 }, "2026-09-24")).toBe(true);
    expect(isNextEpisodeAhead({ ...base, next_episode_number: 31 }, "2026-09-25")).toBe(false); // in the past
    expect(isNextEpisodeAhead({ ...base, next_episode_number: 1, latest_label: "完结" }, "2026-09-24")).toBe(false);
    expect(isNextEpisodeAhead({ ...base, next_episode_number: 41, latest_label: "40集全" }, "2026-09-24")).toBe(false);
  });
});

describe("stored play data", () => {
  it("round-trips the chosen HLS group", () => {
    const group = pickHlsGroup("web$$$m3u8", "第1集$https://a.com/p/1#第2集$https://a.com/p/2$$$第1集$https://a.com/1.m3u8#第2集$https://a.com/2.m3u8")!;
    const { playFrom, playUrl } = serializeGroup(group);
    expect(playFrom).toBe("m3u8");
    expect(pickHlsEpisodes(playFrom, playUrl)).toEqual(group.episodes);
  });
});

describe("watch URLs", () => {
  it("keep one crawlable URL per title and put the selection in the fragment", () => {
    expect(watchPath("tv", "兰香如故-2026")).toBe("/tv/%E5%85%B0%E9%A6%99%E5%A6%82%E6%95%85-2026#play");
    expect(watchPath("tv", "兰香如故-2026", { season: 1, ep: 3, line: "ikun" })).toBe("/tv/%E5%85%B0%E9%A6%99%E5%A6%82%E6%95%85-2026#s=1&ep=3&line=ikun");
    expect(watchPath("movie", "x-2020", { season: null, ep: null })).toBe("/movie/x-2020#play");
  });
  it("parses fragments and legacy query strings, dropping junk", () => {
    expect(parseWatchState("#s=2&ep=10&line=modu")).toEqual({ season: 2, ep: 10, line: "modu" });
    expect(parseWatchState("?ep=3")).toEqual({ season: null, ep: 3, line: null });
    expect(parseWatchState("#s=0&ep=abc&line=<x>")).toEqual({ season: null, ep: null, line: null });
  });
});

describe("rankLines", () => {
  const lines = [
    { sourceId: "modu", adIntro: false },
    { sourceId: "ikun", adIntro: false },
    { sourceId: "wujin", adIntro: true },
  ];
  const ids = (xs: { sourceId: string }[]) => xs.map((x) => x.sourceId);

  it("keeps registry order without data", () => {
    expect(ids(rankLines(lines, {}, {}))).toEqual(["modu", "ikun", "wujin"]);
  });

  it("puts the line that plays in this country first, and a failing one last", () => {
    const local = { modu: { ok: 5, fail: 45 }, ikun: { ok: 48, fail: 2 } };
    expect(ids(rankLines(lines, local, {}))).toEqual(["ikun", "wujin", "modu"]);
  });

  it("does not reorder on a handful of loads or on noise", () => {
    expect(ids(rankLines(lines, { modu: { ok: 0, fail: 2 } }, {}))).toEqual(["modu", "ikun", "wujin"]);
    const close = { modu: { ok: 900, fail: 100 }, ikun: { ok: 905, fail: 95 } };
    expect(ids(rankLines(lines, close, {}))).toEqual(["modu", "ikun", "wujin"]);
  });

  it("falls back to all countries when the viewer's country has no data", () => {
    const global = { modu: { ok: 10, fail: 190 }, ikun: { ok: 190, fail: 10 } };
    expect(ids(rankLines(lines, {}, global))).toEqual(["ikun", "wujin", "modu"]);
  });

  it("lets a line with sponsor overlays lead only when the clean ones fail", () => {
    const fine = { modu: { ok: 80, fail: 20 }, wujin: { ok: 99, fail: 1 } };
    expect(ids(rankLines(lines, fine, {}))[0]).toBe("modu");
    const broken = { modu: { ok: 10, fail: 90 }, ikun: { ok: 10, fail: 90 }, wujin: { ok: 99, fail: 1 } };
    expect(ids(rankLines(lines, broken, {}))[0]).toBe("wujin");
  });
});

describe("zero-width characters in source names", () => {
  it("are ignored by display names and keys", () => {
    expect(cleanDisplayName("\u200B怪物大师之穿越时空的怪物\u200B")).toBe("怪物大师之穿越时空的怪物");
    expect(normalizeKey("怪物\uFEFF大师")).toBe(normalizeKey("怪物大师"));
  });
});

describe("trailingSeason", () => {
  it("reads a small trailing number after a Chinese name", () => {
    expect(trailingSeason("乡村爱情18")).toEqual({ base: "乡村爱情", season: 18 });
    expect(trailingSeason("同床异梦 2")).toEqual({ base: "同床异梦", season: 2 });
  });
  it("ignores years, 1, and names without Han characters before the number", () => {
    expect(trailingSeason("请回答1988")).toBeNull();
    expect(trailingSeason("某剧1")).toBeNull();
    expect(trailingSeason("Friends 2")).toBeNull();
  });
});

describe("same-origin images", () => {
  it("accepts TMDB sizes and file names only", async () => {
    const { parseImagePath } = await import("@/lib/edge/image-proxy");
    expect(parseImagePath("/img/w342/i6fASFvO3mUceZJvipn4RiLHA44.jpg")).toEqual({ size: "w342", file: "i6fASFvO3mUceZJvipn4RiLHA44.jpg" });
    expect(parseImagePath("/img/w9999/abcdefgh.jpg")).toBeNull();
    expect(parseImagePath("/img/w342/../secret.jpg")).toBeNull();
    expect(parseImagePath("/img/w342/abcdefgh.svg")).toBeNull();
  });
  it("builds page URLs on our own domain", async () => {
    const { tmdbImage } = await import("@/lib/images");
    expect(tmdbImage("/abc123.jpg", "w342")).toBe("/img/w342/abc123.jpg");
    expect(tmdbImage(null, "w342")).toBeNull();
  });
});
