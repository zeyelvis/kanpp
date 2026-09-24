/**
 * TMDB v3 client for ingest scripts. The web runtime never calls TMDB: pages render from D1.
 */

const BASE = "https://api.themoviedb.org/3";

export type TmdbType = "movie" | "tv";

export interface TmdbSearchResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  popularity: number;
  adult?: boolean;
}

interface Named {
  id: number;
  name: string;
}

export interface TmdbDetails {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  tagline?: string;
  release_date?: string;
  first_air_date?: string;
  last_air_date?: string;
  status?: string;
  adult?: boolean;
  softcore?: boolean;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  next_episode_to_air?: { air_date?: string; season_number: number; episode_number: number } | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  genres?: Named[];
  origin_country?: string[];
  production_countries?: { iso_3166_1: string }[];
  original_language?: string;
  spoken_languages?: { iso_639_1: string }[];
  seasons?: { season_number: number; name?: string; overview?: string; air_date?: string | null; episode_count?: number; poster_path?: string | null }[];
  created_by?: Named[];
  credits?: {
    cast?: { id: number; name: string; character?: string; profile_path?: string | null; order?: number }[];
    crew?: { id: number; name: string; job?: string; department?: string }[];
  };
  external_ids?: { imdb_id?: string | null };
  translations?: { translations: { iso_3166_1: string; iso_639_1: string; data: { title?: string; name?: string; overview?: string } }[] };
  alternative_titles?: { titles?: { iso_3166_1: string; title: string }[]; results?: { iso_3166_1: string; title: string }[] };
}

export class TmdbClient {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly concurrency = 8,
  ) {
    if (!apiKey) throw new Error("TMDB_API_KEY is not set");
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(BASE + path);
    url.searchParams.set("api_key", this.apiKey);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    return this.slot(async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch((e: unknown) => e as Error);
        if (res instanceof Response && res.ok) return (await res.json()) as T;
        const status = res instanceof Response ? res.status : 0;
        if (status === 404) throw new TmdbNotFound(path);
        if (attempt >= 4 || (status !== 0 && status !== 429 && status < 500)) {
          throw new Error(`TMDB ${path}: ${res instanceof Response ? res.status : res.message}`);
        }
        const retryAfter = res instanceof Response ? Number(res.headers.get("retry-after")) : 0;
        await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : 600 * 2 ** attempt));
      }
    });
  }

  async search(type: TmdbType, query: string, year?: number | null): Promise<TmdbSearchResult[]> {
    const yearParam = type === "movie" ? { primary_release_year: year ?? undefined } : { first_air_date_year: year ?? undefined };
    const data = await this.get<{ results: TmdbSearchResult[] }>(`/search/${type}`, {
      query,
      language: "zh-CN",
      include_adult: "false",
      ...yearParam,
    });
    return data.results ?? [];
  }

  async details(type: TmdbType, id: number): Promise<TmdbDetails> {
    return this.get<TmdbDetails>(`/${type}/${id}`, {
      language: "zh-CN",
      append_to_response: "credits,external_ids,translations,alternative_titles",
    });
  }
}

export class TmdbNotFound extends Error {}

// TMDB leaves several TV genre names untranslated in zh-CN; keep our own labels by id.
export const GENRE_ZH: Record<number, string> = {
  28: "动作", 12: "冒险", 16: "动画", 35: "喜剧", 80: "犯罪", 99: "纪录", 18: "剧情", 10751: "家庭",
  14: "奇幻", 36: "历史", 27: "恐怖", 10402: "音乐", 9648: "悬疑", 10749: "爱情", 878: "科幻",
  10770: "电视电影", 53: "惊悚", 10752: "战争", 37: "西部",
  10759: "动作冒险", 10762: "儿童", 10763: "新闻", 10764: "真人秀", 10765: "科幻奇幻",
  10766: "肥皂剧", 10767: "脱口秀", 10768: "战争政治",
};

export function tmdbImage(path: string | null | undefined, size: "w185" | "w342" | "w500" | "w780" | "w1280" | "original"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}
