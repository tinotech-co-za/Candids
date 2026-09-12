import type { MutationCtx } from "./functions";

export const MANAGED_EVENT_CAP = 5;
export type AlbumProvision = {
  name: string;
  eventDate: string;
  expiresAt: number;
  hostHash: string;
  recoveryHash: string;
  inviteHash: string;
};

export async function provisionAlbum(ctx: MutationCtx, args: AlbumProvision) {
  if (
    !args.name.trim() ||
    args.name.length > 80 ||
    /[\x00-\x1f\x7f]/.test(args.name) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(args.eventDate) ||
    !Number.isFinite(Date.parse(args.eventDate + "T12:00:00Z")) ||
    new Date(args.eventDate + "T12:00:00Z").toISOString().slice(0, 10) !==
      args.eventDate ||
    args.expiresAt <= Date.now() ||
    args.expiresAt > Date.now() + 30 * 86400000 ||
    ![args.hostHash, args.recoveryHash, args.inviteHash].every((value) =>
      /^[a-f0-9]{64}$/.test(value),
    ) ||
    new Set([args.hostHash, args.recoveryHash, args.inviteHash]).size !== 3
  )
    throw new Error("Invalid pilot setup");
  const active = await ctx.db
    .query("albums")
    .withIndex("by_expiry", (q) => q.gt("expiresAt", Date.now()))
    .take(MANAGED_EVENT_CAP);
  if (active.length >= MANAGED_EVENT_CAP)
    throw new Error("Managed event capacity reached");
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
}
