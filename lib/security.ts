import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ID_PATTERN = /^[a-zA-Z0-9]{16,64}$/;
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type Session = {
  albumId: string;
  actorHash: string;
  role: "host" | "guest";
  expiresAt: number;
};
export function signSession(session: Session, secret: string) {
  if (secret.length < 32) throw new Error("Configuration unavailable");
  const data = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}
export function readSession(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): Session | null {
  if (!value || value.length > 1200 || secret.length < 32) return null;
  const [data, signature, extra] = value.split(".");
  if (!data || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(data).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return null;
  try {
    const session = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (
      !ID_PATTERN.test(session.albumId) ||
      !/^[a-f0-9]{64}$/.test(session.actorHash) ||
      !["host", "guest"].includes(session.role) ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= now ||
      session.expiresAt > now + 32 * 86400000
    )
      return null;
    return session;
  } catch {
    return null;
  }
}
export async function boundedBody(request: Request, maximum: number) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new Error("Request too large");
  if (!request.body) throw new Error("Request body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
export function sameOrigin(request: Request, configuredOrigin?: string) {
  const url = new URL(request.url);
  // Next's local adapter may reconstruct request.url with localhost. The Host
  // header still identifies the actual browser origin; never trust forwarded-host.
  const expected =
    configuredOrigin ||
    `${url.protocol}//${request.headers.get("host") || url.host}`;
  try {
    return new URL(expected).origin === request.headers.get("origin");
  } catch {
    return false;
  }
}
