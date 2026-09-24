import type { HlsConfig } from "hls.js";

/**
 * Buffer settings carried over from ikanpp, where they were tuned against periodic
 * stalls on long-haul links: deep forward buffer, and a back buffer far enough behind the
 * playhead that SourceBuffer.remove() does not contend with appends.
 */
export function hlsConfig(mobile: boolean): Partial<HlsConfig> {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: mobile ? 60 : 120,
    maxMaxBufferLength: mobile ? 120 : 240,
    maxBufferSize: (mobile ? 60 : 120) * 1000 * 1000,
    maxBufferHole: 0.8,
    backBufferLength: mobile ? 25 : 60,
    startFragPrefetch: true,
    fragLoadingTimeOut: 30_000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    fragLoadingMaxRetryTimeout: 60_000,
    manifestLoadingTimeOut: 20_000,
    manifestLoadingMaxRetry: 4,
    levelLoadingTimeOut: 20_000,
    levelLoadingMaxRetry: 4,
  };
}

/** Touch-first devices get the smaller buffer. MacBook trackpads report touch points, so
 * coarse pointer + touch events are both required (same rule ikanpp learned the hard way). */
export function isMobileClient(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches && "ontouchstart" in window;
}
