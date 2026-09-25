import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";
import { softTagFilter, withFilter } from "@opennextjs/cloudflare/overrides/tag-cache/tag-cache-filter";

// ISR pages and unstable_cache data live in R2, fronted by the per-region Cache API.
// Time-based revalidation runs through a Durable Object queue; revalidateTag timestamps
// live in a dedicated D1 database (never the catalog database).
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "long-lived" }),
  queue: doQueue,
  // We only ever call revalidateTag, never revalidatePath: skip Next's implicit path tags.
  tagCache: withFilter({ tagCache: d1NextTagCache, filterFn: softTagFilter }),
  // Serve cached ISR pages before Next runs. Besides skipping a render setup per hit, this
  // judges staleness by the revalidate stored with each entry: Next itself only knows it for
  // pages generated in the same isolate and assumes 1 second otherwise, so on Workers every
  // on-demand ISR page (all title pages) looked stale and was re-rendered on most requests.
  enableCacheInterception: true,
});
