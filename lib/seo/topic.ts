import { site } from "@/lib/config/site";
import type { TopicData } from "@/lib/data/topics";
import type { Topic } from "@/lib/domain/topics";

const n = (x: number) => x.toLocaleString("en-US");
const titles = (list: { name: string }[], k: number) => list.slice(0, k).map((t) => `《${t.name}》`).join("");

/** The topic's opening paragraph, built only from the catalog's own numbers and titles. */
export function topicIntro(topic: Topic, data: TopicData): string {
  const parts = [`${site.name}收录了${n(data.count)}部${topic.name}${data.recentCount > 0 ? `，其中${n(data.recentCount)}部近 30 天有更新` : ""}`];
  if (data.popular.length) parts.push(`最受欢迎的有${titles(data.popular, 3)}`);
  const best = data.topRated[0];
  if (best?.vote_average) parts.push(`评分最高的是《${best.name}》（${best.vote_average.toFixed(1)} 分）`);
  parts.push("每部都能在线观看，可以按集选播，更新进度一目了然");
  return `${parts.join("。")}。`;
}

export function topicTitle(topic: Topic): string {
  return `${topic.name}在线观看 - 热门${topic.name}排行`;
}

export function topicDescription(topic: Topic, data: TopicData): string {
  const lead = `${site.name}收录${n(data.count)}部${topic.name}，按热度排行${data.recentCount > 0 ? `，近 30 天更新${n(data.recentCount)}部` : ""}。`;
  return data.popular.length ? `${lead}热门：${titles(data.popular, 4)}等，每部都可在线观看。` : lead;
}
