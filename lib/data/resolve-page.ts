import "server-only";
import { notFound, permanentRedirect } from "next/navigation";
import { getTitle, resolveSlug, type TitleDetail } from "@/lib/data/titles";
import { kindFromSegment } from "@/lib/domain/kinds";
import { decodeSlugParam, isOverEncoded, titlePath } from "@/lib/domain/slug";

/**
 * Shared URL resolution for title-scoped routes. Must run before anything streams so that
 * redirects are real 308s and misses are real 404s.
 *
 * `rebuild` maps the canonical title path to the URL of the current route (e.g. appends the
 * season segment), so a non-canonical season URL redirects to the canonical season URL.
 */
export async function resolveTitleRoute(
  params: { kind: string; slug: string },
  rebuild: (canonicalTitlePath: string) => string = (p) => p,
): Promise<TitleDetail> {
  const kind = kindFromSegment(params.kind);
  const decoded = decodeSlugParam(params.slug);
  const hit = (await resolveSlug(decoded)) ?? (decoded !== decoded.toLowerCase() ? await resolveSlug(decoded.toLowerCase()) : null);
  if (!hit) notFound();

  const title = hit.title;
  if (title.status === "merged" && title.merged_into) {
    const target = await getTitle(title.merged_into);
    if (target) permanentRedirect(rebuild(titlePath(target.kind, target.slug)));
  }
  if (title.status !== "active") notFound();
  // Never published: the URL exists internally but has nothing worth showing yet.
  if (!title.indexable && !title.published_at) notFound();

  // An over-encoded link resolves to the same title but is a duplicate URL: redirect it too.
  if (isOverEncoded(params.slug) || decoded !== title.slug || kind !== title.kind) {
    permanentRedirect(rebuild(titlePath(title.kind, title.slug)));
  }
  return title;
}

/** Metadata-side lookup: no redirects, just the title if the URL resolves at all. */
export async function lookupTitleForMetadata(params: { kind: string; slug: string }): Promise<TitleDetail | null> {
  const decoded = decodeSlugParam(params.slug);
  const hit = (await resolveSlug(decoded)) ?? (await resolveSlug(decoded.toLowerCase()));
  return hit && hit.title.status === "active" ? hit.title : null;
}
