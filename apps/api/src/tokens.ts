// Device tokens. An access token is a short JWT (HS256, 15 minutes) naming the user and the device; it is checked
// without a database read. A refresh token is `<deviceId>.<secret>`: the device's record keeps only the secret's
// SHA-256, so a leaked database can't mint access. Signing out deletes the device, which ends its refresh token.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_TTL_S = 15 * 60;

export interface AccessClaims {
  sub: string; // user id
  dev: string; // device id
  exp: number; // epoch seconds
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export function signAccess(secret: string, sub: string, dev: string, now = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: AccessClaims = { sub, dev, exp: Math.floor(now / 1000) + ACCESS_TTL_S };
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

// The claims, or undefined when the token is malformed, forged or expired.
export function verifyAccess(secret: string, token: string, now = Date.now()): AccessClaims | undefined {
  const [header, body, sig] = token.split(".");
  if (!header || !body || !sig) return undefined;
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as AccessClaims;
    if (typeof claims.sub !== "string" || typeof claims.dev !== "string") return undefined;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

export function newRefresh(deviceId: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { token: `${deviceId}.${secret}`, hash: sha256(secret) };
}

export function parseRefresh(token: string): { deviceId: string; hash: string } | undefined {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return undefined;
  return { deviceId: token.slice(0, dot), hash: sha256(token.slice(dot + 1)) };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

// What a person types or checks: 8 letters, no vowels or look-alikes, shown as ABCD-EFGH.
export function userCode(): string {
  const letters = "BCDFGHJKLMNPQRSTVWXZ";
  const bytes = randomBytes(8);
  const code = [...bytes].map((b) => letters[b % letters.length]).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
