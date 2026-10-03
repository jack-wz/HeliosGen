import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import { GUEST_USER_ID } from "@/lib/guestMode";
import { normalizeCategory, CATEGORY_IDS } from "@/lib/guest/creativeAssets";
import * as guestDb from "@/lib/guest/db";
import { resolveMediaPath } from "@/lib/guest/creativeAssets";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;
  const updates: Parameters<typeof guestDb.updateCreativeAsset>[2] = {};
  if ("name" in body && typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if ("description" in body) updates.description = typeof body.description === "string" ? body.description : null;
  if ("prompt" in body) updates.prompt = typeof body.prompt === "string" ? body.prompt : null;
  if ("model" in body) updates.model = typeof body.model === "string" ? body.model : null;
  if ("seekGuid" in body) updates.seek_guid = typeof body.seekGuid === "string" ? body.seekGuid : null;
  if ("category" in body) {
    const category = body.category == null ? null : normalizeCategory(String(body.category));
    if (body.category != null && !category) return NextResponse.json({ error: "Invalid category", code: "invalid_category" }, { status: 400 });
    updates.category = category;
  }
  if ("manualCategoryId" in body) {
    const catId = body.manualCategoryId == null ? null : String(body.manualCategoryId);
    if (catId != null && !CATEGORY_IDS.includes(catId as never) && catId !== "inbox") {
      return NextResponse.json({ error: "Invalid manualCategoryId", code: "invalid_manual_category" }, { status: 400 });
    }
    updates.manual_category_id = catId;
  }
  if ("tags" in body) {
    updates.asset_tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
  }
  const asset = guestDb.updateCreativeAsset(id, GUEST_USER_ID, updates);
  return asset ? NextResponse.json({ ok: true, asset }) : NextResponse.json({ error: "Asset not found", code: "asset_not_found" }, { status: 404 });
}

/**
 * DELETE /api/assets/<id>
 *
 * Removes the asset from the library **and deletes the underlying file**.
 *
 * There is no "remove from library only" mode on purpose: the media folder is
 * the source of truth and reconcile re-adds anything it finds on disk, so a
 * row-only delete would silently come back on the next scan. The UI says plainly
 * that the file goes too, and this folder is shared with Seek — deleting here
 * deletes it there.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = guestDb.getCreativeAsset(id, GUEST_USER_ID);
  if (!asset) return NextResponse.json({ error: "Asset not found", code: "asset_not_found" }, { status: 404 });

  let fileRemoved = false;
  try {
    const media = await resolveMediaPath({ url: asset.url });
    await unlink(media.actualPath);
    fileRemoved = true;
  } catch {
    // Already gone, or unreadable. The row still goes, so the library stops
    // listing something the user asked to delete.
  }

  guestDb.deleteCreativeAsset(id, GUEST_USER_ID);
  return NextResponse.json({ ok: true, fileRemoved });
}
