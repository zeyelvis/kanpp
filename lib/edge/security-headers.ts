/**
 * Security headers for every response, applied in the Worker entry (worker.ts) so that pages
 * served straight from the ISR cache, redirects and images all carry them.
 *
 * Pages load scripts, styles, images and fonts only from this site. Video is the one
 * exception: HLS playlists and segments come straight from the source CDNs (any https host),
 * played through MediaSource (blob:) by hls.js. Next.js inlines its bootstrap scripts, and
 * cached pages cannot carry per-request nonces, hence 'unsafe-inline' for scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self), picture-in-picture=(self), autoplay=(self)",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** A copy of the response with any missing security header added. */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(name)) out.headers.set(name, value);
  return out;
}
