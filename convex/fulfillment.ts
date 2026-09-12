import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";
import { provisionAlbum } from "./provisioning";

// Only the private operator can call this after fresh SERVICES verification.
// Keep this minimal idempotency record after photo/album expiry; it contains no
// buyer address, raw capability or photo and prevents a second fulfillment.
export const provisionPaid = internalMutation({
  args: {
    reference: v.string(),
    transactionId: v.string(),
    requestDigest: v.string(),
    album: v.object({
      name: v.string(),
      eventDate: v.string(),
      expiresAt: v.number(),
      hostHash: v.string(),
      recoveryHash: v.string(),
      inviteHash: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    if (
      !/^tino-service-[a-f0-9]{32}$/.test(args.reference) ||
      !/^[1-9][0-9]{0,19}$/.test(args.transactionId) ||
      !/^[a-f0-9]{64}$/.test(args.requestDigest)
    )
      throw new Error("Invalid verified fulfillment");
    const encoded = new TextEncoder().encode(
      JSON.stringify([
        args.reference,
        args.transactionId,
        args.requestDigest,
        args.album.name,
        args.album.eventDate,
        args.album.expiresAt,
        args.album.hostHash,
        args.album.recoveryHash,
        args.album.inviteHash,
      ]),
    );
    const provisionDigest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)),
    )
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const prior = await ctx.db
      .query("albumFulfillments")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .unique();
    if (prior) {
      if (
        prior.transactionId !== args.transactionId ||
        prior.requestDigest !== args.requestDigest ||
        prior.provisionDigest !== provisionDigest
      )
        throw new Error("Fulfillment differs from its durable record");
      const album = await ctx.db.get(prior.albumId);
      if (!album || album.expiresAt <= Date.now())
        throw new Error(
          "This fulfilled album has expired; review its existing record",
        );
      if (album.uploadsSuspended)
        throw new Error(
          "This event is suspended; review the existing payment case",
        );
      if (
        album.hostHash !== args.album.hostHash ||
        album.recoveryHash !== args.album.recoveryHash ||
        album.inviteHash !== args.album.inviteHash
      )
        throw new Error(
          "Album access changed after fulfillment; use the existing recovery flow",
        );
      return { albumId: prior.albumId, reused: true };
    }
    const used = await ctx.db
      .query("albumFulfillments")
      .withIndex("by_transaction", (q) =>
        q.eq("transactionId", args.transactionId),
      )
      .unique();
    if (used) throw new Error("Transaction already fulfilled");
    const albumId = await provisionAlbum(ctx, args.album);
    await ctx.db.insert("albumFulfillments", {
      reference: args.reference,
      transactionId: args.transactionId,
      requestDigest: args.requestDigest,
      provisionDigest,
      albumId,
      createdAt: Date.now(),
    });
    return { albumId, reused: false };
  },
});

const recordArgs = { reference: v.string(), transactionId: v.string() };

export const eventStatus = internalQuery({
  args: recordArgs,
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("albumFulfillments")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .unique();
    if (!record || record.transactionId !== args.transactionId)
      throw new Error("Fulfillment unavailable");
    const album = await ctx.db.get(record.albumId);
    return {
      albumId: record.albumId,
      expired: !album || album.expiresAt <= Date.now(),
      uploadsOpen: album?.uploadsOpen ?? false,
      uploadsSuspended: album?.uploadsSuspended ?? false,
    };
  },
});

// Explicit operator action after reviewing a payment case. Provider outages
// never call this mutation. Retention, access/recovery, export and privacy
// deletion remain available; the host cannot reopen suspended uploads.
export const suspendUploads = internalMutation({
  args: recordArgs,
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("albumFulfillments")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .unique();
    if (!record || record.transactionId !== args.transactionId)
      throw new Error("Fulfillment unavailable");
    const album = await ctx.db.get(record.albumId);
    if (album)
      await ctx.db.patch(album._id, {
        uploadsOpen: false,
        uploadsSuspended: true,
      });
    return {
      albumId: record.albumId,
      uploadsSuspended: true,
      expired: !album || album.expiresAt <= Date.now(),
    };
  },
});
