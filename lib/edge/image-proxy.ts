/**
 * Same-origin image delivery (/img/{size}/{file}). Pages never load images from another
 * domain: the first request for an image fetches it from TMDB once and keeps it in our R2
 * bucket; after that it is served from the edge cache or R2. Runs in the Worker entry
 * (worker.ts) before Next.js, so an image costs no render work.
 */

const SIZES = new Set(["w92", "w154", "w185", "w342", "w500", "w780", "w1280", "original"]);
const PATH = /^\/img\/([a-z0-9]+)\/([A-Za-z0-9_-]{6,64}\.(?:jpg|jpeg|png|webp))$/;
const IMMUTABLE = "public, max-age=31536000, immutable";

export function parseImagePath(pathname: string): { size: string; file: string } | null {
  const m = pathname.match(PATH);
  return m && SIZES.has(m[1]) ? { size: m[1], file: m[2] } : null;
}

interface StoredImage {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}
export interface ImageBucket {
  get(key: string): Promise<StoredImage | null>;
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string; cacheControl: string } }): Promise<unknown>;
}
interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

const headers = (contentType: string) => ({
  "Content-Type": contentType,
  "Cache-Control": IMMUTABLE,
  "X-Content-Type-Options": "nosniff",
});

export async function serveImage(request: Request, bucket: ImageBucket, ctx: Ctx): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const url = new URL(request.url);
  const parsed = parseImagePath(url.pathname);
  if (!parsed) return new Response("Not found", { status: 404 });

  // The query string never changes an image: key the edge cache on the path only.
  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(cacheKey);
  if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;

  const key = `${parsed.size}/${parsed.file}`;
  let response: Response;
  const stored = await bucket.get(key);
  if (stored) {
    response = new Response(stored.body, { headers: headers(stored.httpMetadata?.contentType ?? "image/jpeg") });
  } else {
    const upstream = await fetch(`https://image.tmdb.org/t/p/${parsed.size}/${parsed.file}`);
    if (!upstream.ok) {
      return new Response("Not found", { status: upstream.status === 404 ? 404 : 502, headers: { "Cache-Control": "public, max-age=300" } });
    }
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    const bytes = await upstream.arrayBuffer();
    ctx.waitUntil(bucket.put(key, bytes, { httpMetadata: { contentType, cacheControl: IMMUTABLE } }));
    response = new Response(bytes, { headers: headers(contentType) });
  }
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return request.method === "HEAD" ? new Response(null, response) : response;
}
