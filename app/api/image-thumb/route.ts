/**
 * GET /api/image-thumb?url=/generated/<path>&w=640
 *
 * Serves a small WebP thumbnail for a locally stored image. Thumbnails are
 * generated on first use and cached under DATA_DIR (outside the shared media
 * folder, so Seek and the asset index never see them); lib/imageThumb.ts
 * prewarms them at write time so the first gallery read is not the one that
 * pays for it.
 *
 * Returns 404 with a code when the source is missing or undecodable, which the
 * frontend treats as "fall back to the original image".
 */
import { NextRequest, NextResponse } from "next/server";
import { getImageThumb, snapThumbWidth } from "@/lib/imageThumb";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const requested = Number(req.nextUrl.searchParams.get("w") ?? 640);
  const width = snapThumbWidth(requested);

  if (!url.startsWith("/generated/")) {
    return NextResponse.json({ error: "url must be a /generated/ image", code: "thumb_url_invalid" }, { status: 400 });
  }

  const thumb = await getImageThumb(url, width);
  if (!thumb) {
    return NextResponse.json({ error: "Thumbnail unavailable", code: "thumb_unavailable" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(thumb.buffer), {
    headers: {
      "Content-Type": thumb.contentType,
      "Content-Length": String(thumb.buffer.length),
      // Same reasoning as media-poster: the cache key includes mtime and size,
      // so a changed file gets a new URL rather than a stale body.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Thumb-Width": String(thumb.width),
    },
  });
}
