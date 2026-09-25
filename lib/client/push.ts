"use client";

import { useSyncExternalStore } from "react";
import { VAPID_PUBLIC_KEY } from "@/lib/domain/push";

/**
 * Update reminders (web push), opt-in per device. The subscription and the ids of the followed
 * titles go to /api/push; scripts/push-updates.ts sends a notification when one of them gets a
 * new episode. "kanpp:push" in localStorage remembers that this device turned reminders on.
 */
const FLAG = "kanpp:push";

export type PushSupport = "ok" | "ios-install" | "unsupported" | null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function enabled(): boolean {
  try {
    return localStorage.getItem(FLAG) === "on";
  } catch {
    return false;
  }
}

function setEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, "on");
    else localStorage.removeItem(FLAG);
  } catch {
    // Storage unavailable: reminders still work, the toggle just does not remember.
  }
  listeners.forEach((l) => l());
}

export function usePushEnabled(): boolean {
  return useSyncExternalStore(subscribe, enabled, () => false);
}

/**
 * "ios-install": iPhone and iPad deliver web push only to sites added to the home screen.
 * Touch-screen iPads report themselves as Macs, so a Mac with a fine pointer stays a Mac.
 */
function detect(): PushSupport {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const iPad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && window.matchMedia?.("(pointer: coarse)").matches;
  if ((/iPhone|iPad|iPod/.test(navigator.userAgent) || iPad) && !standalone) return "ios-install";
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "ok" : "unsupported";
}

let support: PushSupport = null;
export function usePushSupport(): PushSupport {
  return useSyncExternalStore(
    () => () => undefined,
    () => (support ??= detect()),
    () => null,
  );
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function send(method: "POST" | "DELETE", body: unknown) {
  const res = await fetch("/api/push", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`push ${method}: ${res.status}`);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission, subscribes this device and saves the followed titles. */
export async function enablePush(followIds: number[]): Promise<"on" | "denied" | "error"> {
  try {
    if ((await Notification.requestPermission()) !== "granted") return "denied";
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
    await send("POST", { subscription: sub.toJSON(), follows: followIds });
    setEnabled(true);
    return "on";
  } catch {
    return "error";
  }
}

export async function disablePush(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (sub) {
      await send("DELETE", { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe();
    }
  } finally {
    setEnabled(false);
  }
}

let pending: number | undefined;
/** Keeps the server's copy of the followed titles current (debounced). */
export function syncPushFollows(followIds: number[]) {
  if (!enabled()) return;
  window.clearTimeout(pending);
  pending = window.setTimeout(async () => {
    try {
      const sub = await currentSubscription();
      if (!sub) return setEnabled(false);
      await send("POST", { subscription: sub.toJSON(), follows: followIds });
    } catch {
      // Next change or visit retries; a missed sync only delays a reminder.
    }
  }, 800);
}
