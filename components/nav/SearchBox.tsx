"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { tmdbImage } from "@/lib/images";

export interface Suggestion {
  name: string;
  year: number | null;
  kindLabel: string;
  href: string;
  poster: string | null;
}

/** Search input with as-you-type suggestions (keyboard navigable). */
export function SearchBox({ defaultValue = "", autoFocus = false, className = "" }: { defaultValue?: string; autoFocus?: boolean; className?: string }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!term) {
        setItems([]);
        return;
      }
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) {
          setItems((await res.json()) as Suggestion[]);
          setCursor(-1);
        }
      } catch {
        // aborted or offline: keep the previous list
      }
    }, 150);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const submit = () => {
    setOpen(false);
    if (cursor >= 0 && items[cursor]) router.push(items[cursor].href);
    else if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <form
        role="search"
        action="/search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          name="q"
          type="search"
          value={q}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="搜索片名，简繁都可以"
          aria-label="搜索片名"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(items.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(-1, c - 1));
            } else if (e.key === "Escape") setOpen(false);
          }}
          className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none placeholder:text-faint focus:border-accent"
        />
      </form>
      {open && items.length > 0 ? (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl bg-surface-2 py-1 shadow-2xl ring-1 ring-line">
          {items.map((s, i) => (
            <li key={s.href} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  setOpen(false);
                  router.push(s.href);
                }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === cursor ? "bg-line" : ""}`}
              >
                {s.poster ? <img src={tmdbImage(s.poster, "w185")!} alt="" className="h-12 w-8 shrink-0 rounded object-cover" /> : <span className="h-12 w-8 shrink-0 rounded bg-surface" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm">{s.name}</span>
                  <span className="block text-xs text-faint">
                    {s.kindLabel}
                    {s.year ? ` · ${s.year}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
