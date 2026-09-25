"use client";

import { NO_MARKS, RATES, type SkipMarks } from "@/lib/domain/skip";

/** Player preferences in localStorage: playback speed (site-wide) and skip marks per title. */
const RATE_KEY = "kanpp:rate";
const SKIP_KEY = "kanpp:skip";
const MAX_TITLES = 200;

type SkipStore = Record<string, SkipMarks & { at: number }>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: preferences are a convenience.
  }
}

export function loadRate(): number {
  const rate = readJson<number>(RATE_KEY, 1);
  return (RATES as readonly number[]).includes(rate) ? rate : 1;
}

export function saveRate(rate: number) {
  writeJson(RATE_KEY, rate);
}

export function loadSkip(titleId: number): SkipMarks {
  const hit = readJson<SkipStore>(SKIP_KEY, {})[titleId];
  return hit ? { intro: hit.intro ?? null, outro: hit.outro ?? null } : NO_MARKS;
}

export function saveSkip(titleId: number, marks: SkipMarks) {
  const store = readJson<SkipStore>(SKIP_KEY, {});
  if (marks.intro == null && marks.outro == null) delete store[titleId];
  else store[titleId] = { ...marks, at: Date.now() };
  // Keep the most recently set titles only.
  const kept = Object.entries(store)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_TITLES);
  writeJson(SKIP_KEY, Object.fromEntries(kept));
}
