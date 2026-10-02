/**
 * POST /api/assets/<id>/classify
 *
 * Ask the vision model what an asset shows and write the answer back, so the
 * library can be browsed by content rather than by folder. Body may carry
 * `{ apply: false }` to get the suggestion without persisting it.
 *
 * Returns 409 with code `vision_not_configured` when no MiMo key is set — the
 * UI turns that into a pointer at Settings rather than a generic failure.
 */
import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { classifyAssetImage, VisionNotConfiguredError } from "@/lib/assetVision";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { apply?: boolean; language?: "zh" | "en" };
  const apply = body.apply !== false;

  const asset = guestDb.getCreativeAsset(id, GUEST_USER_ID);
  if (!asset) {
    return NextResponse.json({ error: "Asset not found", code: "asset_not_found" }, { status: 404 });
  }

  let result;
  try {
    result = await classifyAssetImage({
      imageUrl: asset.url,
      name: asset.name,
      existingPrompt: asset.prompt,
      language: body.language,
    });
  } catch (err) {
    if (err instanceof VisionNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, code: "vision_not_configured" },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, code: "classification_failed" }, { status: 502 });
  }

  if (!apply) {
    return NextResponse.json({ ok: true, applied: false, suggestion: result });
  }

  const updated = guestDb.updateCreativeAsset(id, GUEST_USER_ID, {
    category: result.category,
    description: result.description || asset.description,
    asset_tags: result.tags,
  });

  return NextResponse.json({ ok: true, applied: true, suggestion: result, asset: updated });
}
