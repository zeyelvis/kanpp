export interface CmsSource {
  id: string;
  name: string;
  /** 苹果CMS vod endpoint, without query string. */
  api: string;
  /** Lower plays first in the player's line list. */
  priority: number;
  /** The source burns a sponsor overlay (gambling ads) into the first seconds of videos. */
  adIntro?: boolean;
}

// Chosen by probing on 2026-09-24 from a Thai exit (see git history for the method):
// reachability, `Access-Control-Allow-Origin` on the m3u8 (hls.js needs it outside Safari),
// and frames at 5s/10s to spot burned-in sponsor overlays.
//   clean + CORS: modu (douban 100%), ikun (douban 100%), zuida (no douban ids), feifan
//   burned-in gambling overlay (~15s): wujin, guangsu (and its mirrors jisu/xinlang/hongniu)
//   unreachable (404): baofeng, liangzi
// Re-probed 2026-09-27 (28 sites from zzzypro.com), also for CORS on a segment and for how
// many of 40 titles we had on one line only each could add:
//   juliang (巨量) 30/40: an aggregator re-serving other sources' streams (dytt, wujin,
//     guangsu/hongniu, maotai, wsy CDNs), so it inherits their burned-in ads; one row per
//     series (split per season on ingest, lib/sources/seasons.ts); 18-digit ids.
//   haohua/hongniu/jisu/subo/xinlang/huya/jinying: guangsu's backend (same 15/40, same size);
//   huya/jinying segments lack CORS. ok/suoni/yaya/niuniu/tianya/wsy/maotai/douban/maoyan 0/40.
//   360, xigua: playlists unreachable; kuaiche: API unreachable.
export const SOURCES: CmsSource[] = [
  { id: "modu", name: "魔都", api: "https://www.mdzyapi.com/api.php/provide/vod", priority: 1 },
  { id: "ikun", name: "iKun", api: "https://ikunzyapi.com/api.php/provide/vod", priority: 2 },
  { id: "zuida", name: "最大", api: "https://api.zuidapi.com/api.php/provide/vod", priority: 3 },
  { id: "feifan", name: "非凡", api: "https://api.ffzyapi.com/api.php/provide/vod", priority: 4 },
  { id: "wujin", name: "无尽", api: "https://api.wujinapi.com/api.php/provide/vod", priority: 8, adIntro: true },
  { id: "guangsu", name: "光速", api: "https://api.guangsuapi.com/api.php/provide/vod", priority: 9, adIntro: true },
  { id: "juliang", name: "巨量", api: "https://api.juliang.live/api/provide/vod", priority: 10, adIntro: true },
];

export function getSource(id: string): CmsSource | undefined {
  return SOURCES.find((s) => s.id === id);
}
