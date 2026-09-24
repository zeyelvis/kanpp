"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Thin top bar shown from the moment an internal link is clicked until the new route
 * renders. Our pages are server-rendered on demand, so without it a click looks ignored.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  // Route changed: finish the bar.
  const routeKey = `${pathname}?${search}`;
  const [lastKey, setLastKey] = useState(routeKey);
  if (routeKey !== lastKey) {
    setLastKey(routeKey);
    if (state === "loading") setState("done");
  }

  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(() => setState("idle"), 300);
    return () => window.clearTimeout(t);
  }, [state]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setState("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (state === "idle") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5">
      <div
        className="h-full bg-accent shadow-[0_0_8px_var(--color-accent)] transition-[width,opacity] ease-out"
        style={{ width: state === "loading" ? "80%" : "100%", opacity: state === "done" ? 0 : 1, transitionDuration: state === "loading" ? "8s" : "300ms" }}
      />
    </div>
  );
}
