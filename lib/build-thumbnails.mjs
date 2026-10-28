import { Jimp, JimpMime } from "jimp";

// Gallery cards show build images ~14rem wide; 480 px covers 2x screens.
export const CARD_THUMBNAIL_WIDTH = 480;
const JPEG_QUALITY = 72;

// Pure JavaScript (jimp), so it runs the same in Lambda as on a laptop.
export async function makeCardThumbnail(bytes) {
  const image = await Jimp.read(Buffer.from(bytes));
  if (image.width > CARD_THUMBNAIL_WIDTH) image.resize({ w: CARD_THUMBNAIL_WIDTH });
  return new Uint8Array(await image.getBuffer(JimpMime.jpeg, { quality: JPEG_QUALITY }));
}

// Returns the card thumbnail for a build, making and storing it on first
// request. The full image stays the source; a thumbnail can always be remade.
// Returns null when there is no full image or it cannot be decoded, so the
// caller can fall back to the full image.
export async function getGalleryThumbnail({ thumbnails, fullImage, buildId, make = makeCardThumbnail }) {
  const key = `card/${buildId}.jpg`;
  const stored = await thumbnails.get(key, { type: "arrayBuffer" });
  if (stored) return { bytes: new Uint8Array(stored), contentType: "image/jpeg" };
  const full = await fullImage(buildId);
  if (!full?.bytes) return null;
  let bytes;
  try {
    bytes = await make(full.bytes);
  } catch {
    return null;
  }
  await thumbnails.set(key, new Blob([bytes], { type: "image/jpeg" }));
  return { bytes, contentType: "image/jpeg" };
}
