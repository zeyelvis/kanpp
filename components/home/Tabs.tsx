"use client";

import { useState, type ReactNode } from "react";

/**
 * Tab panels that are all in the HTML (crawlers follow every link); only the chosen one shows.
 */
export function Tabs({ id, labels, children }: { id: string; labels: string[]; children: ReactNode[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div role="tablist" aria-label="分类" className="mb-4 flex gap-1 overflow-x-auto">
        {labels.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            onClick={() => setActive(i)}
            className={`shrink-0 rounded-full px-3.5 py-1 text-sm transition ${i === active ? "bg-ink font-medium text-black" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {children.map((panel, i) => (
        <div key={labels[i]} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={i !== active}>
          {panel}
        </div>
      ))}
    </div>
  );
}
