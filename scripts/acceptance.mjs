import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { unzipSync } from "fflate";
const base = process.env.CANDIDS_TEST_URL || "http://127.0.0.1:3307";
const output = process.env.CANDIDS_QA_DIR || "/tmp/tinotech-candids-private/qa";
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
const failures = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("pageerror", () => failures.push("Page JavaScript error"));
try {
  await page.goto(base);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.screenshot({
    path: `${output}/landing-desktop.png`,
    fullPage: true,
  });
  await page.goto(`${base}/demo`);
  await page.getByRole("heading", { name: "The long-table lunch" }).waitFor();
  assert.equal(await page.locator(".photo-print").count(), 6);
  await page.screenshot({
    path: `${output}/album-desktop.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "View A place for everyone", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByLabel("Sample view").selectOption("guest");
  assert.equal(await page.locator(".photo-print").count(), 2);
  assert.equal(
    await page
      .getByRole("button", { name: "Download album ZIP", exact: true })
      .count(),
    0,
  );
  await page.getByLabel("Sample view").selectOption("host");
  await page
    .getByRole("switch", { name: "Share collection with guests" })
    .click();
  await page.getByLabel("Sample view").selectOption("guest");
  assert.equal(await page.locator(".photo-print").count(), 6);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${output}/album-mobile-guest.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByLabel("Sample view").selectOption("host");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download album ZIP", exact: true })
    .click();
  const dl = await downloadPromise;
  await dl.saveAs(`${output}/demo-album.zip`);
  assert.equal(
    Object.keys(
      unzipSync(new Uint8Array(await readFile(`${output}/demo-album.zip`))),
    ).length,
    7,
  );
  await page.setInputFiles("#photo-file", "public/demo/table.jpg");
  await page
    .getByText("Photo added to this sample tab only.", { exact: false })
    .waitFor();
  assert.equal(await page.locator(".photo-print").count(), 7);
  await page.getByText("Guest devices (3)", { exact: true }).click();
  await page
    .getByRole("button", { name: "Block & rotate invite", exact: true })
    .first()
    .click();
  await page.getByLabel("Sample view").selectOption("guest");
  assert.equal(await page.locator(".photo-print").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Choose a photo", exact: false })
      .isDisabled(),
    true,
  );
  await page.goto(base);
  await page.screenshot({
    path: `${output}/landing-mobile.png`,
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  const results = {
    sample: {
      desktop: true,
      mobile: true,
      hostGuestVisibility: true,
      photoDialog: true,
      zipEntries: 7,
      tabOnlyUpload: true,
    },
    real: null,
    browserErrors: failures.length,
  };
  if (process.env.CANDIDS_TEST_CARD) {
    const card = JSON.parse(
      await readFile(process.env.CANDIDS_TEST_CARD, "utf8"),
    );
    const hostedSynthetic =
      base === "https://candids-pilot.tinomuzambi.com" &&
      process.env.CANDIDS_TEST_ALLOW_HOSTED_SYNTHETIC === "true" &&
      card.deploymentMode === "self-hosted" &&
      card.synthetic === true &&
      card.name.startsWith("Synthetic ");
    assert.ok(
      base.startsWith("http://127.0.0.1:") || hostedSynthetic,
      "Use isolated loopback acceptance or the explicitly enabled synthetic self-hosted pilot.",
    );
    for (const url of [card.hostUrl, card.recoveryUrl, card.guestUrl])
      assert.equal(
        new URL(url).origin,
        new URL(base).origin,
        "Access cards must match the exact tested origin.",
      );
    const host = await context.newPage();
    await host.goto(card.hostUrl);
    await host.getByRole("button", { name: "Open album", exact: true }).click();
    await host.getByRole("heading", { name: card.name, exact: true }).waitFor();
    await host.setInputFiles("#photo-file", "public/demo/table.jpg");
    await host.getByText("Your photo was added.", { exact: true }).waitFor();
    const hostSnapshot = await host.evaluate(() =>
      fetch("/api/album").then((r) => r.json()),
    );
    assert.equal(hostSnapshot.photos.length, 1);
    const photoId = hostSnapshot.photos[0].id;
    const stranger = await browser.newContext();
    assert.equal(
      (await stranger.request.get(`${base}/api/photo/${photoId}`)).status(),
      401,
    );
    const guestContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const guest = await guestContext.newPage();
    await guest.goto(card.guestUrl);
    await guest.getByLabel("Your display name").fill("Synthetic guest");
    await guest.getByRole("checkbox").check();
    await guest
      .getByRole("button", { name: "Open album", exact: true })
      .click();
    await guest
      .getByRole("heading", { name: card.name, exact: true })
      .waitFor();
    assert.equal(await guest.locator(".photo-print").count(), 0);
    assert.equal(
      (await guestContext.request.get(`${base}/api/photo/${photoId}`)).status(),
      404,
    );
    await guest.setInputFiles("#photo-file", "public/demo/flowers.jpg");
    await guest.getByText("Your photo was added.", { exact: true }).waitFor();
    assert.equal(await guest.locator(".photo-print").count(), 1);
    await host
      .getByRole("switch", { name: "Share collection with guests" })
      .click();
    await guest.getByRole("button", { name: "Refresh", exact: true }).click();
    await guest.waitForFunction(
      () => document.querySelectorAll(".photo-print").length === 2,
    );
    assert.equal(
      (await guestContext.request.get(`${base}/api/photo/${photoId}`)).status(),
      200,
    );
    const exported = host.waitForEvent("download");
    await host
      .getByRole("button", { name: "Download album ZIP", exact: true })
      .click();
    await (await exported).saveAs(`${output}/real-synthetic-album.zip`);
    assert.equal(
      Object.keys(
        unzipSync(
          new Uint8Array(await readFile(`${output}/real-synthetic-album.zip`)),
        ),
      ).length,
      3,
    );
    const restoredContext = await browser.newContext();
    const restored = await restoredContext.newPage();
    await restored.goto(card.recoveryUrl);
    await restored
      .getByRole("button", { name: "Recover host access", exact: true })
      .last()
      .click();
    await restored
      .getByRole("heading", {
        name: "Keep your new recovery card.",
        exact: true,
      })
      .waitFor();
    assert.equal(
      (await context.request.get(`${base}/api/album`)).status(),
      403,
    );
    const recoveryDownload = restored.waitForEvent("download");
    await restored
      .getByRole("button", {
        name: "Download private recovery card",
        exact: true,
      })
      .click();
    await (
      await recoveryDownload
    ).saveAs(`${output}/recovered-private-card.json`);
    await chmod(`${output}/recovered-private-card.json`, 0o600);
    await restored.getByText("Guest devices (1)", { exact: true }).click();
    await restored
      .getByRole("button", { name: "Block & rotate invite", exact: true })
      .click();
    await restored
      .getByRole("button", { name: "Blocked", exact: true })
      .waitFor();
    assert.equal(
      (await guestContext.request.get(`${base}/api/photo/${photoId}`)).status(),
      404,
    );
    const forbidden = await guestContext.request.post(`${base}/api/settings`, {
      headers: { origin: base },
      data: { action: "share", value: false },
    });
    assert.equal(forbidden.status(), 403);
    results.real = {
      hostAccess: true,
      guestConsent: true,
      hostAndGuestUpload: true,
      unsharedBinaryDenied: true,
      sharedBinaryAllowed: true,
      zipEntries: 3,
      recoveryRevokesOldHost: true,
      blockedGuestBinaryDenied: true,
      guestMutationDenied: true,
    };
    await stranger.close();
    await guestContext.close();
    await restoredContext.close();
  }
  assert.equal(failures.length, 0);
  await writeFile(
    `${output}/acceptance.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
