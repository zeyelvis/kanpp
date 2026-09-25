import type { Metadata } from "next";
import { site } from "@/lib/config/site";

export const dynamic = "force-static";

const EMAIL = `dmca@${site.domain}`;

export const metadata: Metadata = {
  title: "版权投诉 / Copyright & DMCA",
  description: `${site.name}版权投诉与下架说明：权利人可发送通知至 ${EMAIL}，我们会在收到有效通知后尽快处理。`,
  alternates: { canonical: "/dmca" },
};

export default function DmcaPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 pt-8 leading-7 text-ink/85">
      <h1 className="text-2xl font-bold text-ink">版权投诉 / Copyright &amp; DMCA</h1>

      <section className="mt-6 space-y-3">
        <p>
          {site.name}（{site.domain}）是影视资料与第三方播放线路的索引服务。本站不存储任何视频文件，页面上的播放内容均由第三方服务器提供。
          我们尊重版权，如果你是权利人或其授权代理人，认为本站某个页面侵犯了你的权利，请按以下方式通知我们。
        </p>
        <h2 className="pt-2 text-lg font-semibold text-ink">通知需包含</h2>
        <ol className="list-decimal space-y-1 pl-6">
          <li>被侵权作品的名称及权属说明；</li>
          <li>本站相关页面的完整网址（可列多个）；</li>
          <li>你的姓名或公司名称、联系地址、电话和邮箱；</li>
          <li>一份声明：你善意地相信上述使用未经权利人、其代理人或法律授权；</li>
          <li>一份声明：通知内容准确，且你是权利人或有权代表权利人行事；</li>
          <li>手写或电子签名。</li>
        </ol>
        <p>
          请发送至：
          <a href={`mailto:${EMAIL}`} className="font-medium text-accent">
            {EMAIL}
          </a>
          。收到内容完整的通知后，我们会在 3 个工作日内下架相关页面，并回复处理结果。
        </p>
      </section>

      <section lang="en" className="mt-10 space-y-3 border-t border-line pt-8">
        <h2 className="text-lg font-semibold text-ink">English</h2>
        <p>
          {site.domain} indexes film and TV metadata and links to video streams hosted by third parties. We do not host video files. If you are a
          copyright owner or an authorized agent and believe a page on this site infringes your rights, please send a notice that includes:
        </p>
        <ol className="list-decimal space-y-1 pl-6">
          <li>identification of the copyrighted work;</li>
          <li>the full URL(s) of the page(s) on {site.domain};</li>
          <li>your name or company, postal address, telephone number and email;</li>
          <li>a statement that you have a good-faith belief that the use is not authorized by the owner, its agent, or the law;</li>
          <li>a statement that the information is accurate and that you are the owner or authorized to act on the owner&apos;s behalf;</li>
          <li>a physical or electronic signature.</li>
        </ol>
        <p>
          Send it to{" "}
          <a href={`mailto:${EMAIL}`} className="font-medium text-accent">
            {EMAIL}
          </a>
          . We remove the reported pages within 3 business days of receiving a complete notice and reply with the outcome.
        </p>
      </section>
    </article>
  );
}
