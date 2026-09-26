import { createECDH, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { encryptPayload, fromBase64Url, sendWebPush, toBase64Url, vapidAuthorization } from "@/lib/push/webpush";

// http_ece (web-push's own encryption library) plays the browser: it must decrypt what we send.
const ece = createRequire(import.meta.url)("http_ece") as {
  decrypt(buffer: Buffer, params: { version: string; privateKey: ReturnType<typeof createECDH>; authSecret: string }): Buffer;
};

function browserSubscription() {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16).toString("base64url");
  return { ua, keys: { p256dh: ua.getPublicKey().toString("base64url"), auth } };
}

describe("web push (RFC 8291 / 8292)", () => {
  it("encrypts a payload the browser side can decrypt", async () => {
    const { ua, keys } = browserSubscription();
    const payload = JSON.stringify({ title: "《繁花》更新到第12集", body: "点这里接着看", url: "/tv/繁花-2023" });
    const body = await encryptPayload(keys, new TextEncoder().encode(payload));
    const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: keys.auth });
    expect(plain.toString("utf8")).toBe(payload);
  });

  it("signs a VAPID token the push service can verify", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const publicKey = toBase64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", { subject: "https://kanpp.tv", publicKey, privateKey: jwk.d! }, 1_790_000_000_000);
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(publicKey);
    const [h, c, s] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(c)))).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_790_000_000 + 43_200, sub: "https://kanpp.tv" });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, fromBase64Url(s), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("posts with the push headers and reports the status", async () => {
    const { keys } = browserSubscription();
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
    const vapid = { subject: "https://kanpp.tv", publicKey: toBase64Url(await crypto.subtle.exportKey("raw", pair.publicKey)), privateKey: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d! };
    let seen: RequestInit | undefined;
    const status = await sendWebPush({ endpoint: "https://web.push.apple.com/x", keys }, "{}", vapid, { ttl: 86400 }, (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response(null, { status: 410 });
    }) as typeof fetch);
    expect(status).toBe(410);
    const h = seen!.headers as Record<string, string>;
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.TTL).toBe("86400");
    expect(h.Authorization).toMatch(/^vapid t=.+, k=/);
  });
});
