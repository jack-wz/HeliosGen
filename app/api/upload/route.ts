import { NextRequest, NextResponse } from "next/server";
import { uploadDataUrl, mirrorToStorage, uploadImageWithRatio } from "@/lib/storage";
import { Buffer as NodeBuffer } from "node:buffer";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

/**
 * POST { dataUrl: string, folder?: string, mimeType?: string }
 *   → stores a base64 data URL or remote URL on local disk
 *   → records it in uploads
 *   → returns { cdnUrl: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { dataUrl, folder = "uploads", mimeType } = await req.json() as {
      dataUrl:   string;
      folder?:   string;
      mimeType?: string;
    };

    if (!dataUrl) {
      return NextResponse.json({ error: "dataUrl is required" }, { status: 400 });
    }

    let cdnUrl: string;
    let aspectRatio: string | undefined;
    if (dataUrl.startsWith("data:")) {
      const m = dataUrl.match(/^data:([^;]+);/);
      const ct = m?.[1] ?? "";
      if (ct.startsWith("image/")) {
        const buf = NodeBuffer.from(dataUrl.replace(/^data:[^;]+;base64,/, ""), "base64");
        const result = await uploadImageWithRatio(buf, ct, folder);
        cdnUrl = result.url;
        aspectRatio = result.aspectRatio;
      } else {
        cdnUrl = await uploadDataUrl(dataUrl, folder);
      }
    } else if (dataUrl.startsWith("http")) {
      cdnUrl = await mirrorToStorage(dataUrl, folder);
    } else {
      return NextResponse.json({ error: "dataUrl must be a data: or http: URL" }, { status: 400 });
    }

    guestDb.insertUpload({ user_id: GUEST_USER_ID, r2_url: cdnUrl, mime_type: mimeType ?? null, aspect_ratio: aspectRatio, source: "user_upload" });

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
