import { internalQuery } from "./functions";
import { MANAGED_EVENT_CAP } from "./provisioning";

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("albums")
      .withIndex("by_expiry", (q) => q.gt("expiresAt", now))
      .take(MANAGED_EVENT_CAP + 1);
    const overdue = await ctx.db
      .query("albums")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", now - 45 * 60000))
      .take(MANAGED_EVENT_CAP + 1);
    const heartbeat = await ctx.db
      .query("operationalState")
      .withIndex("by_kind", (q) => q.eq("kind", "cleanup"))
      .unique();
    return {
      activeAlbums: active.length,
      managedEventCap: MANAGED_EVENT_CAP,
      overdueExpiredAlbums: overdue.length,
      lastCleanupAt: heartbeat?.completedAt ?? null,
      lastCleanupExpiredAlbums: heartbeat?.expiredAlbums ?? null,
    };
  },
});
