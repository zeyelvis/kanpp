"use client";

import { useEffect, useState } from "react";
import { countWatched, dismissInstall, inAppBrowser, installOfferQuiet, isAppleTouch, promptInstall, useInstallPath, WATCHED_EVENT } from "@/lib/client/install";

/** Safari's share glyph, drawn so the steps point at the right button. */
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="inline-block -translate-y-px align-middle">
      <path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 10H17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const PERKS = ["全屏看剧，没有浏览器地址栏", "追的剧出新集，手机会提醒你"];

/** iPhone and iPad: Apple offers no install prompt, so the steps. */
export function IosSteps() {
  return (
    <ol className="space-y-1.5 text-sm">
      <li>
        1. 点 Safari 底部的「分享」<ShareIcon />
        <span className="text-faint">（新版 iOS 在右下角「···」里）</span>
      </li>
      <li>2. 选「添加到主屏幕」，点「添加」</li>
      <li>3. 以后从桌面上的看片片图标打开</li>
    </ol>
  );
}

/**
 * The install offer: after the second episode a viewer starts, a card above the tab bar offers
 * the home screen (one tap where the browser can install, the steps on iPhone). Inside app
 * browsers (WeChat, QQ, ...) a strip suggests opening the page in the browser. Nothing covers
 * the player; "以后再说" keeps it away for two weeks.
 */
export function InstallPrompt() {
  const path = useInstallPath();
  const [offer, setOffer] = useState(false);
  // Read at once: the server renders nothing here (no install path yet), so no mismatch.
  const [inAppClosed, setInAppClosed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return sessionStorage.getItem("kanpp:in-app-closed") === "1";
    } catch {
      return false;
    }
  });
  const app = path === "in-app" ? inAppBrowser() : null;

  // Browsers that install sites (Chrome, Edge, ...) may require a service worker for it. Ours
  // only shows update reminders: no fetch handler, nothing is cached.
  useEffect(() => {
    if ("onbeforeinstallprompt" in window && "serviceWorker" in navigator && !isAppleTouch()) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onWatched = () => {
      if (countWatched() >= 2 && !installOfferQuiet()) setOffer(true);
    };
    window.addEventListener(WATCHED_EVENT, onWatched);
    return () => window.removeEventListener(WATCHED_EVENT, onWatched);
  }, []);

  if (app && !inAppClosed) {
    return (
      <div className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex items-start gap-3 rounded-xl bg-[#1d1f27] px-4 py-3 text-sm shadow-xl shadow-black/40 ring-1 ring-line md:bottom-4 md:left-auto md:w-96">
        <p className="flex-1">
          你正在{app}里浏览。点右上角「···」选「在浏览器打开」，播放更流畅，还能全屏、装到桌面。
        </p>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => {
            setInAppClosed(true);
            try {
              sessionStorage.setItem("kanpp:in-app-closed", "1");
            } catch {
              // Closed for this page view only.
            }
          }}
          className="px-1 text-lg leading-none text-muted hover:text-ink"
        >
          ×
        </button>
      </div>
    );
  }

  if (!offer || (path !== "prompt" && path !== "ios")) return null;

  const later = () => {
    dismissInstall();
    setOffer(false);
  };

  return (
    <div
      role="dialog"
      aria-label="把看片片装到桌面"
      className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 rounded-2xl bg-[#1d1f27] p-4 shadow-2xl shadow-black/50 ring-1 ring-line md:bottom-4 md:left-auto md:w-96"
    >
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" width={48} height={48} className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">把看片片装到桌面，像 App 一样看剧</p>
          <ul className="mt-1 space-y-0.5 text-sm text-muted">
            {PERKS.map((p) => (
              <li key={p}>· {p}</li>
            ))}
          </ul>
        </div>
      </div>
      {path === "ios" ? (
        <div className="mt-3 rounded-xl bg-black/25 p-3">
          <IosSteps />
          <p className="mt-2 text-xs text-faint">桌面上的看片片会单独记录追剧和观看历史。</p>
        </div>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={later} className="rounded-full px-4 py-2 text-sm text-muted hover:text-ink">
          以后再说
        </button>
        {path === "prompt" ? (
          <button
            type="button"
            onClick={async () => {
              const done = await promptInstall();
              if (!done) dismissInstall();
              setOffer(false);
            }}
            className="rounded-full bg-accent-fill px-5 py-2 text-sm font-medium text-white"
          >
            安装
          </button>
        ) : (
          <button type="button" onClick={() => setOffer(false)} className="rounded-full bg-accent-fill px-5 py-2 text-sm font-medium text-white">
            知道了
          </button>
        )}
      </div>
    </div>
  );
}

/** The Me page's permanent entry: install, or how to, or nothing once installed. */
export function InstallCard() {
  const path = useInstallPath();
  const [open, setOpen] = useState(false);
  if (path !== "prompt" && path !== "ios") return null;
  return (
    <div className="mb-5 rounded-xl bg-surface/60 px-4 py-3 text-sm ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <span className="font-medium">装到桌面</span>
          <span className="text-muted">：全屏看剧，追的剧出新集会提醒你</span>
        </p>
        {path === "prompt" ? (
          <button type="button" onClick={() => void promptInstall()} className="rounded-full bg-accent-fill px-4 py-1.5 font-medium text-white">
            安装看片片
          </button>
        ) : (
          <button type="button" onClick={() => setOpen(!open)} className="rounded-full px-4 py-1.5 font-medium text-accent ring-1 ring-accent/50">
            {open ? "收起" : "怎么装"}
          </button>
        )}
      </div>
      {open ? (
        <div className="mt-3">
          <IosSteps />
        </div>
      ) : null}
    </div>
  );
}
