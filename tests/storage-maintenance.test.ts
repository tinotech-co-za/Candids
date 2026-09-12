// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const inventory = makeFunctionReference<"query">(
  "storageMaintenance:inventory",
);
const remove = makeFunctionReference<"mutation">(
  "storageMaintenance:deleteReviewed",
);
const deployment = "https://synthetic-storage-fixture.convex.cloud";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  vi.stubEnv("CANDIDS_STORAGE_MAINTENANCE_ENABLED", "true");
  vi.stubEnv("CONVEX_CLOUD_URL", deployment);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const store = () =>
    t.run((ctx) => ctx.storage.store(new Blob(["synthetic-file"])));
  const storageId = await store();
  vi.setSystemTime(Date.now() + 61 * 60000);
  const report = await t.query(inventory, { deployment, cursor: null });
  const { sha256, createdAt } = report.candidates[0];
  const reviewed = { storageId, sha256, createdAt };
  return { t, storageId, store, reviewed };
}

describe("dedicated storage maintenance", () => {
  it("fails closed until explicitly enabled for the exact deployment", async () => {
    const f = await fixture();
    await expect(
      f.t.query(inventory, {
        deployment: "https://wrong.convex.cloud",
        cursor: null,
      }),
    ).rejects.toThrow();
    vi.stubEnv("CANDIDS_STORAGE_MAINTENANCE_ENABLED", "false");
    await expect(
      f.t.query(inventory, { deployment, cursor: null }),
    ).rejects.toThrow();
    await expect(
      f.t.mutation(remove, { deployment, files: [f.reviewed] }),
    ).rejects.toThrow();
    expect(
      await f.t.run((ctx) => ctx.db.system.get(f.storageId)),
    ).not.toBeNull();
  });

  it("inventories only old unreferenced files without deleting or reading file contents", async () => {
    const f = await fixture();
    const recent = await f.store();
    const report = await f.t.query(inventory, { deployment, cursor: null });
    expect(
      report.candidates.map((file: { storageId: string }) => file.storageId),
    ).toEqual([f.storageId]);
    expect(
      await f.t.run((ctx) => ctx.db.system.get(f.storageId)),
    ).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.system.get(recent))).not.toBeNull();
  });

  it("deletes only the exact reviewed old file and safely repeats a completed request", async () => {
    const f = await fixture();
    const { storageId, sha256, createdAt } = f.reviewed;
    const files = [{ storageId, sha256, createdAt }];
    expect(await f.t.mutation(remove, { deployment, files })).toEqual({
      deleted: 1,
      alreadyAbsent: 0,
    });
    expect(await f.t.mutation(remove, { deployment, files })).toEqual({
      deleted: 0,
      alreadyAbsent: 1,
    });
    expect(await f.t.run((ctx) => ctx.storage.get(f.storageId))).toBeNull();
  });

  it("rejects a changed fingerprint, duplicate batch, recent file and newly attached photo", async () => {
    const f = await fixture();
    const { storageId, sha256, createdAt } = f.reviewed;
    const reviewed = { storageId, sha256, createdAt };
    for (const files of [
      [{ ...reviewed, sha256: "changed" }],
      [{ ...reviewed, createdAt: createdAt + 1 }],
      [reviewed, reviewed],
      [],
    ])
      await expect(
        f.t.mutation(remove, { deployment, files }),
      ).rejects.toThrow();

    const recent = await f.store();
    const metadata = await f.t.run((ctx) => ctx.db.system.get(recent));
    await expect(
      f.t.mutation(remove, {
        deployment,
        files: [
          {
            storageId: recent,
            sha256: metadata!.sha256,
            createdAt: metadata!._creationTime,
          },
        ],
      }),
    ).rejects.toThrow();

    const albumId = await f.t.mutation(
      makeFunctionReference<"mutation">("albums:provision"),
      {
        name: "Synthetic retention",
        eventDate: "2026-09-12",
        expiresAt: Date.now() + 86400000,
        hostHash: "1".repeat(64),
        recoveryHash: "2".repeat(64),
        inviteHash: "3".repeat(64),
      },
    );
    await f.t.run((ctx) =>
      ctx.db.insert("albumPhotos", {
        albumId,
        storageId: f.storageId,
        size: 14,
        caption: "Attached after review",
        contributor: "Synthetic",
        createdAt: Date.now(),
      }),
    );
    await expect(
      f.t.mutation(remove, { deployment, files: [reviewed] }),
    ).rejects.toThrow();
    expect(
      (await f.t.query(inventory, { deployment, cursor: null })).candidates,
    ).toHaveLength(0);
    expect(
      await f.t.run((ctx) => ctx.db.system.get(f.storageId)),
    ).not.toBeNull();
  });
});
