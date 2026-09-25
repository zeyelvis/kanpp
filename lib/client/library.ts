"use client";

import { useSyncExternalStore } from "react";
import type { Kind } from "@/lib/domain/kinds";

/**
 * The viewer's own library, kept in localStorage (no accounts yet): what they watched and
 * which shows they follow. Components subscribe through useSyncExternalStore so every
 * button and rail updates together.
 */

export interface TitleRef {
  id: number;
  kind: Kind;
  slug: string;
  name: string;
  poster: string | null;
  backdrop?: string | null;
  year?: number | null;
}

export interface HistoryEntry extends TitleRef {
  season: number | null;
  ep: number; // 0-based
  epName: string;
  t: number; // seconds
  duration: number | null;
  at: number; // epoch ms
}

export interface FollowEntry extends TitleRef {
  /** latest_label the viewer has already seen; a different current label means "updated". */
  seenLabel: string | null;
  at: number;
}

const HISTORY_KEY = "kanpp:history";
const FOLLOW_KEY = "kanpp:follows";
const MAX_HISTORY = 60;
const MAX_FOLLOWS = 300;

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string): T[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T[];
  let value: T[] = [];
  try {
    value = raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    value = [];
  }
  cache.set(key, { raw, value });
  return value;
}

function write<T>(key: string, value: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): the library is a convenience.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === HISTORY_KEY || e.key === FOLLOW_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: never[] = [];

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, () => read<HistoryEntry>(HISTORY_KEY), () => EMPTY);
}

export function useFollows(): FollowEntry[] {
  return useSyncExternalStore(subscribe, () => read<FollowEntry>(FOLLOW_KEY), () => EMPTY);
}

export function recordHistory(entry: Omit<HistoryEntry, "at">) {
  const rest = read<HistoryEntry>(HISTORY_KEY).filter((h) => h.id !== entry.id);
  write(HISTORY_KEY, [{ ...entry, at: Date.now() }, ...rest].slice(0, MAX_HISTORY));
}

export function removeHistory(id: number) {
  write(HISTORY_KEY, read<HistoryEntry>(HISTORY_KEY).filter((h) => h.id !== id));
}

export function clearHistory() {
  write(HISTORY_KEY, []);
}

export function lastWatched(id: number): HistoryEntry | null {
  return read<HistoryEntry>(HISTORY_KEY).find((h) => h.id === id) ?? null;
}

export function toggleFollow(title: TitleRef & { latestLabel: string | null }): boolean {
  const list = read<FollowEntry>(FOLLOW_KEY);
  const following = !list.some((f) => f.id === title.id);
  const { latestLabel, ...ref } = title;
  const next = following ? [{ ...ref, seenLabel: latestLabel, at: Date.now() }, ...list].slice(0, MAX_FOLLOWS) : list.filter((f) => f.id !== title.id);
  write(FOLLOW_KEY, next);
  // Update reminders, when on, need the new list (loaded on demand: most visitors never use them).
  void import("./push").then((m) => m.syncPushFollows(next.map((f) => f.id))).catch(() => undefined);
  return following;
}

export function followIds(): number[] {
  return read<FollowEntry>(FOLLOW_KEY).map((f) => f.id);
}

/** Mark a followed title's current update as seen (called when its page is opened). */
export function markSeen(id: number, latestLabel: string | null) {
  const list = read<FollowEntry>(FOLLOW_KEY);
  const f = list.find((x) => x.id === id);
  if (!f || f.seenLabel === latestLabel) return;
  write(FOLLOW_KEY, list.map((x) => (x.id === id ? { ...x, seenLabel: latestLabel } : x)));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
