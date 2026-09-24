export interface CmsSource {
  id: string;
  name: string;
  /** 苹果CMS vod endpoint, without query string. */
  api: string;
  /** Lower plays first in the player's line list. */
  priority: number;
}

// Chosen by probing (2026-09-24): all serve HLS, and these carry douban ids on most rows,
// which lets rows from different sources resolve to the same title without name guessing.
// guangsu/jisu/xinlang/hongniu share one backend, so only guangsu is listed.
export const SOURCES: CmsSource[] = [
  { id: "feifan", name: "非凡", api: "https://api.ffzyapi.com/api.php/provide/vod", priority: 1 },
  { id: "liangzi", name: "量子", api: "https://cj.lziapi.com/api.php/provide/vod", priority: 2 },
  { id: "wujin", name: "无尽", api: "https://api.wujinapi.com/api.php/provide/vod", priority: 3 },
  { id: "baofeng", name: "暴风", api: "https://bfzyapi.com/api.php/provide/vod", priority: 4 },
  { id: "modu", name: "魔都", api: "https://www.mdzyapi.com/api.php/provide/vod", priority: 5 },
  { id: "guangsu", name: "光速", api: "https://api.guangsuapi.com/api.php/provide/vod", priority: 6 },
];

export function getSource(id: string): CmsSource | undefined {
  return SOURCES.find((s) => s.id === id);
}
