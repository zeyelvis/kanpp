import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config/site";

export const dynamic = "force-static";

const UPDATED = "2026 年 9 月 25 日";

export const metadata: Metadata = {
  title: "使用条款",
  description: `使用${site.name}（${site.domain}）前请阅读：服务说明、版权、使用规则与免责声明。`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 pt-8 leading-7 text-ink/85">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-ink">使用条款</h1>
        <p className="text-sm text-muted">更新日期：{UPDATED}</p>
        <p>使用{site.name}即表示你同意以下条款。</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">服务说明</h2>
        <p>{site.name}提供影视资料与第三方播放线路的索引，按现状提供。线路由第三方服务器提供，我们会尽力维护，但不保证任何一条线路持续可用。</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">版权</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>影视作品的版权归各自权利人所有。本站不存储、不转码任何视频文件。</li>
          <li>作品资料（片名、简介、海报、演职员）来自 TMDB，本站使用 TMDB API，但未获 TMDB 认可或认证。</li>
          <li>
            权利人认为本站页面侵犯其权利的，可以按<Link href="/dmca" className="text-accent">版权投诉页</Link>的流程通知我们，收到完整通知后我们会在 3 个工作日内下架相关页面。
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">使用规则</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>本站仅供个人、非商业用途使用。</li>
          <li>禁止大规模抓取本站内容、批量调用接口，或以其他方式干扰本站正常运行。</li>
          <li>请遵守你所在地的法律。</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">免责声明</h2>
        <p>第三方线路的内容由其提供者负责。如果你在线路中遇到不当内容，请通过版权投诉页上的邮箱告诉我们，我们会移除该线路。</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">条款变更</h2>
        <p>条款可能会更新，以本页和上方日期为准。</p>
      </section>
    </article>
  );
}
