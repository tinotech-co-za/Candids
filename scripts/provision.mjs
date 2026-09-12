import { randomBytes, createHash } from "node:crypto";
import { readFile, open, chmod } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const [mode, inputPath, outputPath] = process.argv.slice(2);
if (
  !["--local", "--prod"].includes(mode) ||
  !inputPath ||
  !outputPath ||
  !isAbsolute(outputPath) ||
  resolve(outputPath).startsWith(`${process.cwd()}/`)
) {
  throw new Error(
    "Usage: node scripts/provision.mjs --local|--prod INPUT.json /absolute/private/output.json (outside checkout)",
  );
}
const input = JSON.parse(await readFile(inputPath, "utf8"));
const origin = new URL(input.origin);
if (
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  (mode === "--prod"
    ? origin.protocol !== "https:"
    : origin.hostname !== "127.0.0.1")
)
  throw new Error(
    "Use the exact HTTPS app origin, or 127.0.0.1 for isolated local testing",
  );
if (
  mode === "--local" &&
  !(await readFile(".env.local", "utf8")).match(
    /^CONVEX_DEPLOYMENT=anonymous:/m,
  )
)
  throw new Error(
    "Local provisioning requires a selected anonymous local Convex deployment",
  );
const hostKey = randomBytes(32).toString("base64url"),
  recoveryKey = randomBytes(32).toString("base64url"),
  inviteKey = randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const args = {
  name: input.name,
  eventDate: input.eventDate,
  expiresAt: Date.parse(input.expiresAt),
  hostHash: hash(hostKey),
  recoveryHash: hash(recoveryKey),
  inviteHash: hash(inviteKey),
};
if (!Number.isFinite(args.expiresAt))
  throw new Error("An explicit ISO expiry is required");
const file = await open(outputPath, "wx", 0o600);
try {
  const result = spawnSync(
    "npx",
    [
      "convex",
      "run",
      "albums:provision",
      JSON.stringify(args),
      ...(mode === "--prod" ? ["--prod"] : []),
    ],
    { encoding: "utf8", timeout: 90000 },
  );
  if (result.status !== 0)
    throw new Error(
      "Provisioning failed. Check the selected deployment and its authenticated CLI configuration. No access keys were printed.",
    );
  const albumId = JSON.parse(result.stdout.trim());
  if (typeof albumId !== "string" || !/^[a-zA-Z0-9]{16,64}$/.test(albumId))
    throw new Error(
      "Unexpected album identifier; inspect this isolated deployment before retrying",
    );
  const base = `${origin.origin}/event/${albumId}`;
  await file.writeFile(
    JSON.stringify(
      {
        albumId,
        name: args.name,
        eventDate: args.eventDate,
        expiresAt: input.expiresAt,
        hostKey,
        recoveryKey,
        hostUrl: `${base}#host=${hostKey}`,
        recoveryUrl: `${base}#recovery=${recoveryKey}`,
        guestUrl: `${base}#guest=${inviteKey}`,
      },
      null,
      2,
    ) + "\n",
  );
  await chmod(outputPath, 0o600);
  console.log(
    "Album provisioned. Private host, recovery and guest access saved to the requested file. Deliver only to the verified quote contact through an agreed private channel.",
  );
} finally {
  await file.close();
}
