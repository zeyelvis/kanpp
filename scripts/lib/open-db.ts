import { execFile, execFileSync } from "node:child_process";
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

/** "local" = wrangler dev database, "remote" = production D1, "file:<path>" = a SQLite file (mirror). */
export type DbTarget = "local" | "remote" | `file:${string}`;

export function parseDbTarget(raw: string | undefined): DbTarget {
  if (raw === "remote") return "remote";
  if (raw?.startsWith("file:")) return raw as DbTarget;
  return "local";
}

export function openDb(target: DbTarget): Db {
  if (target === "local") return sqliteDb(localD1Path());
  if (target.startsWith("file:")) return sqliteDb(resolve(ROOT, target.slice(5)));
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.D1_DATABASE_ID;
  if (!accountId || !databaseId) throw new Error("remote D1 needs CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID");
  // CI passes a scoped API token.
  if (process.env.CLOUDFLARE_API_TOKEN) return d1HttpDb({ accountId, databaseId, apiToken: process.env.CLOUDFLARE_API_TOKEN });
  // Locally we reuse wrangler's login. Its OAuth token lives ~1h: refresh it at startup (any
  // authenticated wrangler call does), every 20 minutes, and immediately on a 401.
  const cwd = resolve(import.meta.dirname, "../..");
  const refresh = () => {
    try {
      execFileSync("npx", ["wrangler", "whoami"], { cwd, stdio: "ignore", timeout: 60_000 });
    } catch {
      // Offline or wrangler hiccup: the request retry loop reports the real error.
    }
  };
  refresh();
  if (!wranglerOAuthToken()) throw new Error("no CLOUDFLARE_API_TOKEN and no wrangler login");
  setInterval(() => execFile("npx", ["wrangler", "whoami"], { cwd }, () => undefined), 20 * 60 * 1000).unref();
  return d1HttpDb({ accountId, databaseId, apiToken: () => wranglerOAuthToken() ?? "", refreshToken: refresh });
}
