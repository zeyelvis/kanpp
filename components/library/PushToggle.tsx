"use client";

import { useState } from "react";
import { followIds } from "@/lib/client/library";
import { disablePush, enablePush, usePushEnabled, usePushSupport } from "@/lib/client/push";

/**
 * Update reminders switch. `prompt`: the one-line offer shown right after following a title
 * (nothing once reminders are on or the browser cannot do them).
 */
export function PushToggle({ prompt = false }: { prompt?: boolean }) {
  const support = usePushSupport();
  const on = usePushEnabled();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!support || support === "unsupported") return null;
  // Blocked earlier in the browser's settings: asking again cannot work, only the settings can.
  const blocked = support === "ok" && !on && typeof Notification !== "undefined" && Notification.permission === "denied";
  if (prompt && (on || support !== "ok" || blocked)) return null;

  const turnOn = async () => {
    setBusy(true);
    const result = await enablePush(followIds());
    setBusy(false);
    setMessage(
      result === "on"
        ? "已开启：追的剧出新集时会通知你"
        : result === "denied"
          ? "浏览器没有允许通知。可以在浏览器的网站设置里允许 kanpp.tv 发送通知后再试"
          : "开启失败，请稍后再试",
    );
  };
  const turnOff = async () => {
    setBusy(true);
    await disablePush();
    setBusy(false);
    setMessage("已关闭更新提醒");
  };

  if (prompt) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted">
        {message ?? "出新集时提醒我？"}
        {message ? null : (
          <button type="button" disabled={busy} onClick={turnOn} className="font-medium text-accent hover:underline disabled:opacity-50">
            开启提醒
          </button>
        )}
      </span>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface/60 px-4 py-3 text-sm ring-1 ring-line">
      {support === "ios-install" ? (
        <p className="text-muted">想在 iPhone、iPad 上收到新集提醒：先在 Safari 里点「分享 → 添加到主屏幕」，再从主屏幕打开看片片，回到这里开启。</p>
      ) : blocked ? (
        <p className="text-muted">这个浏览器关闭了 kanpp.tv 的通知权限。在浏览器的网站设置里允许通知后，刷新本页即可开启更新提醒。</p>
      ) : on ? (
        <>
          <span>🔔 更新提醒已开启：追的剧出新集时会通知这台设备</span>
          <button type="button" disabled={busy} onClick={turnOff} className="text-muted hover:text-ink disabled:opacity-50">
            关闭
          </button>
        </>
      ) : (
        <>
          <span className="text-muted">追的剧出新集时，让这台设备收到通知</span>
          <button type="button" disabled={busy} onClick={turnOn} className="rounded-full bg-accent-fill px-4 py-1.5 font-medium text-white disabled:opacity-50">
            开启更新提醒
          </button>
        </>
      )}
      {message ? (
        <p role="status" className="w-full text-xs text-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}
