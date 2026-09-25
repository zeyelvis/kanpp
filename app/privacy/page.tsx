import type { Metadata } from "next";
import { site } from "@/lib/config/site";

export const dynamic = "force-static";

const EMAIL = `dmca@${site.domain}`;
const UPDATED = "2026 年 9 月 25 日";

export const metadata: Metadata = {
  title: "隐私政策",
  description: `${site.name}不需要注册、不设置 Cookie、没有第三方统计和广告脚本。这里说明我们会收到哪些数据、如何使用。`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 pt-8 leading-7 text-ink/85">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-ink">隐私政策</h1>
        <p className="text-sm text-muted">更新日期：{UPDATED}</p>
        <p>{site.name}不需要注册，不设置 Cookie，页面上没有第三方统计或广告脚本。下面逐项说明我们会接触到的数据。</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">只保存在你设备上的数据</h2>
        <p>观看记录（看到第几集、第几分钟）和追剧列表保存在你浏览器的本地存储里，不会上传到我们的服务器。清除浏览器的网站数据即可全部删除。</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">我们会收到的数据</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>访问网页时，我们的服务器与网络提供商 Cloudflare 会处理你的 IP 地址、浏览器类型等请求信息，用于提供页面和防护攻击。</li>
          <li>打开「我的」页面时，浏览器会把你追的作品编号发给服务器，以取回最新的更新信息；请求里不包含任何身份信息。</li>
          <li>在搜索框输入时，关键词会发给服务器，用来返回联想结果。</li>
          <li>播放时，播放器会告诉服务器「某条线路能否播放、首帧加载用了多久」。我们只按「日期 × 国家 × 线路」保存汇总次数，用来把各地最稳定的线路排在前面；国家由 Cloudflare 根据 IP 判断，我们不保存 IP 或任何能识别你的信息。</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">第三方</h2>
        <p>页面上的图片由本站提供。视频由第三方服务器直接传给你的浏览器，这些服务器会看到你的 IP 地址，并受其各自政策约束。</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">儿童</h2>
        <p>本站不面向 13 岁以下的儿童，也不会有意收集任何人的个人信息。</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">变更与联系</h2>
        <p>
          本政策如有变更，会更新本页和上方日期。有任何问题，请发邮件至 <span className="select-all font-medium text-ink">{EMAIL}</span>。
        </p>
      </section>
    </article>
  );
}
