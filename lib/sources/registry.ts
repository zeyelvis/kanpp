export interface CmsSource {
  id: string;
  name: string;
  /** 苹果CMS vod endpoint, without query string. */
  api: string;
  /** Lower plays first in the player's line list. */
  priority: number;
  /** The source burns a sponsor overlay (gambling ads) into the first seconds of videos. */
  adIntro?: boolean;
  /**
   * Its streams are served to mainland China only (403/404 elsewhere): offered last outside
   * China until playback data there says otherwise (lib/domain/line-rank.ts). Probing from
   * outside China cannot check these for sponsor overlays.
   */
  region?: "CN";
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
// Added 2026-09-27 from the lines ikanbot.com lists (independent backends; APIs moved or were
// misjudged on 2026-09-24): ruyi plays from outside China and liangzi's newest CDN does (no
// overlays in the frames checked); uku (403 with CORS), 1080 (403) and baofeng (404) only
// answered inside China, per ikanbot's Chinese viewers and the user's observation.
// Mirrors skipped: yinghua = wujin, shandian = zuida (same video ids in their stream paths).
export const SOURCES: CmsSource[] = [
  { id: "modu", name: "魔都", api: "https://www.mdzyapi.com/api.php/provide/vod", priority: 1 },
  { id: "ikun", name: "iKun", api: "https://ikunzyapi.com/api.php/provide/vod", priority: 2 },
  { id: "zuida", name: "最大", api: "https://api.zuidapi.com/api.php/provide/vod", priority: 3 },
  { id: "feifan", name: "非凡", api: "https://api.ffzyapi.com/api.php/provide/vod", priority: 4 },
  { id: "wujin", name: "无尽", api: "https://api.wujinapi.com/api.php/provide/vod", priority: 8, adIntro: true },
  { id: "guangsu", name: "光速", api: "https://api.guangsuapi.com/api.php/provide/vod", priority: 9, adIntro: true },
  { id: "ruyi", name: "如意", api: "https://cj.rycjapi.com/api.php/provide/vod", priority: 5 },
  { id: "liangzi", name: "量子", api: "https://cj.lziapi.com/api.php/provide/vod", priority: 6 },
  { id: "juliang", name: "巨量", api: "https://api.juliang.live/api/provide/vod", priority: 10, adIntro: true },
  { id: "uku", name: "U酷", api: "https://api.ukuapi.com/api.php/provide/vod", priority: 11, region: "CN" },
  { id: "zy1080", name: "1080", api: "https://api.1080zyku.com/inc/apijson.php", priority: 12, region: "CN" },
  { id: "baofeng", name: "暴风", api: "https://bfzyapi.com/api.php/provide/vod", priority: 13, region: "CN" },
];

export function getSource(id: string): CmsSource | undefined {
  return SOURCES.find((s) => s.id === id);
}
