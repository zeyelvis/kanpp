/**
 * Sends update reminders from this machine (scheduled runs happen in the ingest Worker; the
 * job is lib/ingest/push-job.ts).
 *
 *   npx tsx scripts/push-updates.ts [--dry-run]
 *
 * Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env.local.
 */
import { parseArgs } from "node:util";
import { site } from "@/lib/config/site";
import { VAPID_PUBLIC_KEY } from "@/lib/domain/push";
import type { JobContext } from "@/lib/ingest/pipeline";
import { runPushUpdates } from "@/lib/ingest/push-job";
import { submitIndexNow } from "@/lib/seo/indexnow";
import { loadEnv, openDb } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

loadEnv();

const { values: args } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function main() {
  const ctx: JobContext = { db: openDb("remote"), log, notifySite, submitIndexNow, siteFetch: (path) => fetch(`${site.url}${path}`), announce: true };
  const ok = process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY === VAPID_PUBLIC_KEY;
  await runPushUpdates(ctx, ok ? { subject: site.url, publicKey: VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY! } : null, { dryRun: args["dry-run"] });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // A reminder run must never fail the ingest job.
    console.error(err);
    process.exit(0);
  });
