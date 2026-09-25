import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config/site";

export const dynamic = "force-static";

const EMAIL = `dmca@${site.domain}`;

export const metadata: Metadata = {
  title: "关于看片片",
  description: `${site.name}（${site.domain}）是面向海外华人的影视资料与播放线路索引：每部作品一个页面，汇集简介、分集、更新进度和可用线路。`,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 pt-8 leading-7 text-ink/85">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-ink">关于看片片</h1>
        <p>
          {site.name}（{site.domain}）是面向海外华人的影视资料与播放线路索引，覆盖电影、电视剧、动漫、综艺和纪录片。每部作品只有一个页面，汇集剧情简介、季与分集、更新进度、演职员和可以直接播放的线路。
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">我们怎么做</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>作品资料来自 TMDB；TMDB 没有收录的国产动漫和综艺，只有在至少两个公开片源的片名和年份一致时才会建页。</li>
          <li>播放线路来自第三方公开片源。每条线路都会先核对片名、年份和季数，才会挂到作品上；一条线路播不了时，播放器会自动切换到下一条。</li>
          <li>每 4 小时自动检查一次新集和新片，追剧页面和追剧日历随之更新。</li>
          <li>带片头广告的线路默认排在后面；我们会根据各地观众的实际播放情况，把最稳定的线路排在前面。</li>
          <li>不收录成人内容、影视解说和短剧；片名、海报、简介不完整的作品不公开。</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">我们不做什么</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>不存储、不转码任何视频文件，视频由第三方服务器直接提供。</li>
          <li>不需要注册，不设置 Cookie，没有第三方统计或广告脚本。详见<Link href="/privacy" className="text-accent">隐私政策</Link>。</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">联系我们</h2>
        <p>
          版权投诉请按<Link href="/dmca" className="text-accent">版权投诉页</Link>的说明发送至 <span className="select-all font-medium text-ink">{EMAIL}</span>，其他问题也可以发到这个邮箱。
        </p>
      </section>
    </article>
  );
}
