import "server-only";
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { d1Db, type D1DatabaseLike } from "./d1";
import type { Db } from "./types";

/** Request-scoped database handle for server components and route handlers. */
export const getDb = cache(async (): Promise<Db> => {
  const { env } = await getCloudflareContext({ async: true });
  const binding = (env as unknown as { DB?: D1DatabaseLike }).DB;
  if (!binding) throw new Error("D1 binding `DB` is missing (check wrangler.jsonc)");
  return d1Db(binding);
});
