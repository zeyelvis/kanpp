import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { PosterGrid } from "@/components/PosterCard";
import { PosterRail } from "@/components/PosterRail";
import { absoluteUrl, site } from "@/lib/config/site";
import { topicData } from "@/lib/data/topics";
import { browseHref, GENRES, REGIONS, yearOptions } from "@/lib/domain/filters";
import { KIND_LABEL, KIND_SEGMENT } from "@/lib/domain/kinds";
import { decodeSlugParam, titlePath } from "@/lib/domain/slug";
import { findTopic, MIN_TOPIC_TITLES, relatedTopics, topicPath, type Topic } from "@/lib/domain/topics";
import { topicDescription, topicIntro, topicTitle } from "@/lib/seo/topic";

// Rendered on first request, then cached; the data behind it refreshes daily.
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

async function load(slugParam: string) {
  const topic = findTopic(decodeSlugParam(slugParam));
  if (!topic) notFound();
  const data = await topicData(topic);
  if (data.count === 0) notFound();
  return { topic, data };
}

export async function generateMetadata({ params }: PageProps<"/topic/[slug]">): Promise<Metadata> {
  const topic = findTopic(decodeSlugParam((await params).slug));
  if (!topic) return {};
  const data = await topicData(topic);
  const path = topicPath(topic);
  return {
    title: topicTitle(topic),
    description: topicDescription(topic, data),
    alternates: { canonical: path },
    robots: data.count >= MIN_TOPIC_TITLES ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { url: path, title: topicTitle(topic) },
  };
}

/** The channel listing with the same filter, where the channel offers it (one value each). */
function channelHref(topic: Topic): string | null {
  const region = topic.regions?.length === 1 ? topic.regions[0] : topic.regions ? undefined : null;
  const genre = topic.genres?.length === 1 ? topic.genres[0] : topic.genres ? undefined : null;
  const year = topic.year != null ? String(topic.year) : null;
  if (region === undefined || genre === undefined) return null;
  if (region && !REGIONS.some((r) => r.value === region)) return null;
  if (genre && !GENRES[topic.kind].includes(genre)) return null;
  if (year && !yearOptions().some((y) => y.value === year)) return null;
  return browseHref(`/${KIND_SEGMENT[topic.kind]}`, { genre, region, year, sort: "hot" }, 1);
}

export default async function TopicPage({ params }: PageProps<"/topic/[slug]">) {
  const { topic, data } = await load((await params).slug);
  const path = topicPath(topic);
  const related = relatedTopics(topic);
  const more = channelHref(topic);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${absoluteUrl(path)}#page`,
        name: topic.name,
        url: absoluteUrl(path),
        description: topicDescription(topic, data),
        isPartOf: { "@type": "WebSite", name: site.name, url: absoluteUrl("/") },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: data.count,
          itemListElement: data.popular.slice(0, 20).map((t, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: absoluteUrl(titlePath(t.kind, t.slug)),
            name: t.name,
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: site.name, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "专题", item: absoluteUrl("/topic") },
          { "@type": "ListItem", position: 3, name: topic.name, item: absoluteUrl(path) },
        ],
      },
    ],
  };

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 pt-4 sm:pt-6">
      <JsonLd data={jsonLd} />
      <header className="space-y-3">
        <Breadcrumbs
          items={[
            { name: "首页", href: "/" },
            { name: "专题", href: "/topic" },
            { name: topic.name, href: path },
          ]}
        />
        <h1 className="text-2xl font-bold sm:text-3xl">{topic.name}</h1>
        <p className="max-w-3xl leading-7 text-ink/85">{topicIntro(topic, data)}</p>
      </header>

      <PosterRail id="recent" title={`近期更新的${topic.name}`} titles={data.recent} eager />

      <section aria-labelledby="popular" className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="popular" className="text-lg font-semibold sm:text-xl">
            热门{topic.name}排行
          </h2>
          {more ? (
            <Link href={more} className="shrink-0 text-sm text-muted hover:text-accent">
              在{KIND_LABEL[topic.kind]}频道看全部 ›
            </Link>
          ) : null}
        </div>
        <PosterGrid titles={data.popular} eagerCount={data.recent.length ? 0 : 6} />
      </section>

      <PosterRail id="top-rated" title={`高分${topic.name}`} titles={data.topRated} />

      {related.length ? (
        <nav aria-labelledby="related-topics" className="space-y-3">
          <h2 id="related-topics" className="text-lg font-semibold sm:text-xl">
            相关专题
          </h2>
          <ul className="flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.name}>
                <Link href={topicPath(r)} className="inline-block rounded-full bg-surface px-3 py-1.5 text-sm ring-1 ring-line hover:ring-accent/60">
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
