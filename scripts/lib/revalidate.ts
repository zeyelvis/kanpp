import { site } from "@/lib/config/site";
import type { Db } from "@/lib/db/types";
import { siteNotifier, titlePaths, type RevalidatePayload } from "@/lib/ingest/notify";
import { submitIndexNow } from "@/lib/seo/indexnow";

/**
 * Tells the live site which cached pages/data are stale after a script run. Skipped when no
 * secret is configured (e.g. local runs against the dev database).
 */
export function notifySite(payload: RevalidatePayload): Promise<string> {
  return siteNotifier({ base: process.env.SITE_URL ?? site.url, secret: process.env.REVALIDATE_SECRET })(payload);
}

/** Submits the canonical URLs of the given titles (plus any other paths) to IndexNow. */
export async function announceTitles(db: Db, titleIds: number[], extraPaths: string[] = []): Promise<string> {
  return submitIndexNow([...extraPaths, ...(await titlePaths(db, titleIds))]);
}
