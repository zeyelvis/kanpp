/** @jsxImportSource hono/jsx */
/**
 * kanpp-admin: the back office at admin.kanpp.tv. Cloudflare Access lets only the listed
 * addresses in, and every request is checked again here (auth.ts). It reads the catalog database
 * directly and never serves anything to the public site.
 */
import { Hono } from "hono";
import { d1Db, type D1DatabaseLike } from "../lib/db/d1";
import { retryingDb } from "../lib/db/retry";
import { accessUser, type AccessEnv } from "./auth";
import { OverviewPage, SeoPage } from "./pages";
import { Layout } from "./ui";

interface Env extends AccessEnv {
  DB: D1DatabaseLike;
}

type App = { Bindings: Env; Variables: { email: string } };
const app = new Hono<App>();

app.use("*", async (c, next) => {
  const user = await accessUser(c.req.raw, c.env);
  if ("error" in user) return c.text(user.error, 403, { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" });
  c.set("email", user.email);
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("Cache-Control", "no-store");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://kanpp.tv data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
});

const db = (env: Env) => retryingDb(d1Db(env.DB));

app.get("/", async (c) =>
  c.html(
    <Layout title="运营概览" path="/" email={c.get("email")}>
      {await OverviewPage({ db: db(c.env) })}
    </Layout>,
  ),
);

app.get("/seo", async (c) =>
  c.html(
    <Layout title="SEO / GEO" path="/seo" email={c.get("email")}>
      {await SeoPage({ db: db(c.env) })}
    </Layout>,
  ),
);

// Coming in the next phases.
for (const [path, title] of [
  ["/titles", "片库管理"],
  ["/home", "首页与榜单"],
  ["/lines", "线路与任务"],
] as const) {
  app.get(path, (c) =>
    c.html(
      <Layout title={title} path={path} email={c.get("email")}>
        <p class="muted">这一部分正在开发，很快上线。</p>
      </Layout>,
    ),
  );
}

app.notFound((c) => c.text("Not found", 404));

export default app;
