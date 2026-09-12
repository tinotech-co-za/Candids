import { randomBytes, createHash } from "node:crypto";
import { readFile, open, chmod } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
const [mode, inputPath, outputPath] = process.argv.slice(2);
if (
  !["--local", "--prod", "--self-hosted"].includes(mode) ||
  !inputPath ||
  !outputPath ||
  !isAbsolute(outputPath) ||
  resolve(outputPath).startsWith(`${process.cwd()}/`)
) {
  throw new Error(
    "Usage: node scripts/provision.mjs --local|--prod|--self-hosted INPUT.json /absolute/private/output.json (outside checkout)",
  );
}
const input = JSON.parse(await readFile(inputPath, "utf8"));
const origin = new URL(input.origin);
if (
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password ||
  (mode !== "--local"
    ? origin.protocol !== "https:"
    : origin.hostname !== "127.0.0.1")
)
  throw new Error(
    "Use the exact HTTPS app origin, or 127.0.0.1 for isolated local testing",
  );
let operatorFile;
if (mode === "--self-hosted") {
  operatorFile = process.env.CANDIDS_SELF_HOSTED_ENV;
  if (
    !operatorFile ||
    !isAbsolute(operatorFile) ||
    resolve(operatorFile).startsWith(`${process.cwd()}/`)
  )
    throw new Error(
      "Self-hosted provisioning requires a private operator env file outside the checkout.",
    );
  const selected = parse(await readFile(operatorFile, "utf8"));
  if (
    selected.CONVEX_SELF_HOSTED_URL !== "http://127.0.0.1:43210" ||
    !selected.CONVEX_SELF_HOSTED_ADMIN_KEY ||
    selected.CONVEX_DEPLOYMENT ||
    selected.CONVEX_DEPLOY_KEY
  )
    throw new Error(
      "Use the dedicated SSH tunnel and self-hosted admin credential; cloud deployment selectors are not accepted.",
    );
}
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
      ...(operatorFile ? ["--env-file", operatorFile] : []),
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
        deploymentMode: mode.slice(2),
        synthetic: input.synthetic === true,
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
