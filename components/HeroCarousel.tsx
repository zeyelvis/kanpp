"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Kind } from "@/lib/domain/kinds";
import { titlePath, watchPath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

export interface HeroSlide {
  id: number;
  kind: Kind;
  slug: string;
  name: string;
  year: number | null;
  genres: string[];
  label: string | null;
  overview: string | null;
  backdrop: string;
  rating: number | null;
}

const INTERVAL = 6000;

/** Swipeable (scroll-snap) hero. Every slide is in the HTML; JS only adds autoplay and dots. */
export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setActive(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = window.setInterval(() => {
      const el = track.current;
      if (!el) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % slides.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    }, INTERVAL);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  const go = (i: number) => track.current?.scrollTo({ left: i * track.current.clientWidth, behavior: "smooth" });

  return (
    <section
      aria-roledescription="carousel"
      aria-label="焦点推荐"
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      <div ref={track} className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto">
        {slides.map((s, i) => (
          <div key={s.id} className="relative w-full shrink-0 snap-start" aria-roledescription="slide" aria-label={`${i + 1} / ${slides.length}`}>
            <div className="relative h-[62vw] max-h-[560px] min-h-[240px] w-full sm:h-[480px]">
              <img
                src={tmdbImage(s.backdrop, "w1280")!}
                alt=""
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "auto"}
                decoding={i === 0 ? "sync" : "async"}
                className="size-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/30 to-transparent" />
              <div className="absolute inset-0 hidden bg-gradient-to-r from-bg/90 via-bg/30 to-transparent sm:block" />
            </div>
            <div className="absolute inset-x-0 bottom-0">
              <div className="mx-auto max-w-7xl px-4 pb-8 sm:pb-14">
                <div className="max-w-xl">
                  <h2 className="text-2xl font-bold drop-shadow sm:text-4xl">{s.name}</h2>
                  <p className="mt-2 flex flex-wrap gap-x-2 text-sm text-ink/80">
                    {s.rating ? <span className="font-semibold text-gold">★ {s.rating.toFixed(1)}</span> : null}
                    {s.year ? <span>{s.year}</span> : null}
                    {s.genres.slice(0, 2).map((g) => (
                      <span key={g}>{g}</span>
                    ))}
                    {s.label ? <span className="text-accent">{s.label}</span> : null}
                  </p>
                  {s.overview ? <p className="mt-3 hidden text-sm leading-6 text-ink/75 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden sm:block">{s.overview}</p> : null}
                  <div className="mt-4 flex gap-3">
                    <Link href={watchPath(s.kind, s.slug)} className="inline-flex h-10 items-center rounded-full bg-accent-fill px-6 text-sm font-semibold text-white hover:brightness-90">
                      ▶ 播放
                    </Link>
                    <Link href={titlePath(s.kind, s.slug)} className="inline-flex h-10 items-center rounded-full bg-white/10 px-6 text-sm ring-1 ring-white/20 backdrop-blur hover:bg-white/20">
                      详情
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {slides.length > 1 ? (
        <div className="absolute bottom-3 right-4 flex gap-1.5 sm:bottom-6 sm:right-[max(1rem,calc((100vw-80rem)/2+1rem))]">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`第${i + 1}张`}
              aria-current={i === active}
              onClick={() => go(i)}
              className={`h-1.5 rounded-full transition-all ${i === active ? "w-6 bg-accent" : "w-1.5 bg-white/40"}`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
