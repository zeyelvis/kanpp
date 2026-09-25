import { describeUpdate } from "./updates";

/** Public half of the VAPID key pair (the private half is only in the sender's environment). */
export const VAPID_PUBLIC_KEY = "BEdQxDeACbwaULieQxZj6oRIoP9yTrMOdWN0qIisJEaxKlv-0PDyWV1ZHv27Z4QQcQsPWUJIJBVcqiZ1K_M04vU";

export const MAX_PUSH_FOLLOWS = 300;

// Push services of the browsers that support web push. Subscriptions pointing anywhere else are
// refused: the sender posts to these URLs, so they must not be arbitrary.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 1000) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

/** A push key as the browser sends it: base64url. */
export function isPushKey(raw: unknown, min: number, max: number): raw is string {
  return typeof raw === "string" && raw.length >= min && raw.length <= max && /^[A-Za-z0-9_-]+=*$/.test(raw);
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** One notification per device and run: one title by name, several as a summary. */
export function updateMessage(updates: { name: string; label: string; path: string }[]): PushMessage | null {
  if (updates.length === 0) return null;
  if (updates.length === 1) {
    const [u] = updates;
    return { title: `《${u.name}》${describeUpdate(u.label)}`, body: "点这里接着看", url: u.path, tag: `title:${u.path}` };
  }
  const named = updates.slice(0, 3).map((u) => `《${u.name}》${describeUpdate(u.label)}`).join("，");
  return { title: `你追的 ${updates.length} 部剧更新了`, body: updates.length > 3 ? `${named}等` : named, url: "/me", tag: "follows" };
}
