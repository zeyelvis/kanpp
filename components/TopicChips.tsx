import Link from "next/link";
import { topicPath, type Topic } from "@/lib/domain/topics";

/** A row of topic links (channel pages, home page, title pages). */
export function TopicChips({ title, topics, compact = false }: { title: string; topics: Topic[]; compact?: boolean }) {
  if (topics.length === 0) return null;
  return (
    <nav aria-label={title} className={compact ? "flex flex-wrap items-center gap-2 text-sm" : "space-y-3"}>
      {compact ? <span className="text-muted">{title}：</span> : <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>}
      <ul className="flex flex-wrap gap-2">
        {topics.map((t) => (
          <li key={t.name}>
            <Link
              href={topicPath(t)}
              className={`inline-block rounded-full bg-surface ring-1 ring-line hover:text-accent hover:ring-accent/60 ${compact ? "px-2.5 py-0.5 text-xs" : "px-3 py-1.5 text-sm"}`}
            >
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
