"use client";

import { useSyncExternalStore } from "react";
import { watchFragment, type WatchState } from "@/lib/domain/slug";

// The selected season/episode/line live in the URL fragment of the title page (one crawlable
// URL per title). replaceState does not fire hashchange, so writes notify subscribers themselves.
const listeners = new Set<() => void>();

export function subscribeHash(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

export function writeHash(state: WatchState) {
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${watchFragment(state)}`);
  listeners.forEach((l) => l());
}

/** The current fragment; empty during server render and hydration. */
export function useHash(): string {
  return useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
}
