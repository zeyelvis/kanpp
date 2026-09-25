const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** Parses 1-99 written as arabic or Chinese numerals (十二, 二十, 二十三...). */
export function parseChineseNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "十") return 10;
  const m = raw.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_DIGITS[m[1]] : 1) * 10 + (m[2] ? CN_DIGITS[m[2]] : 0);
  if (raw.length === 1 && raw in CN_DIGITS) return CN_DIGITS[raw];
  return null;
}

const SEASON_PATTERNS: RegExp[] = [
  /\s*第\s*([0-9一二两三四五六七八九十]+)\s*季\s*$/,
  /\s*第\s*([0-9一二两三四五六七八九十]+)\s*季(?=\s|$|[：:（(])/,
  /\s*season\s*(\d{1,2})\s*$/i,
  /\s*s(\d{1,2})\s*$/i,
];

/**
 * Extracts an explicit season marker. A bare trailing digit ("唐人街探案2") is NOT a
 * season: for films it is a sequel, a different work.
 */
export function extractSeason(name: string): { base: string; season: number | null } {
  for (const pattern of SEASON_PATTERNS) {
    const m = name.match(pattern);
    if (!m) continue;
    const season = parseChineseNumber(m[1]);
    if (season == null || season < 1 || season > 99) continue;
    const base = (name.slice(0, m.index) + name.slice((m.index ?? 0) + m[0].length)).trim();
    return { base: base || name, season };
  }
  return { base: name.trim(), season: null };
}

/**
 * A bare trailing number on a series name ("乡村爱情18", "同床异梦 2") that may be its season.
 * Only a fallback reading: callers try the full name first, since series whose name ends in
 * a number are common too.
 */
export function trailingSeason(name: string): { base: string; season: number } | null {
  const m = name.trim().match(/^(.*\p{Script=Han})\s*(\d{1,2})$/u);
  if (!m) return null;
  const season = Number(m[2]);
  return season >= 2 && season <= 30 ? { base: m[1].trim(), season } : null;
}
