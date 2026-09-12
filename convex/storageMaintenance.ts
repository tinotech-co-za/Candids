import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";

const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const reviewedFile = v.object({
  storageId: v.id("_storage"),
  sha256: v.string(),
  createdAt: v.number(),
});

function assertDedicatedDeployment(deployment: string) {
  if (
    process.env.CANDIDS_STORAGE_MAINTENANCE_ENABLED !== "true" ||
    !process.env.CONVEX_CLOUD_URL ||
    deployment !== process.env.CONVEX_CLOUD_URL
  )
    throw new Error("Dedicated storage maintenance is disabled or mismatched");
}

// Internal operator tools only. Enable solely on the reviewed, new isolated
// deployment. No public endpoint or cron can invoke a storage-wide sweep.
export const inventory = internalQuery({
  args: { deployment: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    assertDedicatedDeployment(args.deployment);
    const page = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - ORPHAN_GRACE_MS),
      )
      .paginate({ numItems: 100, cursor: args.cursor });
    const candidates = [];
    for (const file of page.page) {
      const photo = await ctx.db
        .query("albumPhotos")
        .withIndex("by_storage", (q) => q.eq("storageId", file._id))
        .first();
      if (!photo)
        candidates.push({
          storageId: file._id,
          sha256: file.sha256,
          createdAt: file._creationTime,
          size: file.size,
        });
    }
    return {
      deployment: args.deployment,
      candidates,
      scanned: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const deleteReviewed = internalMutation({
  args: { deployment: v.string(), files: v.array(reviewedFile) },
  handler: async (ctx, args) => {
    assertDedicatedDeployment(args.deployment);
    if (
      args.files.length < 1 ||
      args.files.length > 20 ||
      new Set(args.files.map((file) => file.storageId)).size !==
        args.files.length
    )
      throw new Error("Review between one and twenty distinct files");
    const eligible = [];
    let alreadyAbsent = 0;
    for (const reviewed of args.files) {
      const file = await ctx.db.system.get(reviewed.storageId);
      if (!file) {
        alreadyAbsent++;
        continue;
      }
      const photo = await ctx.db
        .query("albumPhotos")
        .withIndex("by_storage", (q) => q.eq("storageId", file._id))
        .first();
      if (
        photo ||
        file._creationTime >= Date.now() - ORPHAN_GRACE_MS ||
        file.sha256 !== reviewed.sha256 ||
        file._creationTime !== reviewed.createdAt
      )
        throw new Error("Reviewed file is no longer an eligible orphan");
      eligible.push(file._id);
    }
    for (const storageId of eligible) await ctx.storage.delete(storageId);
    return { deleted: eligible.length, alreadyAbsent };
  },
});
