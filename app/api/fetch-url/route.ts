/**
 * POST /api/fetch-url
 *
 * Fetches a remote image/video URL server-side and stores it locally.
 * Body: { url: string }
 * Returns: { cdnUrl: string; mediaType: "image" | "video" }
 *
 * The URL comes from the caller, so it goes through lib/ssrfGuard: private and
 * link-local addresses are refused, and redirects are followed one hop at a
 * time with the same check applied to each (see that file for the reasoning).
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadImageWithRatio, uploadBuffer } from "@/lib/storage";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { fetchFollowingSafely } from "@/lib/ssrfGuard";

export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url?: string };
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    let upstream: Response;
    try {
      upstream = await fetchFollowingSafely(url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${upstream.status} ${upstream.statusText}` }, { status: 400 });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const mimeType = contentType.split(";")[0].trim();

    const isImage = mimeType.startsWith("image/");
    const isVideo = mimeType.startsWith("video/");
    if (!isImage && !isVideo) {
      return NextResponse.json({ error: "URL does not point to an image or video" }, { status: 400 });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });
    }

    const folder = isVideo ? "references" : "uploads";
    let cdnUrl: string;
    let aspectRatio: string | undefined;
    if (isImage) {
      const result = await uploadImageWithRatio(buffer, mimeType, folder);
      cdnUrl = result.url;
      aspectRatio = result.aspectRatio;
    } else {
      cdnUrl = await uploadBuffer(buffer, mimeType, folder);
    }
    const mediaType: "image" | "video" = isImage ? "image" : "video";

    // Record in uploads so it appears in the gallery "uploaded" section
    guestDb.insertUpload({ user_id: GUEST_USER_ID, r2_url: cdnUrl, mime_type: mimeType, aspect_ratio: aspectRatio, source: "user_upload" });

    return NextResponse.json({ cdnUrl, mediaType });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
