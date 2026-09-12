import { httpRouter, makeFunctionReference } from "convex/server";
import { httpAction } from "./functions";
import { LIMITS, verifyBridge } from "./albums";

const http = httpRouter();
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
function credentials(request: Request) {
  verifyBridge(
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "",
  );
  return {
    albumId: request.headers.get("x-album-id") || "",
    actorHash: request.headers.get("x-actor-hash") || "",
  };
}
http.route({
  path: "/pilot/photo",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const args = credentials(request);
      const photoId = new URL(request.url).searchParams.get("id") || "";
      const details = await ctx.runQuery(
        makeFunctionReference<"query">("albums:fileDetails"),
        { ...args, photoId },
      );
      const blob = await ctx.storage.get(details.storageId);
      if (!blob) throw new Error("Missing");
      return new Response(blob, {
        headers: { ...headers, "Content-Type": "image/jpeg" },
      });
    } catch {
      return new Response("Photo unavailable", { status: 404, headers });
    }
  }),
});
http.route({
  path: "/pilot/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let stage = "authorize";
    let stored: Awaited<ReturnType<typeof ctx.storage.store>> | null = null;
    let upload: {
      albumId: string;
      actorHash: string;
      reservationId: string;
    } | null = null;
    try {
      const args = credentials(request);
      const reservationId = request.headers.get("x-reservation-id") || "";
      upload = { ...args, reservationId };
      const reservation = await ctx.runQuery(
        makeFunctionReference<"query">("albums:uploadDetails"),
        { ...args, reservationId },
      );
      stage = "validate_body";
      if (request.headers.get("content-type") !== "image/jpeg")
        throw new Error("Invalid photo");
      const declaredHeader = request.headers.get("content-length");
      const declaredSize = Number(declaredHeader);
      if (
        declaredHeader !== null &&
        (!Number.isInteger(declaredSize) ||
          declaredSize !== reservation.size ||
          declaredSize > LIMITS.photoBytes)
      )
        throw new Error("Invalid photo");
      if (!request.body) throw new Error("Invalid photo");
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > reservation.size || size > LIMITS.photoBytes) {
            await reader.cancel();
            throw new Error("Invalid photo");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const blob = new Blob(chunks as BlobPart[], { type: "image/jpeg" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (
        blob.size !== reservation.size ||
        bytes[0] !== 255 ||
        bytes[1] !== 216 ||
        bytes[bytes.length - 2] !== 255 ||
        bytes[bytes.length - 1] !== 217
      )
        throw new Error("Invalid photo");
      stage = "store";
      stored = await ctx.storage.store(blob);
      stage = "finalize";
      const photoId = await ctx.runMutation(
        makeFunctionReference<"mutation">("albums:finishUpload"),
        { ...args, reservationId, storageId: stored },
      );
      return Response.json({ photoId }, { headers });
    } catch {
      console.warn("Candids upload failed", stage);
      if (stored && upload) {
        try {
          await ctx.runMutation(
            makeFunctionReference<"mutation">("albums:reconcileStoredUpload"),
            { ...upload, storageId: stored },
          );
        } catch {
          // Keep an uncertain file for the scoped maintenance inventory. A
          // retry can recover a committed reservation without losing its photo.
          console.warn("Candids upload reconciliation deferred");
        }
      }
      return new Response("Upload unavailable", { status: 400, headers });
    }
  }),
});
export default http;
