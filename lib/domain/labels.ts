const COUNTRY_ZH: Record<string, string> = {
  CN: "中国大陆", HK: "中国香港", TW: "中国台湾", MO: "中国澳门", US: "美国", GB: "英国", JP: "日本",
  KR: "韩国", TH: "泰国", FR: "法国", DE: "德国", IN: "印度", ES: "西班牙", IT: "意大利", CA: "加拿大",
  AU: "澳大利亚", SG: "新加坡", MY: "马来西亚", RU: "俄罗斯", BR: "巴西", MX: "墨西哥", SE: "瑞典",
  DK: "丹麦", NO: "挪威", FI: "芬兰", NL: "荷兰", BE: "比利时", IE: "爱尔兰", NZ: "新西兰", PH: "菲律宾",
  ID: "印度尼西亚", VN: "越南", TR: "土耳其", PL: "波兰", AR: "阿根廷", CO: "哥伦比亚", ZA: "南非",
};

export function countryLabel(code: string): string {
  return COUNTRY_ZH[code] ?? code;
}

const TV_STATUS_ZH: Record<string, string> = {
  "Returning Series": "连载中",
  "In Production": "制作中",
  Planned: "筹备中",
  Pilot: "试播",
  Ended: "已完结",
  Canceled: "已停播",
};

export function tvStatusLabel(status: string | null | undefined): string | null {
  return status ? TV_STATUS_ZH[status] ?? null : null;
}

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}小时${m}分钟` : `${h}小时`;
}

/** Episode number a source label says is out: "更新至第30集" / "第30集" / "30集全" -> 30. */
export function latestEpisodeNumber(label: string | null | undefined): number | null {
  const m = label?.match(/(?:更新至|更新到|更新|至)?第?\s*(\d{1,4})\s*集/);
  return m ? Number(m[1]) : null;
}

/** Source labels that say a series is complete: "完结", "全40集", "40集全", "第10集完结". */
export const FINISHED_LABEL = /完结|全集|全\d+集|\d+集全/;

/** How far a series is, from its source label: finished or not, and the episode number. */
export function episodeProgress(label: string | null | undefined): { finished: boolean; episodes: number | null } {
  return { finished: Boolean(label && FINISHED_LABEL.test(label)), episodes: latestEpisodeNumber(label) };
}

export interface SourceLabel {
  remarks: string | null;
  /** The source's update time, Beijing time. */
  vod_time: string | null;
  season_number: number | null;
}

/**
 * What a title's page shows as its progress, from its playable source rows: the furthest one
 * (latest season, then finished, then most episodes), so a line that lags behind never pulls
 * the page back to an older episode; and `since`, when the sources first reached it. `since`
 * only moves when progress does: a source re-uploading an episode it already had (巨量 does
 * this all day) is not an update, for the sitemaps' lastmod, the page's date or the feeds.
 * Films carry no progress: `since` is when the first source had them.
 */
export function sourceProgress(rows: SourceLabel[]): { label: string | null; since: string | null } {
  if (rows.length === 0) return { label: null, since: null };
  const rank = (r: SourceLabel) => {
    const p = episodeProgress(r.remarks);
    return [r.season_number ?? 1, p.finished ? 1 : 0, p.episodes ?? -1];
  };
  const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const best = rows.map(rank).reduce((m, r) => (compare(r, m) > 0 ? r : m));
  const top = rows.filter((r) => compare(rank(r), best) === 0);
  const times = top.map((r) => r.vod_time).filter((v): v is string => Boolean(v)).sort();
  // The most recently updated of the equally advanced rows names it ("更新至第12集" over "第12集").
  const newest = top.reduce((a, b) => ((b.vod_time ?? "") > (a.vod_time ?? "") ? b : a));
  return { label: newest.remarks, since: times[0] ?? null };
}

/** Two labels describe the same progress (same episode count, same finished state). */
export function sameProgress(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = episodeProgress(a);
  const pb = episodeProgress(b);
  return pa.finished === pb.finished && pa.episodes === pb.episodes;
}

/**
 * TMDB's "next episode" lags behind the sources. Show it only if it is still ahead of what
 * the sources already carry and not in the past.
 */
export function isNextEpisodeAhead(
  t: { next_episode_date: string | null; next_episode_number: number | null; latest_label: string | null },
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (!t.next_episode_date || t.next_episode_date < today) return false;
  // Sources already call it finished ("完结", "全40集", "40集全"): nothing is upcoming.
  if (t.latest_label && FINISHED_LABEL.test(t.latest_label)) return false;
  const have = latestEpisodeNumber(t.latest_label);
  return !(have != null && t.next_episode_number != null && t.next_episode_number <= have);
}

/** "2026-10-01" -> "10月1日" */
export function shortDate(date: string | null | undefined): string | null {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : null;
}
