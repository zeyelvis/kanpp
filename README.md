# 看片片 · kanpp.tv

海外华人追剧看片站。Next.js 16 + OpenNext，部署在 Cloudflare Workers，片库存在 Cloudflare D1。开发规则见 [AGENTS.md](AGENTS.md)。

## 数据怎么流动

```
CMS 片源 ──> source_items ──> 匹配（豆瓣 ID > 库内别名精确匹配 > TMDB）──> titles ──> 发布门槛 ──> 页面 / sitemap
```

- 网页运行时只读 D1，渲染时从不调用 TMDB 或片源接口。
- 作品 ID 永不复用，slug 永不改指向（数据库触发器强制）。旧 URL 一律单跳 308 到规范地址。
- 满足以下全部条件才会被收录：干净的中文片名、有海报、有简介、至少一条可直接播放的 HLS 线路。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发（读本地 D1：`.wrangler/state`） |
| `npm test` / `npm run typecheck` / `npm run lint` | 测试 / 类型检查 / 代码检查 |
| `npm run ingest -- --db=local --hours=24` | 把最近 24 小时的片源更新写入本地库 |
| `npm run ingest -- --db=remote --hours=5 --backfill=5 --refresh-series=300` | 生产环境的定时入库（与 GitHub Actions 相同） |
| `npm run seo:check -- --base=https://kanpp.tv --sample=200` | 线上 SEO 检查：状态码、canonical、标题唯一、h1、JSON-LD、跳转 |
| `npm run db:migrate:remote` | 执行 D1 表结构迁移 |
| `npm run deploy` | 构建并部署到 Cloudflare |

## 自动化（GitHub Actions）

- `ci.yml`：每次推送都跑 lint、类型检查和测试；推到 main 后执行迁移、部署，并对线上跑 SEO 检查。
- `ingest.yml`：每 4 小时一次，包括增量更新、目录回填、刷新连载剧资料、重算发布状态。
- `seo-watch.yml`：每天巡检线上页面，失败时 GitHub 会发邮件。

启用前需要：
1. 在 GitHub 解决账户付款问题（GitHub 托管的运行器目前拒绝启动）。
2. 在 Cloudflare 创建 API 令牌（使用 "Edit Cloudflare Workers" 模板，再加上 Account → D1 → Edit），然后执行 `gh secret set CLOUDFLARE_API_TOKEN`。
3. 执行 `gh secret set TMDB_API_KEY`。
4. 执行 `gh variable set AUTOMATION_ENABLED --body true`。

在 GitHub Actions 能用之前，可以用 `ops/` 里准备好的本机 launchd 定时任务代替（安装方法写在 plist 文件里）。
