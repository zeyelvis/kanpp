import "server-only";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { d1Db, type D1DatabaseLike } from "./d1";
import type { Db } from "./types";

/** `next build` prerenders ISR pages that have no params (home, schedule, sitemap index). */
export const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

// The build must never read a database: locally that would bake dev data into the deploy,
// and CI has none. Build-time renders get empty data and are dropped before deploy
// (scripts/drop-build-prerenders.mjs), so each page's first real request renders it.
const emptyDb: Db = {
  all: async () => [],
  first: async () => null,
  run: async () => ({ changes: 0, lastRowId: null }),
  batch: async () => [],
};

/** Request-scoped database handle for server components and route handlers. */
export const getDb = cache(async (): Promise<Db> => {
  if (isBuildPhase) return emptyDb;
  const { env } = await getCloudflareContext({ async: true });
  const binding = (env as unknown as { DB?: D1DatabaseLike }).DB;
  if (!binding) throw new Error("D1 binding `DB` is missing (check wrangler.jsonc)");
  return d1Db(binding);
});
