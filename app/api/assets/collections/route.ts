import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ collections: guestDb.getAssetCollections(GUEST_USER_ID) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      name?: string; kind?: "manual" | "smart"; rule?: Record<string, string> | null; seekTagGuid?: string | null;
    };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const kind = body.kind === "smart" ? "smart" : "manual";
    if (kind === "smart" && (!body.rule || Object.keys(body.rule).length === 0)) {
      return NextResponse.json({ error: "smart collections require a rule" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, collection: guestDb.createAssetCollection(GUEST_USER_ID, name, kind, body.rule ?? null, body.seekTagGuid ?? null) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: /UNIQUE/.test(message) ? "A collection with this name already exists" : message }, { status: /UNIQUE/.test(message) ? 409 : 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { collectionId?: string; assetId?: string; included?: boolean };
  if (!body.collectionId || !body.assetId || typeof body.included !== "boolean") {
    return NextResponse.json({ error: "collectionId, assetId and included are required" }, { status: 400 });
  }
  const collection = guestDb.getAssetCollections(GUEST_USER_ID).find((item) => item.id === body.collectionId);
  if (!collection) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  if (collection.kind !== "manual") return NextResponse.json({ error: "Smart collection membership is rule-driven" }, { status: 409 });
  guestDb.setAssetCollectionMembership(body.collectionId, body.assetId, body.included);
  return NextResponse.json({ ok: true });
}
