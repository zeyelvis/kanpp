/** @jsxImportSource hono/jsx */
import type { Db } from "@/lib/db/types";
import { KIND_LABEL, type Kind } from "@/lib/domain/kinds";
import { STATE_LABEL, TYPE_LABEL } from "@/lib/seo/gsc-report";
import { catalogStats, healthReport, jobs, playback, seoState } from "./data";
import { bj, n, pct, Stat } from "./ui";

const SOURCE_LABEL = (key: string) =>
  ({ direct: "直接访问", internal: "站内", other: "其他网站" })[key] ?? key.replace(/^search:/, "搜索·").replace(/^ai:/, "AI·").replace(/^social:/, "社交·");

export async function OverviewPage({ db }: { db: Db }) {
  const [health, catalog, jobList, play] = await Promise.all([healthReport(db), catalogStats(db), jobs(db), playback(db, 7)]);
  const visitors = health && !("error" in health.visitors) ? health.visitors : null;
  const total = catalog.byKind.reduce((s, r) => s + r.n, 0);
  const playTotal = play.lines.reduce((s, l) => s + l.ok + l.fail, 0);
  const playOk = play.lines.reduce((s, l) => s + l.ok, 0);
  return (
    <>
      {health?.alerts.length ? (
        <div class="card">
          <b class="bad">需要处理（{health.alerts.length}）</b>
          <ul class="alerts">
            {health.alerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2>片库</h2>
      <div class="grid">
        <Stat label="可收录作品" value={n(total)} detail={catalog.byKind.map((r) => `${KIND_LABEL[r.kind as Kind] ?? r.kind} ${n(r.n)}`).join(" · ")} />
        <Stat label="影人页" value={n(catalog.people)} />
        <Stat label="24 小时新上线" value={n(catalog.publishedLast24h)} />
        <Stat label="24 小时有新进度" value={n(catalog.updatedLast24h)} detail="新集、完结或新上线" />
      </div>

      <h2>访客（{health ? `截至 ${bj(health.generatedAt)}` : "暂无巡检报告"}）</h2>
      {visitors ? (
        <div class="grid">
          <Stat label="真人打开页面（24 小时）" value={n(visitors.pageViews)} />
          <Stat label="来自搜索引擎" value={n(visitors.fromSearch)} />
          <Stat label="来自 AI 助手" value={n(visitors.fromAi)} />
          <Stat label="进站来源" value={<span style="font-size:13px">{visitors.bySource.map((s) => `${SOURCE_LABEL(s.key)} ${s.n}`).join("，") || "—"}</span>} />
        </div>
      ) : (
        <p class="muted">巡检报告还没有访客数据。</p>
      )}

      <h2>入库任务</h2>
      <table>
        <tr>
          <th>任务</th>
          <th>状态</th>
          <th>上次开始</th>
          <th class="n">耗时</th>
          <th>摘要</th>
        </tr>
        {jobList.map((j) => (
          <tr key={j.job}>
            <td>{j.job}</td>
            <td class={j.ok ? (j.skipped ? "muted" : "ok") : "bad"}>{j.ok ? (j.skipped ? `跳过：${j.skipped}` : "成功") : "失败"}</td>
            <td>{bj(j.startedAt)}</td>
            <td class="n">{Math.round(j.ms / 1000)} 秒</td>
            <td class="faint" style="font-size:12px">
              {j.error
                ? j.error.slice(0, 160)
                : j.summary
                  ? Object.entries(j.summary)
                      .filter(([k]) => ["resolved", "published", "revalidate", "indexnow", "warmed", "hotLists", "refreshedSeries", "reminders"].includes(k))
                      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                      .join(" · ")
                  : ""}
            </td>
          </tr>
        ))}
      </table>

      <h2>
        播放（近 7 天，{n(playTotal)} 次，成功率 {pct(playOk, playTotal)}）
      </h2>
      <div class="cols">
        <table>
          <tr>
            <th>线路</th>
            <th class="n">成功</th>
            <th class="n">失败</th>
            <th class="n">成功率</th>
            <th class="n">首帧</th>
          </tr>
          {play.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.name}
                {l.region ? <span class="pill">仅大陆</span> : null}
              </td>
              <td class="n">{n(l.ok)}</td>
              <td class="n">{n(l.fail)}</td>
              <td class={`n ${l.ok + l.fail >= 10 && l.ok / (l.ok + l.fail) < 0.6 ? "bad" : ""}`}>{pct(l.ok, l.ok + l.fail)}</td>
              <td class="n">{l.avgFirstFrameMs ? `${(l.avgFirstFrameMs / 1000).toFixed(1)} 秒` : "—"}</td>
            </tr>
          ))}
        </table>
        <table>
          <tr>
            <th>访客地区</th>
            <th class="n">播放</th>
            <th class="n">成功率</th>
          </tr>
          {play.countries.slice(0, 15).map((c) => (
            <tr key={c.country}>
              <td>{c.country}</td>
              <td class="n">{n(c.ok + c.fail)}</td>
              <td class="n">{pct(c.ok, c.ok + c.fail)}</td>
            </tr>
          ))}
        </table>
      </div>

      {health ? (
        <>
          <h2>平台</h2>
          <div class="grid">
            <Stat label="24 小时请求" value={n(health.web.requests)} detail={`5xx ${n(health.web.errors5xx)} 次`} />
            <Stat
              label="服务器耗时"
              value={health.platform.worker ? `${health.platform.worker.wallMsP50} ms` : "—"}
              detail={health.platform.worker ? `P90 ${health.platform.worker.wallMsP90 ?? "—"} ms · P99 ${health.platform.worker.wallMsP99} ms` : ""}
            />
            <Stat label="数据库读取" value={n(health.platform.d1.rowsRead)} detail={`写入 ${n(health.platform.d1.rowsWritten)} 行`} />
          </div>
        </>
      ) : null}
    </>
  );
}

export async function SeoPage({ db }: { db: Db }) {
  const [state, health] = await Promise.all([seoState(db), healthReport(db)]);
  const g = state.google;
  const crawlers = health?.web.crawlers.filter((c) => c.requests > 0) ?? [];
  return (
    <>
      <h2>Google 搜索（{g.latestDay ? `截至 ${g.latestDay} 的 7 天` : "数据约晚 2-3 天"}）</h2>
      <div class="grid">
        <Stat label="点击" value={n(g.last7d.clicks)} detail={`前 7 天 ${n(g.previous7d.clicks)}`} />
        <Stat label="展示" value={n(g.last7d.impressions)} detail={`前 7 天 ${n(g.previous7d.impressions)}`} />
        <Stat label="有展示的网页" value={n(g.last7d.pages)} />
      </div>
      <div class="cols" style="margin-top:12px">
        <table>
          <tr>
            <th>热门搜索词</th>
            <th class="n">展示</th>
            <th class="n">点击</th>
            <th class="n">排名</th>
          </tr>
          {g.topQueries.map((q) => (
            <tr key={q.query}>
              <td>{q.query}</td>
              <td class="n">{n(q.impressions)}</td>
              <td class="n">{n(q.clicks)}</td>
              <td class="n">{q.position}</td>
            </tr>
          ))}
        </table>
        <table>
          <tr>
            <th>排名 5-20 名的机会</th>
            <th class="n">展示</th>
            <th class="n">排名</th>
          </tr>
          {g.opportunities.map((q) => (
            <tr key={`${q.query}|${q.page}`}>
              <td>
                {q.query}
                <div class="faint" style="font-size:12px">
                  <a href={`https://kanpp.tv${encodeURI(q.page)}`} target="_blank" rel="noreferrer">
                    {q.page}
                  </a>
                </div>
              </td>
              <td class="n">{n(q.impressions)}</td>
              <td class="n">{q.position}</td>
            </tr>
          ))}
        </table>
      </div>

      <h2>Google 收录抽查（近 30 天）</h2>
      <table>
        <tr>
          <th>页面类型</th>
          <th class="n">抽查</th>
          <th class="n">已收录</th>
          <th>状态分布</th>
        </tr>
        {Object.entries(g.index).map(([type, s]) => (
          <tr key={type}>
            <td>{TYPE_LABEL[type] ?? type}</td>
            <td class="n">{n(s.inspected)}</td>
            <td class="n">{pct(s.indexed, s.inspected)}</td>
            <td>
              {Object.entries(s.states).map(([state, count]) => (
                <span key={state} class="pill">
                  {STATE_LABEL[state] ?? state} {count}
                </span>
              ))}
            </td>
          </tr>
        ))}
      </table>
      {g.canonicalMismatches.length ? (
        <p class="bad">Google 另选了规范网址：{g.canonicalMismatches.map((c) => `${c.path} → ${c.google_canonical}`).join("，")}</p>
      ) : null}

      <h2>Bing 与 IndexNow（ChatGPT 搜索用 Bing 的索引）</h2>
      <div class="grid">
        <Stat label="Bing 已收录" value={n(health?.bing?.inIndex)} detail={`近 7 天抓取 ${n(health?.bing?.crawledPagesLast7d)} 页`} />
        <Stat label="Bing 展示 / 点击（7 天）" value={`${n(health?.bing?.impressionsLast7d)} / ${n(health?.bing?.clicksLast7d)}`} />
        <Stat label="已向 Bing 提交" value={n(state.bingSubmitted)} detail={health?.bing ? `今日配额 ${health.bing.submissionQuota.daily}` : ""} />
        <Stat label="IndexNow 待提交" value={n(state.indexNowQueued)} />
      </div>

      <h2>爬虫与 AI（24 小时）</h2>
      <table>
        <tr>
          <th>爬虫</th>
          <th class="n">请求</th>
          <th class="n">未成功</th>
        </tr>
        {crawlers.map((c) => (
          <tr key={c.label}>
            <td>
              {c.label}
              {c.search ? <span class="pill">搜索</span> : null}
            </td>
            <td class="n">{n(c.requests)}</td>
            <td class={`n ${c.failed ? "bad" : ""}`}>{n(c.failed)}</td>
          </tr>
        ))}
      </table>
      {health && !("error" in health.visitors) ? (
        <p class="muted">
          AI 智能体读取 Markdown / llms.txt：{health.visitors.agentReads.map((r) => `${r.key.replace(/^bot:/, "")} ${r.n}`).join("，") || "暂无"}；来自 AI 助手的访客 {n(health.visitors.fromAi)}。
        </p>
      ) : null}

      <h2>站内搜索没结果（近 7 天，补片清单）</h2>
      {health?.catalog.search.gaps.length ? (
        <table>
          <tr>
            <th>搜索词</th>
            <th class="n">次数</th>
            <th>情况</th>
          </tr>
          {health.catalog.search.gaps.map((gap) => (
            <tr key={gap.term}>
              <td>{gap.term}</td>
              <td class="n">{gap.searches}</td>
              <td class="muted">{gap.finding}</td>
            </tr>
          ))}
        </table>
      ) : (
        <p class="muted">没有。</p>
      )}

      <h2>最常被请求的 404</h2>
      <p class="muted">{health?.web.top404.map((r) => `${decodeURIComponentSafe(r.path)} ×${r.count}`).join("，") || "无"}</p>
      <p class="faint">豆瓣热门榜更新于 {bj(state.hotListsAt)}</p>
    </>
  );
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
