/**
 * Title normalization for matching. Input is expected to be simplified Chinese already
 * (scripts convert with OpenCC before calling); aliases are stored in both scripts.
 */

// Release/quality/audio annotations that sources glue onto titles. They never change which
// work a row is about. "电影版"/"剧场版" are NOT here: those are different works.
const CJK_NOISE_TAGS = [
  "国粤双语", "国英双语", "国语版", "粤语版", "国语", "粤语", "台配", "日语版", "英语版",
  "日语", "英语", "韩语", "泰语", "普通话", "原声版", "原声", "配音版", "双语",
  "中英双字", "中字", "双语字幕", "字幕版",
  "抢先版", "抢鲜版", "枪版", "高清版", "高清", "蓝光版", "蓝光", "完整版", "未删减版", "无删减版",
  "未删减", "无删减", "导演剪辑版", "加长版", "修复版",
];
// ASCII tags only count as whole tokens: "Cats" must not lose its "ts".
const ASCII_NOISE_TAGS = ["4k", "1080p", "720p", "hd", "bd", "tc", "ts", "hdtc", "hdts", "hdrip", "webrip"];

const BRACKETS = /[【\[(（〈「『][^】\])）〉」』]*[】\])）〉」』]/g;
const SEPARATOR = "[\\s._\\-·:：,，]";

/**
 * Removes release annotations but keeps the title readable (punctuation, case). This is
 * what gets sent to TMDB search. `year` also strips a glued year equal to the row's own.
 */
export function cleanDisplayName(input: string, year?: number | null): string {
  // Zero-width characters (U+200B-U+200D, U+2060, BOM) survive NFKC and hide in source names.
  let s = input.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  s = s.replace(BRACKETS, " ");
  for (const tag of ASCII_NOISE_TAGS) {
    s = s.replace(new RegExp(`(^|${SEPARATOR})${escapeRegExp(tag)}(?=$|${SEPARATOR})`, "gi"), " ");
  }
  s = s.replace(/\s+/g, " ").trim();
  // CJK tags are stripped from the end repeatedly ("战狼2国语中字" -> "战狼2").
  let changed = true;
  while (changed) {
    changed = false;
    for (const tag of CJK_NOISE_TAGS) {
      const next = s.replace(new RegExp(`${SEPARATOR}*${escapeRegExp(tag)}$`), "").trim();
      if (next !== s && next.length > 0) {
        s = next;
        changed = true;
      }
    }
  }
  if (year) {
    const glued = new RegExp(`(?<=\\S)\\s*${year}$`);
    if (s.replace(glued, "").length >= 2) s = s.replace(glued, "").trim();
  }
  return s;
}

export function normalizeKey(input: string): string {
  return cleanDisplayName(input).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * Sources often glue the release year onto new films ("爆发夜2026"). Strip it only when it
 * equals the row's own year, so "请回答1988" (a 2015 show) keeps its digits.
 */
export function stripGluedYear(key: string, year: number | null | undefined): string {
  if (!year) return key;
  const suffix = String(year);
  if (key.length > suffix.length + 1 && key.endsWith(suffix)) return key.slice(0, -suffix.length);
  return key;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split a comma/slash separated people field from a CMS source. */
export function splitPeople(field: string | null | undefined): string[] {
  if (!field) return [];
  return field
    .split(/[,，、/|;；]+/)
    .map((p) => p.normalize("NFKC").trim())
    .filter((p) => p.length > 0 && !["未知", "内详", "暂无", "佚名"].includes(p));
}
