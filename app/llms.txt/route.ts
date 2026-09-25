import { absoluteUrl, site } from "@/lib/config/site";
import { KIND_LABEL, KIND_SEGMENT, KINDS } from "@/lib/domain/kinds";

// https://llmstxt.org: a plain map of the site for AI search engines and agents.
const body = `# ${site.name} (${site.domain})

> ${site.description}

${site.name}是影视资料与第三方播放线路的索引。每部作品只有一个规范网址，页面包含简介、年份、类型、地区、评分、演职员、季与分集、最新更新进度和可用的播放线路。本站不存储视频文件；影视资料来自 TMDB。

## 频道

${KINDS.map((k) => `- [${KIND_LABEL[k]}](${absoluteUrl(`/${KIND_SEGMENT[k]}`)}): 最新与热门${KIND_LABEL[k]}，可按类型、地区、年份和排序筛选`).join("\n")}
- [放送表](${absoluteUrl("/schedule")}): 未来一周的剧集更新时间

## 网址规则

- 作品页：\`/{频道}/{简体中文片名}-{年份}\`，例如 \`/tv/某剧-2026\`。旧网址会 308 永久跳转到规范网址。
- 分季页：\`/{频道}/{片名}-{年份}/s{季号}\`
- 播放：就在作品页顶部，季、集和线路写在网址 \`#s=1&ep=3\` 片段里（同一个网址）
- 全部作品列表：[sitemap.xml](${absoluteUrl("/sitemap.xml")})

## 使用

- 搜索引擎与 AI 回答可以引用本站页面，请附上原网址；本站不授权将内容用于模型训练（见 [robots.txt](${absoluteUrl("/robots.txt")}) 中的 Content-Signal）。
- 版权投诉：[${absoluteUrl("/dmca")}](${absoluteUrl("/dmca")})
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
