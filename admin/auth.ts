/**
 * Who may use the back office. Cloudflare Access (Zero Trust, e-mail one-time codes) guards
 * admin.kanpp.tv; this second check verifies the token Access adds to every request
 * (Cf-Access-Jwt-Assertion, RS256 against the team's published keys) and the address against
 * ADMIN_EMAILS, so a request that reaches the Worker any other way is refused. Until Access is
 * configured (ACCESS_TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAILS) every request is refused.
 */
export interface AccessEnv {
  /** e.g. "kanpp.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience (AUD) tag. */
  ACCESS_AUD?: string;
  /** Comma-separated. */
  ADMIN_EMAILS?: string;
}

type Jwk = JsonWebKey & { kid: string };
let cachedKeys: { team: string; at: number; keys: Jwk[] } | null = null;

async function signingKeys(team: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && cachedKeys?.team === team && Date.now() - cachedKeys.at < 3600_000) return cachedKeys.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Access keys: HTTP ${res.status}`);
  const keys = ((await res.json()) as { keys: Jwk[] }).keys;
  cachedKeys = { team, at: Date.now(), keys };
  return keys;
}

function base64Url(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const json = (part: string) => JSON.parse(new TextDecoder().decode(base64Url(part))) as Record<string, unknown>;

export async function accessUser(req: Request, env: AccessEnv): Promise<{ email: string } | { error: string }> {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  const allowed = (env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!team || !aud || allowed.length === 0) return { error: "后台尚未启用：Cloudflare Access 还没有配置。" };
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token) return { error: "请通过 Cloudflare Access 登录后再访问。" };
  try {
    const [head, body, signature] = token.split(".");
    const header = json(head);
    const claims = json(body);
    if (header.alg !== "RS256") return { error: "登录凭证无效。" };
    let key = (await signingKeys(team)).find((k) => k.kid === header.kid);
    // Access rotates its keys: fetch again once before refusing.
    key ??= (await signingKeys(team, true)).find((k) => k.kid === header.kid);
    if (!key) return { error: "登录凭证无效。" };
    const publicKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64Url(signature), new TextEncoder().encode(`${head}.${body}`));
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const email = String(claims.email ?? "").toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    if (!valid || claims.iss !== `https://${team}` || !audiences.includes(aud) || !(Number(claims.exp) > now)) return { error: "登录凭证无效或已过期。" };
    if (!allowed.includes(email)) return { error: "这个账号没有后台权限。" };
    return { email };
  } catch {
    return { error: "登录凭证无效。" };
  }
}
