/**
 * True when a request's Accept header asks for Markdown at least as much as HTML, as AI
 * agents do ("text/markdown, text/html;q=0.9"). Browsers never list text/markdown.
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const q = new Map<string, number>();
  for (const part of accept.toLowerCase().split(",")) {
    const [type, ...params] = part.trim().split(";");
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    q.set(type.trim(), qParam ? Number(qParam.slice(2)) || 0 : 1);
  }
  const md = q.get("text/markdown") ?? 0;
  return md > 0 && md >= (q.get("text/html") ?? 0);
}
