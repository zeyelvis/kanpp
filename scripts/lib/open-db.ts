import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { d1HttpDb } from "@/lib/db/d1-http";
import { sqliteDb } from "@/lib/db/sqlite";
import type { Db } from "@/lib/db/types";

const ROOT = resolve(import.meta.dirname, "../..");

export function loadEnv() {
  const file = join(ROOT, ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}

/** The sqlite file wrangler/miniflare uses for the local D1 (what `next dev` reads). */
export function localD1Path(): string {
  const dir = join(ROOT, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  if (!existsSync(dir)) throw new Error("local D1 not found: run `npm run db:migrate:local` first");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).size - statSync(a).size);
  if (files.length === 0) throw new Error("local D1 sqlite file missing");
  return files[0];
}

function wranglerOAuthToken(): string | null {
  const file = join(homedir(), ".wrangler/config/default.toml");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

export function openDb(target: "local" | "remote"): Db {
  if (target === "local") return sqliteDb(localD1Path());
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.D1_DATABASE_ID;
  // CI passes a scoped API token; locally we reuse wrangler's login.
  const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? wranglerOAuthToken();
  if (!accountId || !databaseId || !apiToken) throw new Error("remote D1 needs CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and an API token");
  return d1HttpDb({ accountId, databaseId, apiToken });
}
