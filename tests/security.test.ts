import { describe, expect, it, afterEach, vi } from "vitest";
import sharp from "sharp";
import {
  boundedBody,
  digest,
  readSession,
  sameOrigin,
  signSession,
  token,
} from "../lib/security";
import { normalizePhoto } from "../lib/images";
import { configuration } from "../lib/backend";
const secret = "s".repeat(40);
const session = {
  albumId: "a".repeat(32),
  actorHash: digest("host"),
  role: "host" as const,
  expiresAt: Date.now() + 86400000,
};
afterEach(() => vi.unstubAllEnvs());
describe("server session boundary", () => {
  it("authenticates a cookie and refuses tampering, foreign secrets, expiry and malformed payloads", () => {
    const cookie = signSession(session, secret);
    expect(readSession(cookie, secret)).toEqual(session);
    expect(readSession(cookie.replace(".", "x."), secret)).toBeNull();
    expect(readSession(cookie, "x".repeat(40))).toBeNull();
    expect(readSession(cookie, secret, session.expiresAt)).toBeNull();
    expect(
      readSession(signSession({ ...session, albumId: "bad" }, secret), secret),
    ).toBeNull();
    expect(readSession("null.malformed", secret)).toBeNull();
    expect(new Set(Array.from({ length: 100 }, token)).size).toBe(100);
  });
  it("rejects cross-origin or originless mutations", () => {
    expect(
      sameOrigin(
        new Request("https://candids.example/api/upload", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
    expect(sameOrigin(new Request("https://candids.example/api/upload"))).toBe(
      false,
    );
    expect(
      sameOrigin(
        new Request("https://candids.example/api/upload", {
          headers: { origin: "https://candids.example" },
        }),
      ),
    ).toBe(true);
  });
  it("bounds actual streamed bytes even when content length understates the body", async () => {
    await expect(
      boundedBody(
        new Request("https://test", {
          method: "POST",
          body: "12345",
          headers: { "content-length": "2" },
        }),
        4,
      ),
    ).rejects.toThrow();
    expect(
      (
        await boundedBody(
          new Request("https://test", { method: "POST", body: "1234" }),
          4,
        )
      ).length,
    ).toBe(4);
  });
  it("fails closed by default and never accepts local or arbitrary upstreams in production", () => {
    vi.stubEnv("CANDIDS_BRIDGE_SECRET", secret);
    vi.stubEnv("CANDIDS_COOKIE_SECRET", secret);
    vi.stubEnv("CANDIDS_PILOT_ENABLED", "false");
    vi.stubEnv("CANDIDS_CONVEX_URL", "https://test.convex.cloud");
    expect(configuration).toThrow();
    vi.stubEnv("CANDIDS_PILOT_ENABLED", "true");
    expect(configuration().httpUrl).toBe("https://test.convex.site");
    vi.stubEnv("CANDIDS_ALLOW_LOCAL", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CANDIDS_CONVEX_URL", "http://127.0.0.1:3210");
    expect(configuration).toThrow();
    vi.stubEnv("CANDIDS_CONVEX_URL", "https://internal.example");
    expect(configuration).toThrow();
  });
  it("allows only the explicit private self-hosted pair while retaining pilot and capability gates", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CANDIDS_PILOT_ENABLED", "true");
    vi.stubEnv("CANDIDS_BRIDGE_SECRET", secret);
    vi.stubEnv("CANDIDS_COOKIE_SECRET", secret);
    vi.stubEnv("CANDIDS_CONVEX_URL", "http://candids-convex:3210");
    expect(configuration).toThrow();
    vi.stubEnv("CANDIDS_SELF_HOSTED", "true");
    expect(configuration().httpUrl).toBe("http://candids-convex:3211");
    expect(configuration().selfHosted).toBe(true);
    for (const url of [
      "http://127.0.0.1:3210",
      "http://169.254.169.254",
      "http://candids-convex:3210@evil.example",
      "http://candids-convex:3210/path",
      "http://candids-convex:3211",
      "http://other-backend:3210",
    ]) {
      vi.stubEnv("CANDIDS_CONVEX_URL", url);
      expect(configuration).toThrow();
    }
    vi.stubEnv("CANDIDS_CONVEX_URL", "http://candids-convex:3210");
    vi.stubEnv("CANDIDS_PILOT_ENABLED", "false");
    expect(configuration).toThrow();
    vi.stubEnv("CANDIDS_PILOT_ENABLED", "true");
    vi.stubEnv("CANDIDS_COOKIE_SECRET", "");
    expect(configuration).toThrow();
  });
});
describe("uploaded image normalization", () => {
  it("re-encodes actual images, caps dimensions and strips embedded metadata", async () => {
    const input = await sharp({
      create: { width: 2500, height: 1500, channels: 3, background: "#3455a0" },
    })
      .withExif({ IFD0: { Artist: "private host" } })
      .jpeg()
      .toBuffer();
    const output = await normalizePhoto(input);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(2000);
    expect(meta.exif).toBeUndefined();
  });
  it("rejects mislabeled HTML/SVG, corrupt bytes and files above the body cap", async () => {
    for (const input of [
      Buffer.from("<html>not a photo</html>"),
      Buffer.from(
        '<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"/>',
      ),
      Buffer.alloc(2000001),
    ])
      await expect(normalizePhoto(input)).rejects.toThrow();
  });
});
