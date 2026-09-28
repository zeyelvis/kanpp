"use client";

import { useSyncExternalStore } from "react";

/*
 * Installing the site on the home screen: a one-tap prompt where the browser offers one
 * (Android Chrome and most Chromium browsers), step-by-step guidance on iPhone and iPad Safari
 * (Apple offers no prompt), and "open in the browser" inside app browsers (WeChat, QQ, ...),
 * which can do neither.
 */

export type InstallPath = "prompt" | "ios" | "in-app" | "installed" | "none";

type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type InstallWindow = Window & { __kpInstall?: InstallPromptEvent | null };

const IN_APP: [RegExp, string][] = [
  [/MicroMessenger/i, "微信"],
  [/ QQ\//, "QQ"], // the QQ app; QQ Browser (MQQBrowser) is a real browser
  [/Weibo/i, "微博"],
  [/DingTalk/i, "钉钉"],
  [/AlipayClient/i, "支付宝"],
  [/aweme|BytedanceWebview|NewsArticle|Toutiao/i, "抖音"],
  [/xhsdiscover|XiaoHongShu/i, "小红书"],
];

/** The app whose built-in browser this is, or null in a real browser. */
export function inAppBrowser(): string | null {
  if (typeof navigator === "undefined") return null;
  return IN_APP.find(([pattern]) => pattern.test(navigator.userAgent))?.[1] ?? null;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** iPhone or iPad. Touch iPads report themselves as Macs; a Mac has a fine pointer (trackpads report touch points). */
export function isAppleTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  const iPad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && window.matchMedia?.("(pointer: coarse)").matches;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || iPad;
}

/** Safari itself: on iOS other browsers bury "Add to Home Screen" in different places. */
function isIosSafari(): boolean {
  return isAppleTouch() && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|Baidu|UCBrowser|MQQBrowser|Quark/.test(navigator.userAgent);
}

// Chrome announces installability once, possibly before React is up: an inline script in the
// root layout keeps the event on window.__kpInstall (see INSTALL_CAPTURE_SCRIPT).
export const INSTALL_CAPTURE_SCRIPT =
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__kpInstall=e});" +
  "window.addEventListener('appinstalled',function(){window.__kpInstall=null;try{localStorage.setItem('kanpp:installed','1')}catch(_){}});";

const listeners = new Set<() => void>();
let watching = false;

function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const notify = () => listeners.forEach((l) => l());
  // The inline script's listeners run first (registered earlier); this only re-renders.
  window.addEventListener("beforeinstallprompt", () => queueMicrotask(notify));
  window.addEventListener("appinstalled", () => queueMicrotask(notify));
}

function installed(): boolean {
  try {
    return isStandalone() || localStorage.getItem("kanpp:installed") === "1";
  } catch {
    return isStandalone();
  }
}

function currentPath(): InstallPath {
  if (typeof window === "undefined") return "none";
  if (installed()) return "installed";
  if (inAppBrowser()) return "in-app";
  if ((window as InstallWindow).__kpInstall) return "prompt";
  if (isIosSafari()) return "ios";
  return "none";
}

/** How this visitor can install the site right now. */
export function useInstallPath(): InstallPath {
  return useSyncExternalStore(
    (listener) => {
      watch();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentPath,
    () => "none",
  );
}

/** Shows the browser's install dialog; true when the viewer installed. */
export async function promptInstall(): Promise<boolean> {
  const event = (window as InstallWindow).__kpInstall;
  if (!event) return false;
  (window as InstallWindow).__kpInstall = null; // a prompt can be shown once
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") {
    try {
      localStorage.setItem("kanpp:installed", "1");
    } catch {
      // Private mode: the prompt just shows again later.
    }
  }
  listeners.forEach((l) => l());
  return outcome === "accepted";
}

const DISMISSED = "kanpp:install-dismissed";
const WATCHED = "kanpp:episodes-watched";
const QUIET_DAYS = 14;

/** "Not now": the automatic offer stays away for two weeks (the Me page keeps its entry). */
export function dismissInstall() {
  try {
    localStorage.setItem(DISMISSED, String(Date.now()));
  } catch {
    // Nothing to remember in private mode.
  }
}

export function installOfferQuiet(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED));
    return Number.isFinite(at) && Date.now() - at < QUIET_DAYS * 86400_000;
  } catch {
    return true;
  }
}

/** Counts episodes that started playing; returns the new count. */
export function countWatched(): number {
  try {
    const n = Number(localStorage.getItem(WATCHED) ?? 0) + 1;
    localStorage.setItem(WATCHED, String(n));
    return n;
  } catch {
    return 0;
  }
}

/** Fired by the player when an episode reaches its first frame. */
export const WATCHED_EVENT = "kanpp:watched";
