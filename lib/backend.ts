import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { Value } from "convex/values";
export function configuration() {
  const url = process.env.CANDIDS_CONVEX_URL || "";
  const bridgeSecret = process.env.CANDIDS_BRIDGE_SECRET || "";
  const cookieSecret = process.env.CANDIDS_COOKIE_SECRET || "";
  const local =
    process.env.NODE_ENV !== "production" &&
    process.env.CANDIDS_ALLOW_LOCAL === "true" &&
    /^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(url);
  // This is the one private Docker service in the reviewed self-hosted stack.
  // Do not turn the production exception into an arbitrary HTTP/SSRF allowlist.
  const selfHosted =
    process.env.CANDIDS_SELF_HOSTED === "true" &&
    url === "http://candids-convex:3210";
  if (
    (!local &&
      !selfHosted &&
      !/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url)) ||
    bridgeSecret.length < 32 ||
    cookieSecret.length < 32 ||
    process.env.CANDIDS_PILOT_ENABLED !== "true"
  )
    throw new Error("Pilot service is not configured");
  return {
    url,
    bridgeSecret,
    cookieSecret,
    selfHosted,
    httpUrl: selfHosted
      ? "http://candids-convex:3211"
      : local
        ? `http://127.0.0.1:${Number(new URL(url).port) + 1}`
        : url.replace(/\.cloud$/, ".site"),
  };
}
export function backend() {
  const config = configuration();
  const client = new ConvexHttpClient(config.url, {
    skipConvexDeploymentUrlCheck: config.selfHosted,
  });
  return {
    config,
    query: (name: string, args: Record<string, Value>) =>
      client.query(makeFunctionReference<"query">(`albums:${name}`), {
        ...args,
        bridgeSecret: config.bridgeSecret,
      }),
    mutation: (name: string, args: Record<string, Value>) =>
      client.mutation(makeFunctionReference<"mutation">(`albums:${name}`), {
        ...args,
        bridgeSecret: config.bridgeSecret,
      }),
  };
}
