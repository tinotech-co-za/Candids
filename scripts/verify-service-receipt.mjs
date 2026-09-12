// Private operator helper: stdout is captured by fulfill-paid.py, never sent
// to a browser or a delivery recipient. This helper has no initialize/send call.
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const modulePath =
  "/srv/Developer/GitHub/tinotech-co-za/tinotech/apps/web/lib/service-payments.mjs";
const reviewedHash =
  "6cb187fbc4e6d3e73d48161957f9d12bf633755609ec7b2d9ffb8c79271308b7";
try {
  const [reference, envPath] = process.argv.slice(2);
  if (
    !/^tino-service-[a-f0-9]{32}$/.test(reference || "") ||
    !envPath ||
    resolve(envPath).startsWith(`${process.cwd()}/`) ||
    ((await stat(envPath)).mode & 0o077) !== 0
  )
    throw new Error("Private verifier configuration required");
  const source = await readFile(modulePath);
  if (createHash("sha256").update(source).digest("hex") !== reviewedHash)
    throw new Error("Review the changed canonical verifier before fulfillment");
  process.loadEnvFile(envPath);
  if (
    process.env.TINOTECH_PAYMENTS_URL !==
      "https://www.tinotech.co.za/api/payments/paystack" ||
    process.env.PAYSTACK_MODE !== "live" ||
    process.env.PAYSTACK_SECRET_KEY
  )
    throw new Error(
      "Use only the live SERVICES operator gateway configuration",
    );
  const { paymentConfig, fetchServiceReceipt } = await import(
    pathToFileURL(modulePath).href
  );
  const receipt = await fetchServiceReceipt(reference, paymentConfig());
  process.stdout.write(JSON.stringify(receipt));
} catch {
  process.stderr.write(
    "Fresh service receipt verification failed; no provisioning was attempted.\n",
  );
  process.exitCode = 1;
}
