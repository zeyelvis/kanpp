/**
 * Per-visitor limits for the API, using Workers Rate Limiting bindings (wrangler.jsonc
 * "ratelimits"). Checked in worker.ts before the app runs, so a flood never reaches D1.
 * The first matching prefix applies; pages, images and static files are not limited.
 *
 * Counting is per Cloudflare location and eventually consistent across its machines, so the
 * limits stop floods rather than enforcing exact numbers: measured on 2026-09-25, a 20/min
 * limit started refusing one client only after ~280 requests in two minutes.
 */
const RULES: { prefix: string; binding: string }[] = [
  { prefix: "/api/beacon", binding: "RL_BEACON" }, // player outcome reports: each is a D1 write
  { prefix: "/api/", binding: "RL_API" }, // lines, search suggestions, cards, revalidate
];

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The limit key for a client: the address, or its /64 for IPv6 (one subscriber's block). */
export function clientKey(ip: string | null): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const groups = ip.split("::")[0].split(":");
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** A 429 response when the client is over its limit, otherwise null. */
export async function rateLimited(request: Request, env: Record<string, unknown>): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const rule = RULES.find((r) => path.startsWith(r.prefix));
  const limiter = rule ? (env[rule.binding] as RateLimiter | undefined) : undefined;
  if (!limiter) return null;
  const { success } = await limiter.limit({ key: clientKey(request.headers.get("cf-connecting-ip")) });
  if (success) return null;
  return new Response("Too Many Requests", {
    status: 429,
    headers: { "Retry-After": "60", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/**
 * True for a request sent by one of our own pages: browsers mark it Sec-Fetch-Site:
 * same-origin (older ones at least send our Origin). Scripts posting from elsewhere, or with
 * no browser headers at all, are not counted.
 */
export function sentFromOwnPage(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin != null && origin === new URL(request.url).origin;
}
