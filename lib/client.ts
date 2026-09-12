import { zipSync, strToU8 } from "fflate";
import type { Manifest } from "./types";
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "The action did not finish. Try again.");
  return result;
}
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function preparePhoto(file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10_000_000)
    throw new Error(
      "Choose a JPEG, PNG or WebP photo under 10 MB. Export HEIC as JPEG first.",
    );
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24_000_000)
      throw new Error("Choose a photo below 24 megapixels.");
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the photo.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Photo preparation failed.")),
        "image/jpeg",
        0.82,
      ),
    );
    if (blob.size > 2_000_000) throw new Error("Choose a smaller photo.");
    return blob;
  } finally {
    bitmap.close();
  }
}
export async function downloadArchive(
  manifest: Manifest,
  progress: (done: number, total: number) => void,
) {
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  if (manifest.photos.length > 100)
    throw new Error("This album exceeds the pilot export limit.");
  for (const [index, photo] of manifest.photos.entries()) {
    const response = await fetch(photo.url || `/api/photo/${photo.id}`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "A photo is no longer available. Refresh the album before downloading again.",
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    total += bytes.length;
    if (bytes.length > 2_000_000 || total > 200_000_000)
      throw new Error("Export exceeds the pilot size limit.");
    files[photo.filename] = bytes;
    progress(index + 1, manifest.photos.length);
  }
  files["album.json"] = strToU8(
    JSON.stringify(
      {
        ...manifest,
        photos: manifest.photos.map((photo) => ({
          id: photo.id,
          filename: photo.filename,
          caption: photo.caption,
          contributor: photo.contributor,
          size: photo.size,
        })),
      },
      null,
      2,
    ),
  );
  const archive = zipSync(files, { level: 0 });
  saveFile(
    new Blob([new Uint8Array(archive)], { type: "application/zip" }),
    "candids-album.zip",
  );
}
