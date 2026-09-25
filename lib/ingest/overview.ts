import { hasAdultSignal } from "@/lib/domain/safety";
import { toSimplified } from "./chinese";

const HAN = /\p{Script=Han}/u;
const LABEL = /^(?:剧情简介|内容简介|剧情介绍|影片简介|节目简介|简介|剧情)\s*[:：]\s*/;
// Source synopses sometimes carry the uploader's promotion instead of a plot.
const PROMO = /https?:|www\.|\.com|\.cn\b|QQ群|微信|公众号|关注我们|加群|网盘|下载地址|磁力|资源站/i;
const MAX = 800;

/** A usable synopsis in simplified Chinese, or null (too short, promotional, off-policy). */
export function cleanSynopsis(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = toSimplified(raw).replace(/\s+/g, " ").trim().replace(LABEL, "").trim();
  if (text.length < 20 || !HAN.test(text) || PROMO.test(text) || hasAdultSignal(text)) return null;
  if (text.length > MAX) {
    // Cut at the last full stop inside the limit rather than mid-sentence.
    const cut = text.slice(0, MAX);
    const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
    text = end > MAX / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, MAX - 1)}…`;
  }
  return text;
}

/** The fullest usable synopsis among the candidates. */
export function bestSynopsis(candidates: (string | null | undefined)[]): string | null {
  return candidates.map(cleanSynopsis).filter((s): s is string => Boolean(s)).sort((a, b) => b.length - a.length)[0] ?? null;
}
