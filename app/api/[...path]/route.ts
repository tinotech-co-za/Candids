import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { backend } from "@/lib/backend";
import {
  boundedBody,
  digest,
  ID_PATTERN,
  readSession,
  sameOrigin,
  signSession,
  token,
  TOKEN_PATTERN,
} from "@/lib/security";
import { MAX_PHOTO_BYTES, normalizePhoto } from "@/lib/images";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cookieName =
  process.env.NODE_ENV === "production" ? "__Host-candids" : "candids";
const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: privateHeaders });
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: NextRequest, context: Context) {
  let service: ReturnType<typeof backend>;
  try {
    service = backend();
  } catch {
    return reply(
      {
        error:
          "Live albums are not configured here. Explore the sample album or request a managed pilot.",
      },
      503,
    );
  }
  const appOrigin =
    process.env.CANDIDS_APP_URL ||
    `${request.nextUrl.protocol}//${request.headers.get("host") || request.nextUrl.host}`;
  const path = (await context.params).path.join("/");
  if (
    request.method === "POST" &&
    !sameOrigin(request, process.env.CANDIDS_APP_URL)
  )
    return reply({ error: "Open Candids directly and try again." }, 403);
  try {
    if (request.method === "POST" && path === "access") {
      const data = JSON.parse((await boundedBody(request, 8000)).toString());
      if (
        !ID_PATTERN.test(data.albumId) ||
        !TOKEN_PATTERN.test(data.key) ||
        !["host", "guest", "recovery"].includes(data.kind) ||
        typeof data.name !== "string" ||
        data.name.length > 40 ||
        (data.kind === "guest" && data.consent !== true)
      )
        return reply(
          {
            error:
              "Check your album link, access key and photo-sharing consent.",
          },
          400,
        );
      const fresh = token(),
        recovery = token();
      const ip =
        request.headers.get("x-vercel-forwarded-for") ||
        request.headers.get("x-forwarded-for") ||
        "unknown";
      const result = await service.mutation("access", {
        albumId: data.albumId,
        keyHash: digest(data.key),
        kind: data.kind,
        freshHash: digest(fresh),
        freshRecoveryHash: digest(recovery),
        name: data.name,
        rateKey: createHmac("sha256", service.config.cookieSecret)
          .update(ip.split(",")[0].trim())
          .digest("hex"),
      });
      if (result.error)
        return reply(
          {
            error:
              result.error === "too_many_attempts"
                ? "Too many attempts. Try again in an hour."
                : "This key cannot open the album. Check the link with your host.",
          },
          result.error === "too_many_attempts" ? 429 : 403,
        );
      const response = reply({
        role: result.role,
        ...(result.recovered
          ? {
              recoveryCard: {
                albumId: data.albumId,
                hostKey: fresh,
                recoveryKey: recovery,
                hostUrl: `${appOrigin}/event/${data.albumId}#host=${fresh}`,
                recoveryUrl: `${appOrigin}/event/${data.albumId}#recovery=${recovery}`,
              },
            }
          : {}),
      });
      response.cookies.set(
        cookieName,
        signSession(
          {
            albumId: data.albumId,
            actorHash: result.actorHash,
            role: result.role,
            expiresAt: result.expiresAt,
          },
          service.config.cookieSecret,
        ),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          expires: new Date(result.expiresAt),
        },
      );
      return response;
    }
    const session = readSession(
      request.cookies.get(cookieName)?.value,
      service.config.cookieSecret,
    );
    if (!session)
      return reply(
        { error: "Open your guest or host link to access this album." },
        401,
      );
    const auth = { albumId: session.albumId, actorHash: session.actorHash };
    if (request.method === "GET" && path === "album")
      return reply(await service.query("snapshot", auth));
    if (request.method === "GET" && path === "export")
      return reply(await service.query("exportManifest", auth));
    if (request.method === "GET" && path.startsWith("photo/")) {
      const photoId = path.slice(6);
      if (!ID_PATTERN.test(photoId))
        return reply({ error: "Photo unavailable" }, 404);
      const upstream = await fetch(
        `${service.config.httpUrl}/pilot/photo?id=${photoId}`,
        {
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            authorization: `Bearer ${service.config.bridgeSecret}`,
            "x-album-id": session.albumId,
            "x-actor-hash": session.actorHash,
          },
        },
      );
      if (!upstream.ok) return reply({ error: "Photo unavailable" }, 404);
      return new NextResponse(upstream.body, {
        headers: {
          ...privateHeaders,
          "Content-Type": "image/jpeg",
          "Content-Disposition": `${request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="candid.jpg"`,
        },
      });
    }
    if (request.method !== "POST") return reply({ error: "Not found" }, 404);
    if (path === "logout") {
      const response = reply({ ok: true });
      response.cookies.set(cookieName, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    if (path === "upload") {
      const input = await boundedBody(request, MAX_PHOTO_BYTES);
      let photo: Buffer;
      try {
        photo = await normalizePhoto(input);
      } catch {
        return reply(
          { error: "Choose a still JPEG, PNG or WebP photo under 2 MB." },
          400,
        );
      }
      const requestId = request.headers.get("x-upload-id") || "";
      const caption = decodeURIComponent(
        request.headers.get("x-photo-caption") || "A candid moment",
      )
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim()
        .slice(0, 80);
      const reservation = await service.mutation("reserveUpload", {
        ...auth,
        size: photo.length,
        requestId,
        caption,
      });
      if (reservation.status === "complete")
        return reply({ photoId: reservation.photoId });
      if (reservation.status !== "reserved")
        return reply(
          { error: "That upload expired. Choose the photo again." },
          409,
        );
      try {
        const upload = await fetch(`${service.config.httpUrl}/pilot/upload`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(25000),
          body: new Uint8Array(photo),
          headers: {
            authorization: `Bearer ${service.config.bridgeSecret}`,
            "content-type": "image/jpeg",
            "content-length": String(photo.length),
            "x-album-id": session.albumId,
            "x-actor-hash": session.actorHash,
            "x-reservation-id": reservation.reservationId,
          },
        });
        if (!upload.ok) throw new Error("Upload failed");
        return reply(await upload.json());
      } catch {
        await service
          .mutation("cancelUpload", {
            ...auth,
            reservationId: reservation.reservationId,
          })
          .catch(() => undefined);
        return reply(
          {
            error:
              "Upload was interrupted. Refresh the album before trying again.",
          },
          502,
        );
      }
    }
    const data = JSON.parse((await boundedBody(request, 8000)).toString());
    if (path === "settings") {
      if (data.action === "invite" || data.action === "block") {
        const invitation = token();
        const block: Record<string, string> =
          data.action === "block" &&
          typeof data.memberId === "string" &&
          ID_PATTERN.test(data.memberId)
            ? { blockMemberId: data.memberId }
            : {};
        if (data.action === "block" && !block.blockMemberId)
          return reply({ error: "Guest unavailable" }, 400);
        await service.mutation("settings", {
          ...auth,
          inviteHash: digest(invitation),
          ...block,
        });
        return reply({
          invite: `${appOrigin}/event/${session.albumId}#guest=${invitation}`,
        });
      }
      if (data.action === "share" && typeof data.value === "boolean")
        await service.mutation("settings", { ...auth, shared: data.value });
      else if (data.action === "uploads" && typeof data.value === "boolean")
        await service.mutation("settings", {
          ...auth,
          uploadsOpen: data.value,
        });
      else return reply({ error: "Choose an album setting." }, 400);
      return reply({ ok: true });
    }
    if (
      path === "delete" &&
      typeof data.photoId === "string" &&
      ID_PATTERN.test(data.photoId)
    ) {
      await service.mutation("deletePhoto", { ...auth, photoId: data.photoId });
      return reply({ ok: true });
    }
    return reply({ error: "Not found" }, 404);
  } catch {
    return reply(
      {
        error:
          "This action is unavailable. Refresh the album and check your access or upload allowance.",
      },
      403,
    );
  }
}
export const GET = handle;
export const POST = handle;
