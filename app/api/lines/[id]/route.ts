import { playbackStats, viewerCountry } from "@/lib/data/playback";
import { getLines, getSeasons, getTitle } from "@/lib/data/titles";
import { rankLines } from "@/lib/domain/line-rank";

export const dynamic = "force-dynamic";

/**
 * A title's playable lines for the player on the title page. Loaded by the browser when the
 * viewer starts playback, so stream URLs stay out of the cached page HTML, and ranked for the
 * viewer's country (cf-ipcountry), which a shared cached page cannot do.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/lines/[id]">) {
  const id = Number((await ctx.params).id);
  const t = Number.isInteger(id) && id > 0 ? await getTitle(id) : null;
  if (!t || t.status !== "active" || (!t.indexable && !t.published_at)) {
    return Response.json({ error: "not found" }, { status: 404, headers: { "X-Robots-Tag": "noindex" } });
  }
  const country = viewerCountry(req.headers.get("cf-ipcountry"));
  const [lines, seasons, stats] = await Promise.all([getLines(t.id, t.tmdb_type), getSeasons(t.id), playbackStats(country)]);
  const seasonNumbers = [...new Set(lines.map((l) => l.season).filter((s): s is number => s != null))].sort((a, b) => a - b);
  return Response.json(
    {
      lines: rankLines(lines, stats.local, stats.global),
      seasons: seasonNumbers.map((n) => ({ number: n, name: seasons.find((s) => s.season_number === n)?.name ?? `第${n}季` })),
      defaultSeason: t.tmdb_type === "tv" ? (seasonNumbers.at(-1) ?? null) : null,
    },
    { headers: { "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex" } },
  );
}
