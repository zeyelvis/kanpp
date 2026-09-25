/**
 * Worker entry. Serves same-origin images (/img/...) directly, everything else goes to the
 * OpenNext build of the Next.js app. Kept out of the TypeScript project (tsconfig exclude):
 * it imports the generated build output.
 */
import { serveImage } from "./lib/edge/image-proxy";
import handler from "./.open-next/worker.js";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const worker = {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/img/")) return serveImage(request, env.IMAGES, ctx);
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
