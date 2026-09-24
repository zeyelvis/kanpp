import type { Kind } from "@/lib/domain/kinds";

/**
 * Maps a CMS category name to what the row is. `null` means "not a catalog title we
 * carry" (adult, commentary, trailers, sports, news, short dramas).
 */
const BLOCKED = new Set([
  "伦理片", "伦理", "港台三级", "理论片", "福利", "写真",
  "影视解说", "电影解说", "预告片", "预告",
  "体育赛事", "体育", "篮球", "足球", "台球", "斯诺克", "网球", "其他赛事",
  "资讯", "公告", "头条", "新闻资讯", "电影资讯", "娱乐新闻", "演员",
  "短剧", "爽文短剧", "微短剧", "古装仙侠", "现代都市", "穿越年代", "言情总裁", "重生民国",
  "演唱会",
]);

const MOVIE = new Set([
  "电影", "电影片", "动作片", "喜剧片", "爱情片", "科幻片", "剧情片", "恐怖片", "战争片",
  "悬疑片", "犯罪片", "奇幻片", "惊悚片", "冒险片", "灾难片", "邵氏电影", "动画片", "动画电影",
]);

const TV = new Set([
  "电视剧", "连续剧", "国产剧", "大陆剧", "欧美剧", "港澳剧", "香港剧", "港剧", "韩剧", "韩国剧",
  "日剧", "日本剧", "台湾剧", "台剧", "泰剧", "泰国剧", "美国剧", "美剧", "英剧", "海外剧",
]);

const VARIETY = new Set(["综艺", "综艺片", "大陆综艺", "日韩综艺", "港台综艺", "欧美综艺"]);

const ANIME = new Set([
  "动漫", "动漫片", "中国动漫", "国产动漫", "日本动漫", "日韩动漫", "欧美动漫", "港台动漫",
  "海外动漫", "动漫电影",
]);

const DOC = new Set(["纪录片", "记录片"]);

export interface CategoryInfo {
  kind: Kind;
  /** TMDB entity type to search: films vs series. */
  tmdbType: "movie" | "tv";
}

export function classifyCategory(typeName: string | null | undefined, vodName = ""): CategoryInfo | null | undefined {
  const t = (typeName ?? "").trim();
  if (BLOCKED.has(t)) return null;
  if (MOVIE.has(t)) return { kind: "movie", tmdbType: "movie" };
  if (TV.has(t)) return { kind: "tv", tmdbType: "tv" };
  if (VARIETY.has(t)) return { kind: "variety", tmdbType: "tv" };
  if (ANIME.has(t)) {
    const film = t === "动漫电影" || /剧场版|电影版|大电影/.test(vodName);
    return { kind: "anime", tmdbType: film ? "movie" : "tv" };
  }
  if (DOC.has(t)) return { kind: "doc", tmdbType: "tv" };
  return undefined; // unknown category: leave the row pending rather than guessing
}
