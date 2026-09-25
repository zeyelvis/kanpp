import { latestEpisodeNumber } from "./labels";

/** A title_updates row: the label the sources showed, and when. */
export interface UpdateRow {
  label: string;
  /** The source's own update time, Beijing time ("2026-09-25 10:23:11"). */
  source_time: string | null;
  /** When the change was recorded, UTC. */
  seen_at: string;
}

export interface UpdateEntry {
  /** "2026-09-25", Beijing time. */
  date: string;
  text: string;
  episode: number | null;
}

const FINISHED = /完结|全集|全\d+集|\d+集全/;

/** Beijing-time date of a row: the source's time when it has one, else when we saw it. */
function rowDate(r: UpdateRow): string {
  if (r.source_time && /^\d{4}-\d{2}-\d{2}/.test(r.source_time)) return r.source_time.slice(0, 10);
  const seen = new Date(`${r.seen_at.replace(" ", "T")}Z`);
  return new Date(seen.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** "更新到第12集", "全16集", "更新为「HD」": how a new label reads in the history and in reminders. */
export function describeUpdate(label: string): string {
  const trimmed = label.trim();
  if (FINISHED.test(trimmed)) return trimmed;
  const episode = latestEpisodeNumber(trimmed);
  return episode != null ? `更新到第${episode}集` : `更新为「${trimmed}」`;
}

/**
 * The update history a title page shows, newest first. Sources relabel the same episode
 * ("第12集" / "更新至12集") and briefly go back when another source is newer, so an entry
 * is kept only when it moves forward: a higher episode number, the first "finished" label,
 * or, for titles without episode numbers (films: "TC" -> "HD"), a label not seen before.
 */
export function updateTimeline(rowsNewestFirst: UpdateRow[], limit = 12): UpdateEntry[] {
  const out: UpdateEntry[] = [];
  let maxEpisode: number | null = null;
  let finished = false;
  const seen = new Set<string>();
  for (const r of [...rowsNewestFirst].reverse()) {
    const label = r.label.trim();
    const episode = latestEpisodeNumber(label);
    const isFinished = FINISHED.test(label);
    let forward: boolean;
    if (isFinished) forward = !finished;
    else if (episode != null) forward = !finished && (maxEpisode == null || episode > maxEpisode);
    else forward = maxEpisode == null && !finished && !seen.has(label);
    seen.add(label);
    if (episode != null) maxEpisode = Math.max(maxEpisode ?? 0, episode);
    if (!forward) continue;
    if (isFinished) finished = true;
    out.push({ date: rowDate(r), text: describeUpdate(label), episode });
  }
  return out.reverse().slice(0, limit);
}

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * "通常在周二、周三更新" when the recorded episode updates (after the first, which is only
 * when we started watching) fall on at most two weekdays. Needs at least three of them.
 */
export function updateCadence(entries: UpdateEntry[]): string | null {
  const episodes = entries.filter((e) => e.episode != null).slice(0, -1);
  if (episodes.length < 3) return null;
  const counts = new Map<number, number>();
  for (const e of episodes) {
    const day = new Date(`${e.date}T00:00:00Z`).getUTCDay();
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  if (counts.size > 2) return null;
  const days = [...counts.keys()].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return `通常在${days.map((d) => WEEKDAY[d]).join("、")}更新`;
}
