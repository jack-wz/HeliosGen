/**
 * GET /api/media-poster?url=/generated/<path>.mp4[&w=480]
 *
 * Returns a small JPEG still for a locally stored video so grids can show a
 * preview without downloading the video itself. Extraction and caching live in
 * lib/videoFrame.ts, which the vision classifier uses for the same purpose.
 */
import { NextRequest, NextResponse } from "next/server";
import { getVideoPoster } from "@/lib/videoFrame";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const requested = Number(req.nextUrl.searchParams.get("w") ?? 480);

  if (!url.startsWith("/generated/")) {
    return NextResponse.json({ error: "url must be a /generated/ video", code: "poster_url_invalid" }, { status: 400 });
  }

  const poster = await getVideoPoster(url, requested);
  if (!poster) {
    return NextResponse.json({ error: "Video not found", code: "video_not_found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(poster.buffer), {
    headers: {
      "Content-Type": poster.contentType,
      "Content-Length": String(poster.buffer.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
