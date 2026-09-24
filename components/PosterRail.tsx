import type { TitleCard } from "@/lib/data/titles";
import { PosterCard } from "./PosterCard";
import { ScrollRail } from "./ScrollRail";

export function PosterRail({ id, title, href, titles, eager = false }: { id: string; title: string; href?: string; titles: TitleCard[]; eager?: boolean }) {
  if (titles.length === 0) return null;
  return (
    <ScrollRail id={id} title={title} href={href}>
      {titles.map((t, i) => (
        <li key={t.id} className="w-[30%] shrink-0 snap-start sm:w-40 lg:w-[calc((100%-5*0.75rem)/6)]">
          <PosterCard title={t} eager={eager && i < 6} />
        </li>
      ))}
    </ScrollRail>
  );
}
