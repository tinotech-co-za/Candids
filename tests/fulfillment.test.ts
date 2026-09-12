// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import type { GenericId } from "convex/values";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const paid = makeFunctionReference<"mutation">("fulfillment:provisionPaid");
const free = makeFunctionReference<"mutation">("albums:provision");
const cleanup = makeFunctionReference<"mutation">("albums:cleanup");
const status = makeFunctionReference<"query">("ops:status");
const input = () => ({
  reference: "tino-service-" + "a".repeat(32),
  transactionId: "123456789",
  requestDigest: "d".repeat(64),
  album: {
    name: "Synthetic fulfillment unit fixture",
    eventDate: "2026-09-12",
    expiresAt: Date.now() + 3600000,
    hostHash: "1".repeat(64),
    recoveryHash: "2".repeat(64),
    inviteHash: "3".repeat(64),
  },
});
describe("private managed fulfillment", () => {
  it("reuses an identical verified request once and rejects changed terms, keys or transaction", async () => {
    const t = convexTest(schema, modules),
      args = input();
    const first = await t.mutation(paid, args),
      again = await t.mutation(paid, args);
    expect(again).toEqual({ albumId: first.albumId, reused: true });
    for (const changed of [
      { ...args, requestDigest: "e".repeat(64) },
      { ...args, transactionId: "987654321" },
      { ...args, album: { ...args.album, hostHash: "4".repeat(64) } },
      {
        ...args,
        album: { ...args.album, expiresAt: args.album.expiresAt + 1000 },
      },
    ])
      await expect(t.mutation(paid, changed)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("albums").collect())).toHaveLength(
      1,
    );
    expect(
      await t.run((ctx) => ctx.db.query("albumFulfillments").collect()),
    ).toHaveLength(1);
  });
  it("keeps payment idempotency after photo expiry and prevents relabeling a transaction", async () => {
    const t = convexTest(schema, modules),
      args = input();
    const first = await t.mutation(paid, args);
    await expect(
      t.mutation(paid, {
        ...args,
        reference: "tino-service-" + "b".repeat(32),
      }),
    ).rejects.toThrow();
    await t.run((ctx) =>
      ctx.db.patch(first.albumId, { expiresAt: Date.now() - 1 }),
    );
    await t.mutation(cleanup, {});
    await expect(t.mutation(paid, args)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("albums").collect())).toHaveLength(
      0,
    );
    expect(
      await t.run((ctx) => ctx.db.query("albumFulfillments").collect()),
    ).toHaveLength(1);
  });
  it("does not regenerate delivery from capabilities changed by a host recovery", async () => {
    const t = convexTest(schema, modules),
      args = input();
    const first = await t.mutation(paid, args);
    await t.run((ctx) =>
      ctx.db.patch(first.albumId, { hostHash: "9".repeat(64) }),
    );
    await expect(t.mutation(paid, args)).rejects.toThrow(/access changed/);
  });
  it("enforces five active events for both provisioning paths while allowing an existing retry", async () => {
    const t = convexTest(schema, modules),
      args = input();
    await t.mutation(paid, args);
    for (let i = 0; i < 4; i++)
      await t.mutation(free, {
        ...args.album,
        name: `Synthetic capacity ${i}`,
      });
    await expect(t.mutation(free, args.album)).rejects.toThrow(/capacity/);
    await expect(
      t.mutation(paid, {
        ...args,
        reference: "tino-service-" + "b".repeat(32),
        transactionId: "42",
      }),
    ).rejects.toThrow(/capacity/);
    expect((await t.mutation(paid, args)).reused).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.query("albumFulfillments").collect()),
    ).toHaveLength(1);
  });
  it("records cleanup freshness without exposing an album or capability in operational status", async () => {
    const t = convexTest(schema, modules);
    expect((await t.query(status, {})).lastCleanupAt).toBe(null);
    await t.mutation(cleanup, {});
    const value = await t.query(status, {});
    expect(value.lastCleanupAt).toBeGreaterThan(0);
    expect(value).toEqual({
      activeAlbums: 0,
      managedEventCap: 5,
      overdueExpiredAlbums: 0,
      lastCleanupAt: value.lastCleanupAt,
      lastCleanupExpiredAlbums: 0,
    });
  });
  it("suspends pending and new uploads without host reopening or loss of export and retention", async () => {
    const bridgeSecret = "unit-only-bridge-secret-00000000000000000";
    vi.stubEnv("CANDIDS_BRIDGE_SECRET", bridgeSecret);
    try {
      const t = convexTest(schema, modules),
        args = input();
      const { albumId } = await t.mutation(paid, args);
      const auth = { bridgeSecret, albumId, actorHash: args.album.hostHash };
      const m = (name: string) =>
        makeFunctionReference<"mutation">(`albums:${name}`);
      const q = (name: string) =>
        makeFunctionReference<"query">(`albums:${name}`);
      const reservation = await t.mutation(m("reserveUpload"), {
        ...auth,
        size: 4,
        caption: "",
        requestId: "suspension-upload-00001",
      });
      const identity = {
        reference: args.reference,
        transactionId: args.transactionId,
      };
      const suspend = makeFunctionReference<"mutation">(
        "fulfillment:suspendUploads",
      );
      await expect(
        t.mutation(suspend, { ...identity, transactionId: "42" }),
      ).rejects.toThrow();
      await t.mutation(suspend, identity);
      await t.mutation(suspend, identity); // Ambiguous suspension is retryable.
      await expect(
        t.mutation(m("settings"), { ...auth, uploadsOpen: true }),
      ).rejects.toThrow(/suspended/);
      await expect(
        t.query(q("uploadDetails"), {
          albumId,
          actorHash: auth.actorHash,
          reservationId: reservation.reservationId,
        }),
      ).rejects.toThrow();
      await expect(
        t.mutation(m("reserveUpload"), {
          ...auth,
          size: 4,
          caption: "",
          requestId: "suspension-upload-00002",
        }),
      ).rejects.toThrow();
      await expect(t.mutation(paid, args)).rejects.toThrow(/suspended/);
      expect((await t.query(q("snapshot"), auth)).uploadsOpen).toBe(false);
      expect(await t.query(q("exportManifest"), auth)).toBeDefined();
      expect(
        (await t.run((ctx) => ctx.db.get(albumId as GenericId<"albums">)))
          ?.expiresAt,
      ).toBe(args.album.expiresAt);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
