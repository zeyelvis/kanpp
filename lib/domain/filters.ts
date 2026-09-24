import type { Kind } from "./kinds";

export type Sort = "latest" | "hot" | "rating";

export interface BrowseFilters {
  genre: string | null;
  region: string | null; // ISO code
  year: string | null; // "2026" | "2010s" | "older"
  sort: Sort;
}

export const SORTS: { value: Sort; label: string }[] = [
  { value: "latest", label: "最近更新" },
  { value: "hot", label: "最热" },
  { value: "rating", label: "高分" },
];

export const REGIONS: { value: string; label: string }[] = [
  { value: "CN", label: "大陆" },
  { value: "HK", label: "香港" },
  { value: "TW", label: "台湾" },
  { value: "US", label: "美国" },
  { value: "KR", label: "韩国" },
  { value: "JP", label: "日本" },
  { value: "GB", label: "英国" },
  { value: "TH", label: "泰国" },
];

export const GENRES: Record<Kind, string[]> = {
  movie: ["剧情", "喜剧", "动作", "爱情", "科幻", "悬疑", "惊悚", "恐怖", "犯罪", "动画", "奇幻", "冒险", "战争", "历史", "家庭"],
  tv: ["剧情", "喜剧", "犯罪", "悬疑", "动作冒险", "科幻奇幻", "家庭", "战争政治", "动画"],
  anime: ["动作冒险", "科幻奇幻", "喜剧", "剧情", "悬疑", "家庭", "儿童"],
  variety: ["真人秀", "脱口秀", "喜剧", "家庭"],
  doc: ["纪录", "历史", "犯罪"],
};

export function yearOptions(now = new Date().getUTCFullYear()): { value: string; label: string }[] {
  const years = Array.from({ length: 6 }, (_, i) => String(now - i));
  return [...years.map((y) => ({ value: y, label: y })), { value: "2010s", label: "2010年代" }, { value: "older", label: "更早" }];
}

/** Keeps only values we offer, so arbitrary query strings cannot create new pages. */
export function parseFilters(kind: Kind, q: Record<string, string | string[] | undefined>): BrowseFilters {
  const one = (k: string) => {
    const v = q[k];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
  const genre = one("genre");
  const region = one("region");
  const year = one("year");
  const sort = one("sort");
  return {
    genre: genre && GENRES[kind].includes(genre) ? genre : null,
    region: region && REGIONS.some((r) => r.value === region) ? region : null,
    year: year && yearOptions().some((y) => y.value === year) ? year : null,
    sort: sort === "hot" || sort === "rating" ? sort : "latest",
  };
}

export function isDefaultBrowse(f: BrowseFilters): boolean {
  return !f.genre && !f.region && !f.year && f.sort === "latest";
}

export function browseHref(basePath: string, f: BrowseFilters, page = 1): string {
  const q = new URLSearchParams();
  if (f.genre) q.set("genre", f.genre);
  if (f.region) q.set("region", f.region);
  if (f.year) q.set("year", f.year);
  if (f.sort !== "latest") q.set("sort", f.sort);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}
