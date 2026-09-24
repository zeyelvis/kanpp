/**
 * The only place the brand and domain are defined. Nothing else may hardcode them.
 */
export const site = {
  name: "看片片",
  nameEn: "KanPP",
  domain: "kanpp.tv",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanpp.tv").replace(/\/+$/, ""),
  locale: "zh-CN",
  tagline: "追剧看片，一站就够",
  description:
    "看片片 kanpp.tv：海外华人的追剧看片站。电影、电视剧、动漫、综艺、纪录片在线观看，每部剧的季数、分集和更新进度一目了然。",
} as const;

export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
