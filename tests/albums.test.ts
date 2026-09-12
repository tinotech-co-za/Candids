// @vitest-environment edge-runtime
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../convex/schema";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const q = (name: string) => makeFunctionReference<"query">(`albums:${name}`);
const m = (name: string) => makeFunctionReference<"mutation">(`albums:${name}`);
const bridgeSecret = "test-only-bridge-secret-000000000000000000";
const host = "1".repeat(64),
  recovery = "2".repeat(64),
  invite = "3".repeat(64),
  guest = "4".repeat(64),
  secondGuest = "5".repeat(64);
beforeEach(() => {
  vi.stubEnv("CANDIDS_BRIDGE_SECRET", bridgeSecret);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function fixture() {
  const t = convexTest(schema, modules);
  const albumId = await t.mutation(m("provision"), {
    name: "Synthetic acceptance",
    eventDate: "2026-09-12",
    expiresAt: Date.now() + 86400000,
    hostHash: host,
    recoveryHash: recovery,
    inviteHash: invite,
  });
  const auth = { bridgeSecret, albumId, actorHash: host };
  const join = (
    freshHash = guest,
    keyHash = invite,
    kind = "guest",
    rateKey = "a".repeat(64),
  ) =>
    t.mutation(m("access"), {
      bridgeSecret,
      albumId,
      keyHash,
      kind,
      freshHash,
      freshRecoveryHash: "b".repeat(64),
      name: "Guest",
      rateKey,
    });
  const addPhoto = async (
    actorHash = host,
    requestId = "upload-request-00001",
  ) => {
    const reservation = await t.mutation(m("reserveUpload"), {
      ...auth,
      actorHash,
      size: 4,
      caption: "Synthetic photo",
      requestId,
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([255, 216, 255, 217])], {
          type: "image/jpeg",
        }),
      ),
    );
    // convex-test 0.0.58 omits contentType on stored Blob metadata. Seed the
    // completed record for access tests; the real local HTTP acceptance covers finishUpload.
    const photoId = await t.run(async (ctx) => {
      const reserved = await ctx.db.get(
        reservation.reservationId as GenericId<"albumUploads">,
      );
      const id = await ctx.db.insert("albumPhotos", {
        albumId,
        ...(reserved?.memberId ? { memberId: reserved.memberId } : {}),
        storageId,
        size: 4,
        caption: "Synthetic photo",
        contributor: "Guest",
        createdAt: Date.now(),
      });
      await ctx.db.patch(reservation.reservationId, {
        status: "complete",
        photoId: id,
      });
      return id;
    });
    return { photoId, storageId, reservation };
  };
  return { t, albumId, auth, join, addPhoto };
}
describe("managed album authorization", () => {
  it("requires the bridge and isolates guessed IDs and member tokens across albums", async () => {
    const f = await fixture();
    await f.join();
    await expect(
      f.t.query(q("snapshot"), { ...f.auth, bridgeSecret: "invalid" }),
    ).rejects.toThrow();
    const other = await f.t.mutation(m("provision"), {
      name: "Other",
      eventDate: "2026-09-12",
      expiresAt: Date.now() + 86400000,
      hostHash: "6".repeat(64),
      recoveryHash: "7".repeat(64),
      inviteHash: "8".repeat(64),
    });
    await expect(
      f.t.query(q("snapshot"), { ...f.auth, albumId: other, actorHash: guest }),
    ).rejects.toThrow();
    await expect(
      f.t.mutation(m("settings"), {
        ...f.auth,
        actorHash: guest,
        shared: true,
      }),
    ).rejects.toThrow();
    await expect(
      f.t.query(q("exportManifest"), { ...f.auth, actorHash: guest }),
    ).rejects.toThrow();
  });
  it("hides host photos before sharing and rechecks binary access after closing sharing or blocking a guest", async () => {
    const f = await fixture();
    await f.join();
    const photo = await f.addPhoto();
    expect(
      (await f.t.query(q("snapshot"), { ...f.auth, actorHash: guest })).photos,
    ).toHaveLength(0);
    await expect(
      f.t.query(q("fileDetails"), {
        albumId: f.albumId,
        actorHash: guest,
        photoId: photo.photoId,
      }),
    ).rejects.toThrow();
    await f.t.mutation(m("settings"), { ...f.auth, shared: true });
    expect(
      (
        await f.t.query(q("fileDetails"), {
          albumId: f.albumId,
          actorHash: guest,
          photoId: photo.photoId,
        })
      ).storageId,
    ).toBe(photo.storageId);
    const snapshot = await f.t.query(q("snapshot"), f.auth);
    expect(JSON.stringify(snapshot)).not.toContain(photo.storageId);
    expect(JSON.stringify(snapshot)).not.toContain(host);
    await f.t.mutation(m("settings"), { ...f.auth, shared: false });
    await expect(
      f.t.query(q("fileDetails"), {
        albumId: f.albumId,
        actorHash: guest,
        photoId: photo.photoId,
      }),
    ).rejects.toThrow();
    await f.t.mutation(m("settings"), {
      ...f.auth,
      shared: true,
      blockMemberId: snapshot.members[0].id,
      inviteHash: "9".repeat(64),
    });
    await expect(
      f.t.query(q("snapshot"), { ...f.auth, actorHash: guest }),
    ).rejects.toThrow();
    expect((await f.join(secondGuest)).error).toBe("invalid_access");
  });
  it("allows guests to see and remove only their own unshared photos", async () => {
    const f = await fixture();
    await f.join();
    await f.join(secondGuest);
    const photo = await f.addPhoto(guest);
    expect(
      (await f.t.query(q("snapshot"), { ...f.auth, actorHash: guest })).photos,
    ).toHaveLength(1);
    await expect(
      f.t.mutation(m("deletePhoto"), {
        ...f.auth,
        actorHash: secondGuest,
        photoId: photo.photoId,
      }),
    ).rejects.toThrow();
    await f.t.mutation(m("deletePhoto"), {
      ...f.auth,
      actorHash: guest,
      photoId: photo.photoId,
    });
    expect(await f.t.run((ctx) => ctx.storage.get(photo.storageId))).toBeNull();
  });
  it("recovery revokes old host and recovery keys; existing guest access survives", async () => {
    const f = await fixture();
    await f.join();
    const restored = await f.join("c".repeat(64), recovery, "recovery");
    expect(restored.role).toBe("host");
    await expect(f.t.query(q("snapshot"), f.auth)).rejects.toThrow();
    expect(
      (await f.t.query(q("snapshot"), { ...f.auth, actorHash: "c".repeat(64) }))
        .role,
    ).toBe("host");
    expect((await f.join("d".repeat(64), recovery, "recovery")).error).toBe(
      "invalid_access",
    );
    expect(
      (await f.t.query(q("snapshot"), { ...f.auth, actorHash: guest })).role,
    ).toBe("guest");
  });
  it("admits fifty guest devices on one venue IP without consuming the failure limit", async () => {
    const f = await fixture();
    for (let i = 10; i < 60; i++)
      expect((await f.join(i.toString(16).padStart(64, "0"))).role).toBe(
        "guest",
      );
    expect((await f.join("e".repeat(64))).error).toBe("guest_limit");
    expect((await f.join("f".repeat(64), host, "host")).role).toBe("host");
  });
  it("retains failed access attempts and enforces the durable rate limit", async () => {
    const f = await fixture();
    for (let i = 0; i < 20; i++)
      expect((await f.join(guest, "f".repeat(64))).error).toBe(
        "invalid_access",
      );
    expect((await f.join()).error).toBe("too_many_attempts");
  });
});
describe("upload quotas and retention", () => {
  it("preserves a committed photo when finalization's response is lost", async () => {
    const f = await fixture();
    const photo = await f.addPhoto();
    expect(
      await f.t.mutation(m("reconcileStoredUpload"), {
        albumId: f.albumId,
        actorHash: host,
        reservationId: photo.reservation.reservationId,
        storageId: photo.storageId,
      }),
    ).toEqual({ deleted: false });
    expect(
      await f.t.run((ctx) => ctx.db.system.get(photo.storageId)),
    ).not.toBeNull();
    expect((await f.t.query(q("snapshot"), f.auth)).photoCount).toBe(1);
  });
  it("removes an uncommitted file and releases its reservation exactly once", async () => {
    const f = await fixture();
    const reservation = await f.t.mutation(m("reserveUpload"), {
      ...f.auth,
      size: 4,
      caption: "Failed upload",
      requestId: "failed-request-00001",
    });
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array([255, 216, 255, 217])])),
    );
    const args = {
      albumId: f.albumId,
      actorHash: host,
      reservationId: reservation.reservationId,
      storageId,
    };
    await expect(
      f.t.mutation(m("reconcileStoredUpload"), { ...args, actorHash: guest }),
    ).rejects.toThrow();
    expect(await f.t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();
    await f.t.mutation(m("reconcileStoredUpload"), args);
    await f.t.mutation(m("reconcileStoredUpload"), args);
    expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    expect((await f.t.query(q("snapshot"), f.auth)).photoCount).toBe(0);
  });
  it("reserves quota atomically, rejects changed idempotency payload and releases failures only once", async () => {
    const f = await fixture();
    const args = {
      ...f.auth,
      size: 100,
      caption: "Test",
      requestId: "upload-request-00001",
    };
    const one = await f.t.mutation(m("reserveUpload"), args);
    const two = await f.t.mutation(m("reserveUpload"), args);
    expect(two.reservationId).toBe(one.reservationId);
    expect((await f.t.query(q("snapshot"), f.auth)).photoCount).toBe(1);
    await expect(
      f.t.mutation(m("reserveUpload"), { ...args, size: 101 }),
    ).rejects.toThrow();
    await f.t.mutation(m("cancelUpload"), {
      ...f.auth,
      reservationId: one.reservationId,
    });
    await f.t.mutation(m("cancelUpload"), {
      ...f.auth,
      reservationId: one.reservationId,
    });
    expect((await f.t.query(q("snapshot"), f.auth)).photoCount).toBe(0);
    await f.t.run((ctx) => ctx.db.patch(f.albumId, { photoCount: 99 }));
    const results = await Promise.allSettled(
      ["second-request-0001", "third-request-00001"].map((requestId) =>
        f.t.mutation(m("reserveUpload"), { ...args, requestId }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("enforces guest limits and rechecks closed albums at upload completion", async () => {
    const f = await fixture();
    await f.join();
    const snapshot = await f.t.query(q("snapshot"), f.auth);
    await f.t.run((ctx) =>
      ctx.db.patch(snapshot.members[0].id, { photoCount: 20 }),
    );
    await expect(
      f.t.mutation(m("reserveUpload"), {
        ...f.auth,
        actorHash: guest,
        size: 4,
        caption: "Test",
        requestId: "upload-request-00001",
      }),
    ).rejects.toThrow();
    const reserved = await f.t.mutation(m("reserveUpload"), {
      ...f.auth,
      size: 4,
      caption: "Test",
      requestId: "upload-request-00001",
    });
    await f.t.mutation(m("settings"), { ...f.auth, uploadsOpen: false });
    await expect(
      f.t.query(q("uploadDetails"), {
        albumId: f.albumId,
        actorHash: host,
        reservationId: reserved.reservationId,
      }),
    ).rejects.toThrow();
  });
  it("expires access immediately and cleans the new event's files and rows without touching legacy tables", async () => {
    const f = await fixture();
    await f.join();
    const photo = await f.addPhoto();
    await f.t.run((ctx) =>
      ctx.db.patch(f.albumId, { expiresAt: Date.now() - 1 }),
    );
    await expect(f.t.query(q("snapshot"), f.auth)).rejects.toThrow();
    await expect(
      f.t.query(q("fileDetails"), {
        albumId: f.albumId,
        actorHash: host,
        photoId: photo.photoId,
      }),
    ).rejects.toThrow();
    expect((await f.t.mutation(m("cleanup"), {})).expiredAlbums).toBe(1);
    expect(await f.t.run((ctx) => ctx.storage.get(photo.storageId))).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("albumMembers").collect()),
    ).toHaveLength(0);
    expect(
      await f.t.run((ctx) => ctx.db.query("albumUploads").collect()),
    ).toHaveLength(0);
  });
  it("reclaims expired reservations even with older completed reservations", async () => {
    const f = await fixture();
    await f.addPhoto();
    const reserved = await f.t.mutation(m("reserveUpload"), {
      ...f.auth,
      size: 4,
      caption: "Test",
      requestId: "second-request-00001",
    });
    await f.t.run((ctx) =>
      ctx.db.patch(reserved.reservationId, { expiresAt: Date.now() - 1 }),
    );
    await f.t.mutation(m("cleanup"), {});
    expect((await f.t.query(q("snapshot"), f.auth)).photoCount).toBe(1);
  });
});
