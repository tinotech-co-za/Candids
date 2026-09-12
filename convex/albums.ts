import { v, type GenericId } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./functions";

export const LIMITS = {
  photos: 100,
  guests: 50,
  guestPhotos: 20,
  bytes: 200_000_000,
  photoBytes: 2_000_000,
  lifetimeUploads: 200,
};
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const authArgs = {
  bridgeSecret: v.string(),
  albumId: v.id("albums"),
  actorHash: v.string(),
};

export function verifyBridge(value: string) {
  const expected = process.env.CANDIDS_BRIDGE_SECRET;
  if (!expected || expected.length < 32 || value.length !== expected.length)
    throw new Error("Unavailable");
  let difference = 0;
  for (let i = 0; i < value.length; i++)
    difference |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference) throw new Error("Unavailable");
}

async function actor(
  ctx: QueryCtx | MutationCtx,
  albumId: GenericId<"albums">,
  actorHash: string,
) {
  if (!hash(actorHash)) throw new Error("Access denied");
  const album = await ctx.db.get(albumId);
  if (!album || album.expiresAt <= Date.now())
    throw new Error("Album unavailable");
  if (album.hostHash === actorHash)
    return { album, member: null, role: "host" as const };
  const member = await ctx.db
    .query("albumMembers")
    .withIndex("by_token", (q) => q.eq("tokenHash", actorHash))
    .unique();
  if (!member || member.albumId !== albumId || member.blocked)
    throw new Error("Access denied");
  return { album, member, role: "guest" as const };
}

export const provision = internalMutation({
  args: {
    name: v.string(),
    eventDate: v.string(),
    expiresAt: v.number(),
    hostHash: v.string(),
    recoveryHash: v.string(),
    inviteHash: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !args.name.trim() ||
      args.name.length > 80 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(args.eventDate) ||
      !Number.isFinite(Date.parse(args.eventDate + "T12:00:00Z")) ||
      new Date(args.eventDate + "T12:00:00Z").toISOString().slice(0, 10) !==
        args.eventDate ||
      args.expiresAt <= Date.now() ||
      args.expiresAt > Date.now() + 30 * 86400000 ||
      ![args.hostHash, args.recoveryHash, args.inviteHash].every(hash) ||
      new Set([args.hostHash, args.recoveryHash, args.inviteHash]).size !== 3
    )
      throw new Error("Invalid pilot setup");
    return ctx.db.insert("albums", {
      ...args,
      name: args.name.trim(),
      createdAt: Date.now(),
      shared: false,
      uploadsOpen: true,
      photoCount: 0,
      byteCount: 0,
      memberCount: 0,
      uploadCount: 0,
    });
  },
});

export const access = mutation({
  args: {
    bridgeSecret: v.string(),
    albumId: v.id("albums"),
    keyHash: v.string(),
    kind: v.union(v.literal("host"), v.literal("guest"), v.literal("recovery")),
    freshHash: v.string(),
    freshRecoveryHash: v.string(),
    name: v.string(),
    rateKey: v.string(),
  },
  handler: async (ctx, args) => {
    verifyBridge(args.bridgeSecret);
    if (
      ![
        args.keyHash,
        args.freshHash,
        args.freshRecoveryHash,
        args.rateKey,
      ].every(hash)
    )
      return { error: "invalid_access" };
    const bucket = `${Math.floor(Date.now() / 3600000)}:${args.rateKey}`;
    const attempt = await ctx.db
      .query("albumAttempts")
      .withIndex("by_key", (q) => q.eq("key", bucket))
      .unique();
    if (attempt && attempt.count >= 20) return { error: "too_many_attempts" };
    const fail = async (error: string) => {
      if (attempt)
        await ctx.db.patch(attempt._id, { count: attempt.count + 1 });
      else
        await ctx.db.insert("albumAttempts", {
          key: bucket,
          count: 1,
          expiresAt: Date.now() + 7200000,
        });
      return { error };
    };
    // Persist failures, not successful guest entries: fifty guests can share
    // the venue's public IP without exhausting the failed-access allowance.
    const album = await ctx.db.get(args.albumId);
    if (!album || album.expiresAt <= Date.now())
      return fail("album_unavailable");
    if (args.kind === "host" && album.hostHash === args.keyHash)
      return {
        role: "host",
        actorHash: args.keyHash,
        expiresAt: album.expiresAt,
      };
    if (args.kind === "recovery" && album.recoveryHash === args.keyHash) {
      await ctx.db.patch(album._id, {
        hostHash: args.freshHash,
        recoveryHash: args.freshRecoveryHash,
      });
      return {
        role: "host",
        actorHash: args.freshHash,
        expiresAt: album.expiresAt,
        recovered: true,
      };
    }
    if (args.kind !== "guest" || album.inviteHash !== args.keyHash)
      return fail("invalid_access");
    if (!album.uploadsOpen) return fail("guest_entry_closed");
    if (album.memberCount >= LIMITS.guests) return fail("guest_limit");
    const name = args.name.trim().replace(/[\x00-\x1f\x7f]/g, "");
    if (!name || name.length > 40) return fail("invalid_name");
    await ctx.db.insert("albumMembers", {
      albumId: album._id,
      tokenHash: args.freshHash,
      name,
      blocked: false,
      photoCount: 0,
      joinedAt: Date.now(),
    });
    await ctx.db.patch(album._id, { memberCount: album.memberCount + 1 });
    return {
      role: "guest",
      actorHash: args.freshHash,
      expiresAt: album.expiresAt,
    };
  },
});

export const snapshot = query({
  args: authArgs,
  handler: async (ctx, args) => {
    verifyBridge(args.bridgeSecret);
    const { album, member, role } = await actor(
      ctx,
      args.albumId,
      args.actorHash,
    );
    const photos = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", album._id))
      .take(LIMITS.photos);
    const visible = photos.filter(
      (photo) =>
        role === "host" || album.shared || photo.memberId === member?._id,
    );
    const members =
      role === "host"
        ? await ctx.db
            .query("albumMembers")
            .withIndex("by_album", (q) => q.eq("albumId", album._id))
            .take(LIMITS.guests)
        : [];
    return {
      id: album._id,
      name: album.name,
      eventDate: album.eventDate,
      expiresAt: album.expiresAt,
      shared: album.shared,
      uploadsOpen: album.uploadsOpen,
      role,
      guestName: member?.name || "Host",
      photoCount: role === "host" ? album.photoCount : visible.length,
      remainingUploads: member
        ? LIMITS.guestPhotos - member.photoCount
        : LIMITS.photos - album.photoCount,
      photos: visible.map((photo) => ({
        id: photo._id,
        caption: photo.caption,
        contributor: photo.contributor,
        createdAt: photo.createdAt,
        size: photo.size,
        canDelete: role === "host" || photo.memberId === member?._id,
      })),
      members: members.map((person) => ({
        id: person._id,
        name: person.name,
        blocked: person.blocked,
      })),
      limits: LIMITS,
    };
  },
});

export const settings = mutation({
  args: {
    ...authArgs,
    shared: v.optional(v.boolean()),
    uploadsOpen: v.optional(v.boolean()),
    inviteHash: v.optional(v.string()),
    blockMemberId: v.optional(v.id("albumMembers")),
  },
  handler: async (ctx, args) => {
    verifyBridge(args.bridgeSecret);
    const { album, role } = await actor(ctx, args.albumId, args.actorHash);
    if (role !== "host") throw new Error("Host access required");
    if (args.inviteHash !== undefined && !hash(args.inviteHash))
      throw new Error("Invalid invite");
    if (args.blockMemberId) {
      const member = await ctx.db.get(args.blockMemberId);
      if (!member || member.albumId !== album._id)
        throw new Error("Member unavailable");
      await ctx.db.patch(member._id, { blocked: true });
    }
    await ctx.db.patch(album._id, {
      ...(args.shared !== undefined ? { shared: args.shared } : {}),
      ...(args.uploadsOpen !== undefined
        ? { uploadsOpen: args.uploadsOpen }
        : {}),
      ...(args.inviteHash ? { inviteHash: args.inviteHash } : {}),
    });
  },
});

export const reserveUpload = mutation({
  args: {
    ...authArgs,
    size: v.number(),
    requestId: v.string(),
    caption: v.string(),
  },
  handler: async (ctx, args) => {
    verifyBridge(args.bridgeSecret);
    const { album, member } = await actor(ctx, args.albumId, args.actorHash);
    if (
      !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId) ||
      !Number.isInteger(args.size) ||
      args.size < 4 ||
      args.size > LIMITS.photoBytes ||
      args.caption.length > 80
    )
      throw new Error("Invalid photo");
    const previous = await ctx.db
      .query("albumUploads")
      .withIndex("by_request", (q) =>
        q
          .eq("albumId", album._id)
          .eq("actorHash", args.actorHash)
          .eq("requestId", args.requestId),
      )
      .unique();
    if (previous) {
      if (previous.size !== args.size || previous.caption !== args.caption)
        throw new Error("Upload request changed");
      return {
        reservationId: previous._id,
        status: previous.status,
        photoId: previous.photoId,
      };
    }
    if (
      !album.uploadsOpen ||
      album.photoCount >= LIMITS.photos ||
      album.byteCount + args.size > LIMITS.bytes ||
      album.uploadCount >= LIMITS.lifetimeUploads ||
      (member && member.photoCount >= LIMITS.guestPhotos)
    )
      throw new Error("Upload limit reached or album closed");
    const reservationId = await ctx.db.insert("albumUploads", {
      albumId: album._id,
      ...(member ? { memberId: member._id } : {}),
      actorHash: args.actorHash,
      requestId: args.requestId,
      size: args.size,
      caption: args.caption.trim(),
      contributor: member?.name || "Host",
      status: "reserved",
      expiresAt: Date.now() + 5 * 60000,
    });
    await ctx.db.patch(album._id, {
      photoCount: album.photoCount + 1,
      byteCount: album.byteCount + args.size,
      uploadCount: album.uploadCount + 1,
    });
    if (member)
      await ctx.db.patch(member._id, { photoCount: member.photoCount + 1 });
    return { reservationId, status: "reserved" };
  },
});

export const uploadDetails = internalQuery({
  args: {
    albumId: v.id("albums"),
    actorHash: v.string(),
    reservationId: v.id("albumUploads"),
  },
  handler: async (ctx, args) => {
    const { album } = await actor(ctx, args.albumId, args.actorHash);
    const item = await ctx.db.get(args.reservationId);
    if (
      !album.uploadsOpen ||
      !item ||
      item.albumId !== album._id ||
      item.actorHash !== args.actorHash ||
      item.status !== "reserved" ||
      item.expiresAt <= Date.now()
    )
      throw new Error("Upload unavailable");
    return item;
  },
});

export const finishUpload = internalMutation({
  args: {
    albumId: v.id("albums"),
    actorHash: v.string(),
    reservationId: v.id("albumUploads"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const { album } = await actor(ctx, args.albumId, args.actorHash);
    const item = await ctx.db.get(args.reservationId);
    const storage = await ctx.db.system.get(args.storageId);
    if (
      !album.uploadsOpen ||
      !item ||
      item.albumId !== album._id ||
      item.actorHash !== args.actorHash ||
      item.status !== "reserved" ||
      item.expiresAt <= Date.now() ||
      !storage ||
      storage._creationTime < item._creationTime ||
      storage.size !== item.size ||
      storage.contentType !== "image/jpeg"
    )
      throw new Error("Upload unavailable");
    const reused = await ctx.db
      .query("albumPhotos")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (reused) throw new Error("Photo already used");
    const photoId = await ctx.db.insert("albumPhotos", {
      albumId: album._id,
      ...(item.memberId ? { memberId: item.memberId } : {}),
      storageId: args.storageId,
      caption: item.caption,
      contributor: item.contributor,
      size: item.size,
      createdAt: Date.now(),
    });
    await ctx.db.patch(item._id, { status: "complete", photoId });
    return photoId;
  },
});

async function release(ctx: MutationCtx, id: GenericId<"albumUploads">) {
  const item = await ctx.db.get(id);
  if (!item || item.status !== "reserved") return;
  const album = await ctx.db.get(item.albumId);
  const member = item.memberId ? await ctx.db.get(item.memberId) : null;
  if (album)
    await ctx.db.patch(album._id, {
      photoCount: Math.max(0, album.photoCount - 1),
      byteCount: Math.max(0, album.byteCount - item.size),
    });
  if (member)
    await ctx.db.patch(member._id, {
      photoCount: Math.max(0, member.photoCount - 1),
    });
  await ctx.db.patch(item._id, { status: "failed" });
}

// An action can lose the response after finishUpload has committed. Recheck
// ownership in the same transaction as deletion; never delete blindly in catch.
export const reconcileStoredUpload = internalMutation({
  args: {
    albumId: v.id("albums"),
    actorHash: v.string(),
    reservationId: v.id("albumUploads"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const attached = await ctx.db
      .query("albumPhotos")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (attached) return { deleted: false };
    const reservation = await ctx.db.get(args.reservationId);
    if (
      reservation &&
      (reservation.albumId !== args.albumId ||
        reservation.actorHash !== args.actorHash)
    )
      throw new Error("Upload unavailable");
    if (await ctx.db.system.get(args.storageId))
      await ctx.storage.delete(args.storageId);
    if (reservation) await release(ctx, reservation._id);
    return { deleted: true };
  },
});

export const cancelUpload = mutation({
  args: { ...authArgs, reservationId: v.id("albumUploads") },
  handler: async (ctx, args) => {
    verifyBridge(args.bridgeSecret);
    const item = await ctx.db.get(args.reservationId);
    if (item?.albumId !== args.albumId || item.actorHash !== args.actorHash)
      throw new Error("Upload unavailable");
    await release(ctx, item._id);
  },
});

export const fileDetails = internalQuery({
  args: {
    albumId: v.id("albums"),
    actorHash: v.string(),
    photoId: v.id("albumPhotos"),
  },
  handler: async (ctx, args) => {
    const { album, member, role } = await actor(
      ctx,
      args.albumId,
      args.actorHash,
    );
    const photo = await ctx.db.get(args.photoId);
    if (
      !photo ||
      photo.albumId !== album._id ||
      !(role === "host" || album.shared || photo.memberId === member?._id)
    )
      throw new Error("Photo unavailable");
    return { storageId: photo.storageId, caption: photo.caption };
  },
});

export const exportManifest = query({
  args: authArgs,
  handler: async (ctx, args) => {
    verifyBridge(args.bridgeSecret);
    const { album, role } = await actor(ctx, args.albumId, args.actorHash);
    if (role !== "host") throw new Error("Host access required");
    const photos = await ctx.db
      .query("albumPhotos")
      .withIndex("by_album", (q) => q.eq("albumId", album._id))
      .take(LIMITS.photos);
    return {
      album: album.name,
      eventDate: album.eventDate,
      expiresAt: album.expiresAt,
      photos: photos.map((photo, i) => ({
        id: photo._id,
        filename: `candid-${String(i + 1).padStart(3, "0")}.jpg`,
        caption: photo.caption,
        contributor: photo.contributor,
        size: photo.size,
      })),
    };
  },
});

export const deletePhoto = mutation({
  args: { ...authArgs, photoId: v.id("albumPhotos") },
  handler: async (ctx, args) => {
    verifyBridge(args.bridgeSecret);
    const { album, member, role } = await actor(
      ctx,
      args.albumId,
      args.actorHash,
    );
    const photo = await ctx.db.get(args.photoId);
    if (
      !photo ||
      photo.albumId !== album._id ||
      (role !== "host" && photo.memberId !== member?._id)
    )
      throw new Error("Photo unavailable");
    await ctx.storage.delete(photo.storageId);
    await ctx.db.delete(photo._id);
    await ctx.db.patch(album._id, {
      photoCount: Math.max(0, album.photoCount - 1),
      byteCount: Math.max(0, album.byteCount - photo.size),
    });
    if (photo.memberId) {
      const uploader = await ctx.db.get(photo.memberId);
      if (uploader)
        await ctx.db.patch(uploader._id, {
          photoCount: Math.max(0, uploader.photoCount - 1),
        });
    }
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expiredUploads = await ctx.db
      .query("albumUploads")
      .withIndex("by_status_expiry", (q) =>
        q.eq("status", "reserved").lte("expiresAt", Date.now()),
      )
      .take(1000);
    for (const item of expiredUploads)
      if (item.status === "reserved") await release(ctx, item._id);
    const expiredAlbums = await ctx.db
      .query("albums")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(5);
    for (const album of expiredAlbums) {
      const photos = await ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", album._id))
        .take(LIMITS.photos);
      for (const photo of photos) {
        await ctx.storage.delete(photo.storageId);
        await ctx.db.delete(photo._id);
      }
      const members = await ctx.db
        .query("albumMembers")
        .withIndex("by_album", (q) => q.eq("albumId", album._id))
        .take(LIMITS.guests);
      for (const member of members) await ctx.db.delete(member._id);
      const uploads = await ctx.db
        .query("albumUploads")
        .withIndex("by_album", (q) => q.eq("albumId", album._id))
        .take(LIMITS.lifetimeUploads);
      for (const upload of uploads) await ctx.db.delete(upload._id);
      await ctx.db.delete(album._id);
    }
    const attempts = await ctx.db
      .query("albumAttempts")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(1000);
    for (const attempt of attempts) await ctx.db.delete(attempt._id);
    return { expiredAlbums: expiredAlbums.length };
  },
});
