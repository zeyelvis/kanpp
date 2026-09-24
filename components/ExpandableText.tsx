"use client";

import { useState } from "react";

/** Full text is always in the HTML (crawlable); only the visible height is clamped. */
export function ExpandableText({ text, lines = 4 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 110;
  return (
    <div>
      <p
        className="leading-7 text-ink/85"
        style={!open && long ? { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}
      >
        {text}
      </p>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-sm text-accent">
          {open ? "收起" : "展开全部"}
        </button>
      ) : null}
    </div>
  );
}
