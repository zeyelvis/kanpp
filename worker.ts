/**
 * Worker entry. Applies the API rate limits, serves same-origin images (/img/...) directly,
 * and hands everything else to the OpenNext build of the Next.js app. Kept out of the TypeScript project (tsconfig exclude):
 * it imports the generated build output.
 */
import { serveImage } from "./lib/edge/image-proxy";
import { rateLimited } from "./lib/edge/rate-limit";
import { withSecurityHeaders } from "./lib/edge/security-headers";
import handler from "./.open-next/worker.js";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const worker = {
  async fetch(request, env, ctx) {
    const limited = await rateLimited(request, env);
    if (limited) return withSecurityHeaders(limited);
    if (new URL(request.url).pathname.startsWith("/img/")) {
      const lookup = async (key) => (await env.DB.prepare("SELECT url FROM source_images WHERE key = ?").bind(key).first("url")) ?? null;
      return withSecurityHeaders(await serveImage(request, env.IMAGES, ctx, lookup));
    }
    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
};

export default worker;
