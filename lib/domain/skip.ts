/**
 * Per-title intro/outro marks set by the viewer ("片头到这", "片尾从这"): the intro is where
 * the episode proper starts, the outro how many seconds before the end the credits start.
 * Applied once when an episode loads (like the resume position) and when playback reaches the
 * credits; never used to nudge a stalled stream.
 */
export interface SkipMarks {
  intro: number | null;
  outro: number | null;
}

export const NO_MARKS: SkipMarks = { intro: null, outro: null };

/** Limits that keep a mis-click from skipping half an episode. */
export const MAX_INTRO = 600;
export const MAX_OUTRO = 900;

export function introMark(time: number, duration: number): number | null {
  const t = Math.round(time);
  return t >= 5 && t <= MAX_INTRO && (!duration || t < duration - 60) ? t : null;
}

export function outroMark(time: number, duration: number): number | null {
  if (!duration || !Number.isFinite(duration)) return null;
  const before = Math.round(duration - time);
  return before >= 5 && before <= MAX_OUTRO && time > duration / 2 ? before : null;
}

/** Where a newly loaded episode should start: the resume position, else past the intro. */
export function startPosition(marks: SkipMarks, resume: number | null, duration: number): number | null {
  const fits = (t: number | null) => t != null && t > 5 && (!duration || t < duration - 10);
  if (fits(resume) && (marks.intro == null || resume! >= marks.intro)) return resume;
  if (fits(marks.intro) && (!duration || marks.intro! < duration - 60)) return marks.intro;
  return fits(resume) ? resume : null;
}

/** True once playback has reached the credits. */
export function inOutro(marks: SkipMarks, time: number, duration: number): boolean {
  return marks.outro != null && Number.isFinite(duration) && duration > 0 && time >= duration - marks.outro;
}

export const RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export function stepRate(rate: number, dir: 1 | -1): number {
  const i = RATES.findIndex((r) => r >= rate);
  const at = i === -1 ? RATES.length - 1 : i;
  return RATES[Math.min(RATES.length - 1, Math.max(0, at + dir))];
}
