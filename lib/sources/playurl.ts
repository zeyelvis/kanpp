export interface Episode {
  name: string;
  url: string;
}

export interface PlayGroup {
  from: string;
  episodes: Episode[];
}

/**
 * Parses 苹果CMS play fields: groups split by "$$$", episodes by "#", "name$url".
 */
export function parsePlayGroups(playFrom: string | null | undefined, playUrl: string | null | undefined): PlayGroup[] {
  if (!playUrl) return [];
  const froms = (playFrom ?? "").split("$$$");
  return playUrl.split("$$$").map((chunk, i) => ({
    from: froms[i] ?? `group${i + 1}`,
    episodes: chunk
      .split("#")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, index) => {
        const sep = part.indexOf("$");
        const name = sep >= 0 ? part.slice(0, sep).trim() : "";
        const url = (sep >= 0 ? part.slice(sep + 1) : part).trim();
        return { name: name || `第${index + 1}集`, url };
      })
      .filter((e) => /^https?:\/\//i.test(e.url)),
  }));
}

/** HLS group our player can play directly (web-player share pages are skipped). */
export function pickHlsEpisodes(playFrom: string | null | undefined, playUrl: string | null | undefined): Episode[] {
  const groups = parsePlayGroups(playFrom, playUrl);
  const hls = groups.filter((g) => g.episodes.length > 0 && g.episodes.every((e) => /\.m3u8(\?|$)/i.test(e.url)));
  if (hls.length === 0) return [];
  // Prefer the group with the most episodes; ties go to the first (the source's default).
  return hls.reduce((best, g) => (g.episodes.length > best.episodes.length ? g : best)).episodes;
}
