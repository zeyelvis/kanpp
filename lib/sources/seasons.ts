import type { CmsItem } from "./cms";
import { pickHlsGroup, serializeGroup, type Episode } from "./playurl";

const SEASON_PREFIX = /^第\s*(\d{1,3})\s*季\s*/;

/**
 * Some sources (巨量) publish a whole series as one row, naming every episode
 * "第 3 季 第 2 集 标题". The others publish one row per season ("老友记第三季"), which is what
 * matching and the player's per-season lines expect, so such a row is split into one row per
 * season: vod_id "{id}:s{n}" (see baseVodId), name "{name} 第{n}季", the playable group limited
 * to that season's episodes. Season 0 (specials, extras) is dropped: it has no title season to
 * match. A row naming a single season only loses the redundant prefix. Rows whose episodes do
 * not all carry a season are left as they are.
 */
export function splitSeasons(item: CmsItem): CmsItem[] {
  const group = pickHlsGroup(item.vod_play_from, item.vod_play_url);
  if (!group) return [item];
  const bySeason = new Map<number, Episode[]>();
  for (const e of group.episodes) {
    const m = e.name.match(SEASON_PREFIX);
    if (!m) return [item];
    const n = Number(m[1]);
    bySeason.set(n, [...(bySeason.get(n) ?? []), { name: e.name.slice(m[0].length).trim() || e.name, url: e.url }]);
  }
  if (bySeason.size > 1) bySeason.delete(0);
  const seasons = [...bySeason.keys()].sort((a, b) => a - b);
  const withEpisodes = (episodes: Episode[]) => {
    const play = serializeGroup({ from: group.from, episodes });
    return { vod_play_from: play.playFrom, vod_play_url: play.playUrl };
  };
  if (seasons.length === 1) return [{ ...item, ...withEpisodes(bySeason.get(seasons[0])!) }];
  const last = seasons.at(-1);
  return seasons.map((n) => {
    const episodes = bySeason.get(n)!;
    return {
      ...item,
      ...withEpisodes(episodes),
      vod_id: `${item.vod_id}:s${n}`,
      vod_name: `${String(item.vod_name).trim()} 第${n}季`,
      // The row's status ("更新至…", "已完结") describes its latest season; earlier ones are done.
      vod_remarks: n === last ? item.vod_remarks : `全${episodes.length}集`,
    };
  });
}
