import { sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Google Search Console API client for scripts on this Mac. Authenticates as a service
 * account whose JSON key is .env.gsc.json in the repo root (git-ignored, never printed, never
 * uploaded). The account is an owner of sc-domain:kanpp.tv.
 */
export const GSC_SITE = "sc-domain:kanpp.tv";
const KEY_FILE = resolve(import.meta.dirname, "../../.env.gsc.json");
const SCOPE = "https://www.googleapis.com/auth/webmasters";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface SearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Inspection {
  verdict?: string;
  coverageState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export class SearchConsole {
  private token: { value: string; until: number } | null = null;
  private readonly key: ServiceAccountKey;

  constructor(keyFile = KEY_FILE) {
    this.key = JSON.parse(readFileSync(keyFile, "utf8")) as ServiceAccountKey;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: this.key.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
    const assertion = `${unsigned}.${b64url(sign("RSA-SHA256", Buffer.from(unsigned), this.key.private_key))}`;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!body.access_token) throw new Error(`Search Console auth failed: HTTP ${res.status} ${body.error ?? ""}`);
    this.token = { value: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private async call<T>(url: string, body: unknown, method = "POST"): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      }).catch((err: unknown) => err as Error);
      if (res instanceof Response && res.ok) return (res.status === 204 ? {} : await res.json().catch(() => ({}))) as T;
      const status = res instanceof Response ? res.status : 0;
      // Quota (429) and server errors: back off and retry a few times.
      if (attempt >= 4 || (status !== 0 && status !== 429 && status < 500)) {
        const detail = res instanceof Response ? (await res.text()).slice(0, 300) : res.message;
        throw new Error(`Search Console ${new URL(url).pathname}: HTTP ${status} ${detail}`);
      }
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }

  /** Every row of a Search Analytics query (pages of 25,000). Final data only, by default. */
  async searchAnalytics(body: { startDate: string; endDate: string; dimensions: string[] }): Promise<SearchRow[]> {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`;
    const rows: SearchRow[] = [];
    for (let startRow = 0; ; startRow += 25_000) {
      const page = await this.call<{ rows?: SearchRow[] }>(url, { ...body, rowLimit: 25_000, startRow });
      rows.push(...(page.rows ?? []));
      if ((page.rows?.length ?? 0) < 25_000) return rows;
    }
  }

  /** Submits (or resubmits) a sitemap: Google then re-reads it soon. */
  async submitSitemap(url: string): Promise<void> {
    await this.call(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/sitemaps/${encodeURIComponent(url)}`, undefined, "PUT");
  }

  /** URL Inspection (2,000 a day per property). Coverage states in English, for stable matching. */
  async inspect(url: string): Promise<Inspection> {
    const body = await this.call<{ inspectionResult?: { indexStatusResult?: Inspection } }>(
      "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
      { inspectionUrl: url, siteUrl: GSC_SITE, languageCode: "en-US" },
    );
    return body.inspectionResult?.indexStatusResult ?? {};
  }
}
