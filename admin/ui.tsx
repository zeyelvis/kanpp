/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";

const CSS = `
:root{color-scheme:dark;--bg:#0b0b0f;--surface:#15151b;--line:#26262f;--ink:#ececf1;--muted:#9b9baa;--faint:#6b6b78;--accent:#f5a524;--ok:#3ecf8e;--bad:#f25f5c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
a{color:inherit}a:hover{color:var(--accent)}
header{position:sticky;top:0;background:#0b0b0fcc;backdrop-filter:blur(8px);border-bottom:1px solid var(--line);z-index:1}
.bar{max-width:1200px;margin:0 auto;padding:10px 16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.brand{font-weight:700}.nav a{margin-right:14px;text-decoration:none;color:var(--muted)}.nav a.on{color:var(--ink);font-weight:600}
.who{margin-left:auto;color:var(--faint);font-size:12px}
main{max-width:1200px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:8px 0 16px}h2{font-size:16px;margin:28px 0 10px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px}
.stat .v{font-size:22px;font-weight:700}.stat .l{color:var(--muted);font-size:12px}.stat .d{color:var(--faint);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}
.ok{color:var(--ok)}.bad{color:var(--bad)}.muted{color:var(--muted)}.faint{color:var(--faint)}
.alerts li{margin:4px 0}.pill{display:inline-block;padding:1px 8px;border-radius:99px;background:var(--line);font-size:12px;margin:2px 4px 2px 0}
.cols{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(360px,1fr))}
`;

const NAV = [
  ["/", "运营概览"],
  ["/seo", "SEO / GEO"],
  ["/titles", "片库管理"],
  ["/home", "首页与榜单"],
  ["/lines", "线路与任务"],
] as const;

// A plain HTML page served by the Worker, not a Next.js page.
export function Layout({ title, path, email, children }: { title: string; path: string; email: string; children: Child }) {
  return (
    <html lang="zh-CN">
      {/* eslint-disable-next-line @next/next/no-head-element -- served by a plain Worker, not Next.js */}
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>{`${title} · 看片片后台`}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header>
          <div class="bar">
            <span class="brand">看片片后台</span>
            <nav class="nav">
              {NAV.map(([href, label]) => (
                <a key={href} href={href} class={path === href || (href !== "/" && path.startsWith(href)) ? "on" : ""}>
                  {label}
                </a>
              ))}
            </nav>
            <span class="who">{email}</span>
          </div>
        </header>
        <main>
          <h1>{title}</h1>
          {children}
        </main>
      </body>
    </html>
  );
}

export function Stat({ label, value, detail }: { label: string; value: Child; detail?: Child }) {
  return (
    <div class="card stat">
      <div class="l">{label}</div>
      <div class="v">{value}</div>
      {detail ? <div class="d">{detail}</div> : null}
    </div>
  );
}

export const n = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-US"));
export const pct = (ok: number, total: number) => (total ? `${((ok / total) * 100).toFixed(1)}%` : "—");

/** "2026-09-28T01:22:00Z" -> "9月28日 09:22"（北京时间） */
export function bj(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
