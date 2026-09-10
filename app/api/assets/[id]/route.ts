import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import { normalizeCategory } from "@/lib/guest/creativeAssets";
import * as guestDb from "@/lib/guest/db";

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
    if (body.category != null && !category) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    updates.category = category;
  }
  const asset = guestDb.updateCreativeAsset(id, GUEST_USER_ID, updates);
  return asset ? NextResponse.json({ ok: true, asset }) : NextResponse.json({ error: "Asset not found" }, { status: 404 });
}
