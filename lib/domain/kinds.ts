export const KINDS = ["movie", "tv", "anime", "variety", "doc"] as const;
export type Kind = (typeof KINDS)[number];

/** URL path segment for each kind (also the channel page path). */
export const KIND_SEGMENT: Record<Kind, string> = {
  movie: "movie",
  tv: "tv",
  anime: "anime",
  variety: "variety",
  doc: "documentary",
};

export const KIND_LABEL: Record<Kind, string> = {
  movie: "电影",
  tv: "电视剧",
  anime: "动漫",
  variety: "综艺",
  doc: "纪录片",
};

export function kindFromSegment(segment: string): Kind | null {
  const hit = (Object.entries(KIND_SEGMENT) as [Kind, string][]).find(([, s]) => s === segment);
  return hit ? hit[0] : null;
}

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

/** Whether a kind is episodic by default (movie-type anime/docs are decided per title). */
export function isSeriesKind(kind: Kind): boolean {
  return kind === "tv" || kind === "variety";
}
