/**
 * Web push over WebCrypto only, so the same code sends from the ingest Worker and from Node:
 * payload encryption per RFC 8291 (aes128gcm, RFC 8188) and VAPID per RFC 8292.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** "https://kanpp.tv" or "mailto:…" */
  subject: string;
  /** Uncompressed P-256 point, base64url (65 bytes). */
  publicKey: string;
  /** Private scalar d, base64url (32 bytes). */
  privateKey: string;
}

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;

export function fromBase64Url(value: string): Bytes {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let raw = "";
  for (const b of view) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/**
 * Encrypts a payload for one subscription (a single aes128gcm record). `salt` and `serverKeys`
 * are random unless given (tests).
 */
export async function encryptPayload(
  sub: PushSubscriptionKeys["keys"],
  payload: Uint8Array,
  fixed: { salt?: Bytes; serverKeys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const uaPublic = fromBase64Url(sub.p256dh);
  const authSecret = fromBase64Url(sub.auth);
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const server = fixed.serverKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", server.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256));

  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  if (payload.length + 1 + 16 > RECORD_SIZE) throw new Error("push payload too large");
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02: padding delimiter of the last (only) record.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(new ArrayBuffer(16 + 4 + 1));
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** "vapid t=…, k=…" for the push service of `endpoint` (JWT valid for 12 hours). */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const pub = fromBase64Url(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: vapid.privateKey, x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33, 65)), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })));
  // WebCrypto's ECDSA signature is already the raw r||s form JWS uses.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${vapid.publicKey}`;
}

/** Sends one notification; returns the push service's status (201 sent, 404/410 gone). */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: string,
  vapid: VapidKeys,
  opts: { ttl: number; urgency?: "very-low" | "low" | "normal" | "high" },
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const body = await encryptPayload(sub.keys, encoder.encode(payload));
  const res = await fetcher(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl),
      Urgency: opts.urgency ?? "normal",
    },
    body,
  });
  await res.body?.cancel();
  return res.status;
}
