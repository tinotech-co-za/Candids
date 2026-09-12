import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const applicationTables = {
  albumFulfillments: defineTable({
    reference: v.string(),
    transactionId: v.string(),
    requestDigest: v.string(),
    provisionDigest: v.string(),
    albumId: v.id("albums"),
    createdAt: v.number(),
  })
    .index("by_reference", ["reference"])
    .index("by_transaction", ["transactionId"]),
  operationalState: defineTable({
    kind: v.literal("cleanup"),
    completedAt: v.number(),
    expiredAlbums: v.number(),
  }).index("by_kind", ["kind"]),
  albums: defineTable({
    name: v.string(),
    eventDate: v.string(),
    hostHash: v.string(),
    recoveryHash: v.string(),
    inviteHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    shared: v.boolean(),
    uploadsOpen: v.boolean(),
    uploadsSuspended: v.optional(v.boolean()),
    photoCount: v.number(),
    byteCount: v.number(),
    memberCount: v.number(),
    uploadCount: v.number(),
  }).index("by_expiry", ["expiresAt"]),
  albumMembers: defineTable({
    albumId: v.id("albums"),
    tokenHash: v.string(),
    name: v.string(),
    blocked: v.boolean(),
    photoCount: v.number(),
    joinedAt: v.number(),
  })
    .index("by_token", ["tokenHash"])
    .index("by_album", ["albumId"]),
  albumPhotos: defineTable({
    albumId: v.id("albums"),
    memberId: v.optional(v.id("albumMembers")),
    storageId: v.id("_storage"),
    size: v.number(),
    caption: v.string(),
    contributor: v.string(),
    createdAt: v.number(),
  })
    .index("by_album", ["albumId"])
    .index("by_storage", ["storageId"]),
  albumUploads: defineTable({
    albumId: v.id("albums"),
    memberId: v.optional(v.id("albumMembers")),
    actorHash: v.string(),
    requestId: v.string(),
    size: v.number(),
    caption: v.string(),
    contributor: v.string(),
    status: v.union(
      v.literal("reserved"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    photoId: v.optional(v.id("albumPhotos")),
    expiresAt: v.number(),
  })
    .index("by_request", ["albumId", "actorHash", "requestId"])
    .index("by_expiry", ["expiresAt"])
    .index("by_status_expiry", ["status", "expiresAt"])
    .index("by_album", ["albumId"]),
  albumAttempts: defineTable({
    key: v.string(),
    count: v.number(),
    expiresAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiry", ["expiresAt"]),
  sessions: defineTable({
    name: v.string(),
    hostId: v.id("users"),
    status: v.union(
      v.literal("active"),
      v.literal("revealed"),
      v.literal("ended"),
    ),
    revealTime: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_host", ["hostId"]),

  sessionParticipants: defineTable({
    sessionId: v.id("sessions"),
    userId: v.id("users"),
    joinedAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_user", ["userId"]),

  photos: defineTable({
    sessionId: v.id("sessions"),
    originalOwnerId: v.id("users"), // Who originally captured the photo
    ownerId: v.id("users"), // Current owner (simplified from tradedTo)
    storageId: v.id("_storage"),
    isRevealed: v.boolean(),
    capturedAt: v.number(),
    fileSize: v.optional(v.number()), // File size in bytes
    width: v.optional(v.number()), // Original image width
    height: v.optional(v.number()), // Original image height
    tradeCount: v.number(), // How many times this photo has been traded
  })
    .index("by_session", ["sessionId"])
    .index("by_owner", ["ownerId"])
    .index("by_original_owner", ["originalOwnerId"])
    .index("by_session_revealed", ["sessionId", "isRevealed"])
    .index("by_session_owner", ["sessionId", "ownerId"]),

  trades: defineTable({
    sessionId: v.id("sessions"),
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    offeredPhotoIds: v.array(v.id("photos")),
    requestedPhotoIds: v.array(v.id("photos")),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
    createdAt: v.number(),
    completedAt: v.optional(v.number()), // When trade was completed
  })
    .index("by_session", ["sessionId"])
    .index("by_to_user", ["toUserId"])
    .index("by_from_user", ["fromUserId"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  photoTransfers: defineTable({
    photoId: v.id("photos"),
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    tradeId: v.id("trades"), // Which trade caused this transfer
    transferredAt: v.number(),
  })
    .index("by_photo", ["photoId"])
    .index("by_trade", ["tradeId"])
    .index("by_from_user", ["fromUserId"])
    .index("by_to_user", ["toUserId"]),

  userStats: defineTable({
    userId: v.id("users"),
    totalPhotos: v.number(), // Photos captured by user
    totalTrades: v.number(), // Successful trades participated in
    sessionsAttended: v.number(), // Sessions joined
    sessionsHosted: v.number(), // Sessions created as host
    photosReceived: v.number(), // Photos received through trades
    badges: v.array(
      v.object({
        id: v.string(), // Badge identifier
        name: v.string(), // Display name
        earnedAt: v.number(), // When badge was earned
        criteria: v.optional(v.string()), // How it was earned
      }),
    ),
    lastActivity: v.number(), // Timestamp of last activity
    joinedAt: v.number(), // When user first joined
  })
    .index("by_user", ["userId"])
    .index("by_total_photos", ["totalPhotos"])
    .index("by_total_trades", ["totalTrades"])
    .index("by_last_activity", ["lastActivity"]),
};

export default defineSchema({
  ...authTables,
  ...applicationTables,
});
