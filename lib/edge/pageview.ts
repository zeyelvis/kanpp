/**
 * First-party page view counting: one Workers Analytics Engine data point (dataset
 * kanpp_pageviews) per page a person opens, with the page type, where they came from (the
 * referring site's host only), country and device. No IP, no cookie, no identifier; no script
 * in the page. AI agents reading the Markdown versions and llms.txt are counted too, since that
 * is how answer engines use the site. Everything else a bot fetches is left to Cloudflare's own
 * traffic analytics (scripts/health.ts).
 */

export type PageGroup =
  | "home" | "channel" | "title" | "season" | "person" | "topic" | "schedule" | "search" | "me" | "info" | "markdown" | "llms" | "other";

const KIND = "(?:movie|tv|anime|variety|documentary)";

/** Page type of a path; null for things that are not pages (assets, images, API, feeds). */
export function pageGroup(pathname: string): PageGroup | null {
  if (/^\/(?:_next|img|api|sitemaps?)\b|^\/sitemap\.xml$|^\/robots\.txt$|^\/manifest\.webmanifest$/.test(pathname)) return null;
  if (pathname === "/llms.txt") return "llms";
  if (pathname.endsWith(".md")) return "markdown";
  if (/\.[a-z0-9]{2,5}$/i.test(pathname)) return null; // icons, key file, sw.js
  if (pathname === "/") return "home";
  if (new RegExp(`^/${KIND}/?$`).test(pathname)) return "channel";
  if (new RegExp(`^/${KIND}/[^/]+/s\\d+/?$`).test(pathname)) return "season";
  if (new RegExp(`^/${KIND}/[^/]+/?$`).test(pathname)) return "title";
  if (/^\/person\/[^/]+\/?$/.test(pathname)) return "person";
  if (/^\/topic(?:\/[^/]+)?\/?$/.test(pathname)) return "topic";
  if (pathname === "/schedule") return "schedule";
  if (pathname === "/search") return "search";
  if (pathname === "/me") return "me";
  if (/^\/(?:about|privacy|terms|dmca)$/.test(pathname)) return "info";
  return "other";
}

// Checked in order: AI assistants before the search engines whose domains they share.
const SOURCES: [RegExp, string][] = [
  [/(^|\.)(chatgpt\.com|chat\.openai\.com)$/, "ai:chatgpt"],
  [/(^|\.)perplexity\.ai$/, "ai:perplexity"],
  [/(^|\.)(copilot\.microsoft\.com|edgeservices\.bing\.com)$/, "ai:copilot"],
  [/(^|\.)gemini\.google\.com$/, "ai:gemini"],
  [/(^|\.)claude\.ai$/, "ai:claude"],
  [/(^|\.)(kimi\.com|kimi\.moonshot\.cn)$/, "ai:kimi"],
  [/(^|\.)doubao\.com$/, "ai:doubao"],
  [/(^|\.)deepseek\.com$/, "ai:deepseek"],
  [/(^|\.)yuanbao\.tencent\.com$/, "ai:yuanbao"],
  [/(^|\.)you\.com$/, "ai:you"],
  [/(^|\.)google\.[a-z.]+$/, "search:google"],
  [/(^|\.)bing\.com$/, "search:bing"],
  [/(^|\.)baidu\.com$/, "search:baidu"],
  [/(^|\.)yandex\.[a-z.]+$/, "search:yandex"],
  [/(^|\.)duckduckgo\.com$/, "search:duckduckgo"],
  [/(^|\.)(sogou\.com|so\.com|sm\.cn|toutiao\.com)$/, "search:china"],
  [/(^|\.)(naver\.com|daum\.net)$/, "search:korea"],
  [/(^|\.)(yahoo\.[a-z.]+|ecosia\.org|brave\.com|qwant\.com)$/, "search:other"],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "social:x"],
  [/(^|\.)(facebook\.com|fb\.com|instagram\.com|threads\.net)$/, "social:meta"],
  [/(^|\.)(reddit\.com)$/, "social:reddit"],
  [/(^|\.)(t\.me|telegram\.org)$/, "social:telegram"],
  [/(^|\.)(weibo\.com|weibo\.cn|zhihu\.com|douban\.com|xiaohongshu\.com|bilibili\.com|tieba\.baidu\.com)$/, "social:china"],
  [/(^|\.)(youtube\.com|line\.me|discord\.com|ptt\.cc|dcard\.tw)$/, "social:other"],
];

/** Where a visit came from: "direct", "internal", "search:google", "ai:chatgpt", ... */
export function referrerClass(referer: string | null, ownHost: string): { cls: string; host: string } {
  if (!referer) return { cls: "direct", host: "" };
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return { cls: "other", host: "" };
  }
  const own = ownHost.replace(/^www\./, "");
  if (host === own || host.endsWith(`.${own}`)) return { cls: "internal", host };
  for (const [pattern, cls] of SOURCES) if (pattern.test(host)) return { cls, host };
  return { cls: "other", host };
}

const BOT_UA = /bot|crawl|kanpp-|spider|slurp|facebookexternalhit|preview|fetch|curl|wget|python|httpx|go-http|java\/|headless|lighthouse|monitor|scrapy|node/i;

/** Name of a known crawler or agent in a user agent ("GPTBot", "ClaudeBot"), else "other". */
function botName(ua: string): string {
  return ua.match(/\b(Googlebot|bingbot|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|Applebot|YandexBot|Baiduspider|Bytespider|Amazonbot|meta-externalagent|CCBot)\b/i)?.[1] ?? "other";
}

export interface PageView {
  group: PageGroup;
  path: string;
  /** "document" (a page load), "rsc" (in-app navigation), "agent" (Markdown/llms.txt fetch). */
  kind: "document" | "rsc" | "agent";
  /** "human", "unknown" (no browser headers, no bot name), or "bot:GPTBot" etc. for agents. */
  visitor: string;
  refClass: string;
  refHost: string;
  device: "mobile" | "tablet" | "desktop";
}

/**
 * The page view a request represents, or null (not a page, a prefetch, a bot fetching HTML).
 * Browsers mark page loads Sec-Fetch-Dest: document; Next marks in-app navigations RSC: 1.
 */
export function pageViewFor(request: Request): PageView | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const h = request.headers;
  const markdownAccept = /text\/markdown/.test(h.get("accept") ?? "");
  let group = pageGroup(url.pathname);
  if (!group) return null;
  if (markdownAccept && (group === "title" || group === "person")) group = "markdown";
  if (h.get("next-router-prefetch") || /prefetch/.test(h.get("sec-purpose") ?? h.get("purpose") ?? "")) return null;

  const ua = h.get("user-agent") ?? "";
  // Agents acting for a user (Claude-User, Perplexity-User) do not all say "bot".
  const bot = BOT_UA.test(ua) || botName(ua) !== "other";
  const agentRead = group === "markdown" || group === "llms";
  let kind: PageView["kind"];
  let visitor: string;
  if (agentRead) {
    kind = "agent";
    visitor = bot ? `bot:${botName(ua)}` : h.get("sec-fetch-dest") === "document" ? "human" : "unknown";
  } else if (h.get("rsc") === "1") {
    kind = "rsc";
    visitor = bot ? "bot" : "human";
  } else if (h.get("sec-fetch-dest") === "document") {
    kind = "document";
    visitor = bot ? "bot" : "human";
  } else {
    kind = "document";
    visitor = bot ? "bot" : "unknown";
  }
  // Bots reading HTML are already in Cloudflare's traffic analytics.
  if (visitor === "bot") return null;

  const ref = kind === "rsc" ? { cls: "internal", host: url.hostname } : referrerClass(h.get("referer"), url.hostname);
  const device = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "desktop";
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path.
  }
  return { group, path: path.slice(0, 120), kind, visitor, refClass: ref.cls, refHost: ref.host.slice(0, 80), device };
}

interface AnalyticsDataset {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

/** Writes the view (blob order is the dataset's schema; keep it stable). */
export function recordPageView(dataset: AnalyticsDataset | undefined, view: PageView, status: number, country: string | undefined) {
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      indexes: [view.group],
      // blob1 group, blob2 path, blob3 kind, blob4 visitor, blob5 referrer class, blob6 referrer
      // host, blob7 country, blob8 device, blob9 status
      blobs: [view.group, view.path, view.kind, view.visitor, view.refClass, view.refHost, country ?? "XX", view.device, String(status)],
      doubles: [1, status],
    });
  } catch {
    // Counting must never affect the response.
  }
}
