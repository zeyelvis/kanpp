import { absoluteUrl, site } from "@/lib/config/site";
import type { Collaborator, PersonCredit, PersonDetail } from "@/lib/data/people";
import { KIND_LABEL, KINDS } from "@/lib/domain/kinds";
import { personPath, titlePath } from "@/lib/domain/slug";

/**
 * Person page text: facts, known-for titles and the year-by-year list, all built only from
 * the credits we hold. Shared by the page and its Markdown version.
 */

const HAN = /\p{Script=Han}/u;

/** "演员", "导演 · 演员": the person's roles, most frequent first. */
export function roleSummary(credits: PersonCredit[]): string[] {
  const counts = new Map<string, number>();
  for (const c of credits) for (const r of c.roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

export function verbOf(credits: PersonCredit[]): string {
  const role = roleSummary(credits)[0];
  return role === "演员" ? "参演" : role === "导演" ? "执导" : "参与";
}

/** "电影和电视剧": the two kinds the person has most titles in. */
export function kindsOf(credits: PersonCredit[]): string {
  return kindCounts(credits)
    .slice(0, 2)
    .map(([k]) => KIND_LABEL[k])
    .join("和");
}

function kindCounts(credits: PersonCredit[]) {
  return KINDS.map((k) => [k, credits.filter((c) => c.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Best-known titles: how widely seen (TMDB rating count and popularity, on a log scale),
 * weighted by the person's billing. A lead role in a local hit beats a bit part in a
 * Hollywood film.
 * `billing` maps title id -> cast position (0 = top billed); titles where the person is not
 * in the billed cast (directing, writing) count as leading.
 */
export function knownFor(credits: PersonCredit[], n: number, billing: Record<number, number> = {}): PersonCredit[] {
  const weight = (c: PersonCredit) => {
    const position = billing[c.id];
    if (position == null) return c.roles.includes("演员") && c.roles.length === 1 ? 0.5 : 1;
    return position < 3 ? 1 : position < 6 ? 0.4 : 0.15;
  };
  // Log scale: Hollywood titles collect ten times the TMDB ratings of Chinese ones, so raw
  // counts would put a cameo there above a lead role at home.
  const score = (c: PersonCredit) => Math.log10(1 + (c.vote_count ?? 0) + (c.popularity ?? 0)) * weight(c);
  return [...credits].sort((a, b) => score(b) - score(a)).slice(0, n);
}

const VOICE = /\s*[(（]\s*(?:voice|配音|声)\s*[)）]\s*$/i;

/**
 * "饰 张三" for a Chinese character name ("配音 张三" for a voice role, which TMDB marks
 * "(voice)"), otherwise the non-acting roles ("导演 · 编剧").
 */
export function creditNote(c: PersonCredit): string | null {
  if (c.character && HAN.test(c.character)) {
    const name = c.character.replace(VOICE, "").trim();
    return VOICE.test(c.character) ? `配音 ${name}` : `饰 ${name}`;
  }
  return c.roles.filter((r) => r !== "演员").join(" · ") || null;
}

/** Credits grouped by year, newest first; titles without a year come last. */
export function creditsByYear(credits: PersonCredit[]): { year: number | null; credits: PersonCredit[] }[] {
  const groups = new Map<number | null, PersonCredit[]>();
  for (const c of credits) groups.set(c.year ?? null, [...(groups.get(c.year ?? null) ?? []), c]);
  return [...groups.entries()]
    .sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1))
    .map(([year, list]) => ({ year, credits: list }));
}

export function personTitle(person: PersonDetail, credits: PersonCredit[]): string {
  return `${person.name}${verbOf(credits)}的${kindsOf(credits)}（${credits.length}部）`;
}

export function describePerson(person: PersonDetail, credits: PersonCredit[], billing: Record<number, number> = {}): string {
  const top = knownFor(credits, 3, billing).map((c) => `《${c.name}》`).join("");
  return `${person.name}${verbOf(credits)}的${credits.length}部${kindsOf(credits)}，代表作${top}等。在${site.name}查看每部作品的简介、分集更新并在线观看。`;
}

/** The page's fact summary: short sentences from the credits only, easy to quote. */
export function personFacts(person: PersonDetail, credits: PersonCredit[], collaborators: Collaborator[], billing: Record<number, number> = {}): string {
  const roles = roleSummary(credits);
  const years = credits.map((c) => c.year).filter((y): y is number => y != null);
  const span = years.length ? `（${Math.min(...years)}–${Math.max(...years)}年）` : "";
  const sentences = [
    `${person.name}，${roles.join("、")}`,
    `${site.name}收录了${person.name}${verbOf(credits)}的${credits.length}部作品${span}：${kindCounts(credits).map(([k, n]) => `${KIND_LABEL[k]}${n}部`).join("、")}`,
  ];
  const known = knownFor(credits, 3, billing);
  if (known.length) sentences.push(`代表作有${known.map((c) => `《${c.name}》`).join("")}`);
  const rated = credits.filter((c) => c.vote_average && (c.vote_count ?? 0) >= 50).sort((a, b) => b.vote_average! - a.vote_average!)[0];
  if (rated) sentences.push(`评分最高的是《${rated.name}》（TMDB ${rated.vote_average!.toFixed(1)} 分）`);
  const latest = credits.find((c) => c.year != null);
  if (latest && latest.year === Math.max(...years)) sentences.push(`最近的作品是《${latest.name}》（${latest.year}年）`);
  if (collaborators.length) {
    sentences.push(`合作最多的是${collaborators.slice(0, 3).map((c) => `${c.name}（${c.shared}部）`).join("、")}`);
  }
  return `${sentences.join("。")}。`;
}

const inline = (text: string) => text.replace(/\s+/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1").trim();
const link = (text: string, path: string) => `[${inline(text)}](${absoluteUrl(path)})`;

export function personMarkdown(person: PersonDetail, credits: PersonCredit[], collaborators: Collaborator[], billing: Record<number, number> = {}): string {
  const url = absoluteUrl(personPath(person.slug));
  const out = [`# ${inline(person.name)}`, "", personFacts(person, credits, collaborators, billing), "", `- 页面：${url}`, ""];
  const known = knownFor(credits, 8, billing);
  if (known.length) {
    out.push("## 代表作", "", ...known.map((c) => `- ${link(`${c.name}${c.year ? `（${c.year}）` : ""}`, titlePath(c.kind, c.slug))}`), "");
  }
  out.push("## 作品年表", "");
  for (const g of creditsByYear(credits)) {
    out.push(`### ${g.year ?? "年份未知"}`, "");
    for (const c of g.credits) {
      const note = creditNote(c);
      out.push(`- ${link(c.name, titlePath(c.kind, c.slug))} · ${KIND_LABEL[c.kind]}${note ? ` · ${inline(note)}` : ""}`);
    }
    out.push("");
  }
  if (collaborators.length) {
    out.push("## 常合作的影人", "", ...collaborators.map((c) => `- ${link(c.name, personPath(c.slug))}：${c.role}，合作 ${c.shared} 部`), "");
  }
  out.push("---", "", `来源：${site.name} ${url}（作品资料来自 TMDB）`, "");
  return out.join("\n");
}
