import sharp from "sharp";
export const MAX_PHOTO_BYTES = 2_000_000;
export async function normalizePhoto(input: Buffer) {
  if (!input.length || input.length > MAX_PHOTO_BYTES)
    throw new Error("Choose a photo under 2 MB");
  const image = sharp(input, {
    limitInputPixels: 24_000_000,
    animated: false,
    failOn: "error",
  });
  const metadata = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(metadata.format || "") ||
    (metadata.pages || 1) !== 1 ||
    !metadata.width ||
    !metadata.height
  )
    throw new Error("Choose a still JPEG, PNG or WebP photo");
  const output = await image
    .rotate()
    .resize({
      width: 2000,
      height: 2000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82 })
    .toBuffer();
  if (output.length > MAX_PHOTO_BYTES)
    throw new Error("Choose a smaller photo");
  return output;
}
