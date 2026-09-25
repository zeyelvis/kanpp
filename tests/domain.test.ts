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

describe("source poster URLs", () => {
  it("map to one-size same-origin paths", async () => {
    const { tmdbImage } = await import("@/lib/images");
    const { parseImagePath } = await import("@/lib/edge/image-proxy");
    expect(tmdbImage("/src/0123456789abcdef0123.jpg", "w342")).toBe("/img/src/0123456789abcdef0123.jpg");
    expect(parseImagePath("/img/src/0123456789abcdef0123.jpg")).toEqual({ size: "src", file: "0123456789abcdef0123.jpg" });
    expect(parseImagePath("/img/src/not-a-key.jpg")).toBeNull();
  });
});

describe("security headers", () => {
  it("are added to every response without overriding what a route set", async () => {
    const { withSecurityHeaders } = await import("@/lib/edge/security-headers");
    const res = withSecurityHeaders(new Response("x", { status: 308, headers: { Location: "/a", "X-Frame-Options": "DENY" } }));
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/a");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(res.headers.get("Strict-Transport-Security")).toMatch(/max-age=\d+/);
  });
});

describe("title fact summary", () => {
  it("states only the facts it has", async () => {
    const { titleFacts } = await import("@/lib/seo/title");
    const base = {
      name: "泰德拉索", year: 2020, kind: "tv", tmdb_type: "tv", countries: ["US"], genres: ["剧情", "喜剧"], crew: [], cast: [{ id: 1, name: "杰森·苏戴奇斯", character: null, profile: null }],
      number_of_seasons: 4, tv_status: "Returning Series", latest_label: "更新至第8集", next_episode_date: null, next_episode_number: null, next_episode_season: null,
      runtime: null, updated_at: "2026-09-25 03:00:00", source_updated_at: "2026-09-25 11:00:00",
    } as never;
    const text = titleFacts(base, [{ sourceId: "modu", adIntro: false }, { sourceId: "wujin", adIntro: true }]);
    expect(text).toBe("《泰德拉索》是2020年美国剧情、喜剧电视剧，杰森·苏戴奇斯主演。共4季，连载中，目前更新至第8集。看片片有2条播放线路，其中1条没有片头广告。资料更新于2026年9月25日。");
    expect(titleFacts({ ...(base as object), latest_label: "第288集" } as never, [])).toContain("已更新到第288集");
    expect(titleFacts({ ...(base as object), latest_label: "20260925期" } as never, [])).toContain("最新一期：20260925期");
    const movie = titleFacts({ ...(base as object), tmdb_type: "movie", kind: "movie", runtime: 95, cast: [], countries: [], genres: [] } as never, []);
    expect(movie).toBe("《泰德拉索》是2020年电影。片长1小时35分钟。资料更新于2026年9月25日。");
  });
});

describe("topics", () => {
  it("have unique names and follow the calendar for years", async () => {
    const { allTopics, findTopic, topicPath } = await import("@/lib/domain/topics");
    const names = allTopics(2026).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(findTopic("2026年电影", 2026)).toMatchObject({ kind: "movie", year: 2026 });
    expect(findTopic("2023年电影", 2026)).toBeUndefined();
    expect(topicPath("韩剧")).toBe("/topic/%E9%9F%A9%E5%89%A7");
  });

  it("link a title to its most specific topics", async () => {
    const { topicsForTitle } = await import("@/lib/domain/topics");
    const names = topicsForTitle({ kind: "tv", countries: ["KR"], genres: ["剧情", "犯罪"], year: 2026 }, 2026).map((t) => t.name);
    expect(names[0]).toBe("2026年韩剧");
    expect(names).toEqual(expect.arrayContaining(["韩剧", "犯罪剧", "2026年电视剧"]));
    expect(names).not.toContain("美剧");
  });

  it("write the intro from the catalog's numbers only", async () => {
    const { topicIntro } = await import("@/lib/seo/topic");
    const card = (name: string, vote_average: number | null = null) => ({ id: 1, kind: "tv", name, year: 2025, poster_path: null, latest_label: null, vote_average, slug: name });
    const text = topicIntro({ name: "韩剧", kind: "tv", regions: ["KR"], group: "region" }, {
      count: 1562, recentCount: 0, popular: [card("甲"), card("乙"), card("丙")], recent: [], topRated: [card("丁", 9.1)],
    } as never);
    expect(text).toBe("看片片收录了1,562部韩剧。最受欢迎的有《甲》《乙》《丙》。评分最高的是《丁》（9.1 分）。每部都能在线观看，可以按集选播，更新进度一目了然。");
  });
});

describe("update timeline", () => {
  const row = (label: string, source_time: string | null, seen_at = "2026-09-25 03:00:00") => ({ label, source_time, seen_at });

  it("keeps only forward moves, newest first", async () => {
    const { updateTimeline } = await import("@/lib/domain/updates");
    const rows = [
      row("全16集", "2026-10-20 20:00:00"),
      row("第15集", "2026-10-14 20:00:00"),
      row("更新至14集", "2026-10-13 20:00:00"),
      row("第13集", "2026-10-13 19:00:00"), // flip back from another source
      row("第14集", "2026-10-13 18:00:00"),
      row("更新至第13集", "2026-10-07 20:00:00"),
      row("第13集", "2026-10-07 19:00:00"), // same episode relabelled below
      row("第12集", null, "2026-10-01 17:00:00"), // UTC 17:00 is 10-02 in Beijing
    ];
    expect(updateTimeline(rows)).toEqual([
      { date: "2026-10-20", text: "全16集", episode: 16 },
      { date: "2026-10-14", text: "更新到第15集", episode: 15 },
      { date: "2026-10-13", text: "更新到第14集", episode: 14 },
      { date: "2026-10-07", text: "更新到第13集", episode: 13 },
      { date: "2026-10-02", text: "更新到第12集", episode: 12 },
    ]);
  });

  it("tracks films by label and stops after a finish", async () => {
    const { updateTimeline } = await import("@/lib/domain/updates");
    expect(updateTimeline([row("TC", "2026-09-20"), row("HD", "2026-09-10"), row("TC", "2026-09-01")]).map((e) => e.text)).toEqual(["更新为「HD」", "更新为「TC」"]);
    expect(updateTimeline([row("第3集", "2026-09-20"), row("完结", "2026-09-10")]).map((e) => e.text)).toEqual(["完结"]);
  });

  it("names the usual weekdays only when the pattern is clear", async () => {
    const { updateCadence } = await import("@/lib/domain/updates");
    const e = (date: string, episode: number) => ({ date, text: "", episode });
    // 2026-10-06 and 10-13 are Tuesdays, 10-07 and 10-14 Wednesdays.
    expect(updateCadence([e("2026-10-14", 5), e("2026-10-13", 4), e("2026-10-07", 3), e("2026-10-06", 2), e("2026-10-01", 1)])).toBe("通常在周二、周三更新");
    expect(updateCadence([e("2026-10-14", 4), e("2026-10-13", 3), e("2026-10-02", 2), e("2026-10-01", 1)])).toBeNull();
    expect(updateCadence([e("2026-10-14", 3), e("2026-10-07", 2), e("2026-10-01", 1)])).toBeNull();
  });
});

describe("markdown negotiation", () => {
  it("serves Markdown only when asked for at least as much as HTML", async () => {
    const { prefersMarkdown } = await import("@/lib/seo/negotiate");
    expect(prefersMarkdown("text/markdown, text/html;q=0.9, */*;q=0.8")).toBe(true);
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false);
    expect(prefersMarkdown("text/html, text/markdown;q=0.5")).toBe(false);
    expect(prefersMarkdown("*/*")).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });
});

describe("API abuse guards", () => {
  it("keys IPv6 clients by their /64", async () => {
    const { clientKey } = await import("@/lib/edge/rate-limit");
    expect(clientKey("203.0.113.9")).toBe("203.0.113.9");
    expect(clientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8::1")).toBe("2001:db8::/64");
    expect(clientKey(null)).toBe("unknown");
  });

  it("counts beacons only from our own pages", async () => {
    const { sentFromOwnPage } = await import("@/lib/edge/rate-limit");
    const req = (headers: Record<string, string>) => new Request("https://kanpp.tv/api/beacon", { method: "POST", headers });
    expect(sentFromOwnPage(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sentFromOwnPage(req({ "sec-fetch-site": "cross-site", origin: "https://kanpp.tv" }))).toBe(false);
    expect(sentFromOwnPage(req({ origin: "https://kanpp.tv" }))).toBe(true);
    expect(sentFromOwnPage(req({ origin: "https://evil.example" }))).toBe(false);
    expect(sentFromOwnPage(req({}))).toBe(false);
  });
});

describe("person page text", () => {
  const credit = (id: number, name: string, year: number | null, extra: Record<string, unknown> = {}) => ({
    id, kind: "tv" as const, name, year, poster_path: null, latest_label: null, vote_average: null, slug: name,
    roles: ["演员"], character: null, vote_count: null, popularity: null, ...extra,
  });
  const person = { id: 1, name: "某演员", profile_path: null, title_count: 4, slug: "某演员", indexable: 1, updated_at: "" };
  const credits = [
    credit(4, "新剧", 2026, { vote_count: 3, popularity: 50 }),
    credit(3, "名作", 2020, { vote_count: 900, vote_average: 8.7, character: "李四" }),
    credit(2, "电影甲", 2020, { kind: "movie", vote_count: 120, vote_average: 7.1, roles: ["导演", "演员"] }),
    credit(1, "旧片", null, { character: "Mike" }),
  ];

  it("picks known-for titles by how widely they were rated", async () => {
    const { knownFor } = await import("@/lib/seo/person");
    expect(knownFor(credits, 2, { 3: 0, 4: 0 }).map((c) => c.name)).toEqual(["名作", "电影甲"]);
  });

  it("prefers lead roles over bit parts in bigger titles", async () => {
    const { knownFor } = await import("@/lib/seo/person");
    const lead = { ...credits[0], vote_count: 200 };
    // Billed 10th in the widely rated one, top billed in the other.
    expect(knownFor([credits[1], lead], 1, { 3: 9, 4: 0 }).map((c) => c.name)).toEqual(["新剧"]);
    expect(knownFor([credits[1], lead], 1, { 3: 0, 4: 0 }).map((c) => c.name)).toEqual(["名作"]);
  });

  it("groups the timeline by year with unknown years last, and notes roles", async () => {
    const { creditsByYear, creditNote } = await import("@/lib/seo/person");
    expect(creditsByYear(credits).map((g) => [g.year, g.credits.length])).toEqual([[2026, 1], [2020, 2], [null, 1]]);
    expect(creditNote(credits[1])).toBe("饰 李四");
    expect(creditNote(credits[2])).toBe("导演");
    expect(creditNote(credits[3])).toBeNull();
    expect(creditNote({ ...credits[1], character: "真武大帝(voice)" })).toBe("配音 真武大帝");
    expect(creditNote({ ...credits[1], character: "小白（配音）" })).toBe("配音 小白");
  });

  it("states only facts from the credits", async () => {
    const { personFacts } = await import("@/lib/seo/person");
    const text = personFacts(person, credits, [{ id: 9, name: "搭档", slug: "搭档", profile_path: null, shared: 3, role: "演员" }], { 3: 0, 4: 0 });
    expect(text).toBe(
      "某演员，演员、导演。看片片收录了某演员参演的4部作品（2020–2026年）：电视剧3部、电影1部。代表作有《名作》《电影甲》《新剧》。评分最高的是《名作》（TMDB 8.7 分）。最近的作品是《新剧》（2026年）。合作最多的是搭档（3部）。",
    );
  });
});

describe("search terms", () => {
  it("stores a normalised term and drops links and noise", async () => {
    const { storedSearchTerm } = await import("@/lib/domain/search-term");
    expect(storedSearchTerm("  繁花  ")).toBe("繁花");
    expect(storedSearchTerm("The  Bear")).toBe("the bear");
    expect(storedSearchTerm("ＳＰＹ×ＦＡＭＩＬＹ")).toBe("spy×family");
    expect(storedSearchTerm("https://evil.example")).toBeNull();
    expect(storedSearchTerm("12345")).toBeNull();
    expect(storedSearchTerm("长".repeat(40))).toHaveLength(30);
  });
});

describe("player skip marks and speed", () => {
  it("validates marks against the episode", async () => {
    const { introMark, outroMark } = await import("@/lib/domain/skip");
    expect(introMark(92.4, 2700)).toBe(92);
    expect(introMark(2, 2700)).toBeNull(); // too early to be an intro
    expect(introMark(900, 2700)).toBeNull(); // past the 10-minute limit
    expect(outroMark(2580, 2700)).toBe(120);
    expect(outroMark(600, 2700)).toBeNull(); // first half: a mis-click
    expect(outroMark(2580, Number.NaN)).toBeNull();
  });

  it("starts at the resume position, else after the intro", async () => {
    const { startPosition } = await import("@/lib/domain/skip");
    const marks = { intro: 90, outro: null };
    expect(startPosition(marks, null, 2700)).toBe(90);
    expect(startPosition(marks, 1200, 2700)).toBe(1200);
    expect(startPosition(marks, 30, 2700)).toBe(90); // resume inside the intro: skip it
    expect(startPosition({ intro: null, outro: null }, 30, 2700)).toBe(30);
    expect(startPosition(marks, null, 100)).toBeNull(); // a short clip: leave it alone
  });

  it("detects the credits and steps the speed", async () => {
    const { inOutro, stepRate } = await import("@/lib/domain/skip");
    expect(inOutro({ intro: null, outro: 120 }, 2585, 2700)).toBe(true);
    expect(inOutro({ intro: null, outro: 120 }, 2500, 2700)).toBe(false);
    expect(inOutro({ intro: null, outro: null }, 2699, 2700)).toBe(false);
    expect(stepRate(1, 1)).toBe(1.25);
    expect(stepRate(2, 1)).toBe(2);
    expect(stepRate(0.75, -1)).toBe(0.75);
  });
});

describe("update reminders", () => {
  it("accepts only real push service endpoints and keys", async () => {
    const { isPushEndpoint, isPushKey } = await import("@/lib/domain/push");
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc:APA91b")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAAA")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGuQ")).toBe(true);
    expect(isPushEndpoint("https://wns2-by3p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushKey("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", 80, 100)).toBe(true);
    expect(isPushKey("not base64!", 5, 100)).toBe(false);
  });

  it("names one title, summarises several", async () => {
    const { updateMessage } = await import("@/lib/domain/push");
    expect(updateMessage([{ name: "繁花", label: "更新至12集", path: "/tv/繁花-2023" }])).toEqual({
      title: "《繁花》更新到第12集", body: "点这里接着看", url: "/tv/繁花-2023", tag: "title:/tv/繁花-2023",
    });
    const many = updateMessage([
      { name: "甲", label: "第3集", path: "/a" }, { name: "乙", label: "全16集", path: "/b" },
      { name: "丙", label: "第9集", path: "/c" }, { name: "丁", label: "第1集", path: "/d" },
    ]);
    expect(many?.title).toBe("你追的 4 部剧更新了");
    expect(many?.body).toBe("《甲》更新到第3集，《乙》全16集，《丙》更新到第9集等");
    expect(many?.url).toBe("/me");
    expect(updateMessage([])).toBeNull();
  });
});
