import { getDb } from "@/lib/db/server";
import { isPushEndpoint, isPushKey, MAX_PUSH_FOLLOWS } from "@/lib/domain/push";
import { sentFromOwnPage } from "@/lib/edge/rate-limit";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

async function body(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > 16_384) return null;
  try {
    const parsed = JSON.parse(await req.text());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Update reminders (opt-in): saves this browser's push subscription with the ids of the titles
 * it follows, or refreshes the list. Only from our own pages; worker.ts rate-limits /api/.
 */
export async function POST(req: Request) {
  if (!sentFromOwnPage(req)) return new Response(null, { status: 403, headers: NO_STORE });
  const b = await body(req);
  const sub = b?.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const follows = Array.isArray(b?.follows) ? (b!.follows as unknown[]) : null;
  if (
    !sub ||
    !isPushEndpoint(sub.endpoint) ||
    !isPushKey(sub.keys?.p256dh, 80, 100) ||
    !isPushKey(sub.keys?.auth, 16, 32) ||
    !follows ||
    follows.length > MAX_PUSH_FOLLOWS ||
    !follows.every((id) => Number.isInteger(id) && (id as number) > 0)
  ) {
    return new Response(null, { status: 400, headers: NO_STORE });
  }
  await (await getDb()).run(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, follows) VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
       follows = excluded.follows, updated_at = datetime('now')`,
    [sub.endpoint, sub.keys!.p256dh, sub.keys!.auth, JSON.stringify([...new Set(follows as number[])])],
  );
  return new Response(null, { status: 204, headers: NO_STORE });
}

/** Turns reminders off: forgets the subscription. */
export async function DELETE(req: Request) {
  if (!sentFromOwnPage(req)) return new Response(null, { status: 403, headers: NO_STORE });
  const b = await body(req);
  if (!isPushEndpoint(b?.endpoint)) return new Response(null, { status: 400, headers: NO_STORE });
  await (await getDb()).run("DELETE FROM push_subscriptions WHERE endpoint = ?", [b!.endpoint]);
  return new Response(null, { status: 204, headers: NO_STORE });
}
