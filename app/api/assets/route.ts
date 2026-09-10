import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import { ASSET_CATEGORIES, normalizeCategory } from "@/lib/guest/creativeAssets";
import * as guestDb from "@/lib/guest/db";

export async function GET(req: NextRequest) {
  const category = normalizeCategory(req.nextUrl.searchParams.get("category"));
  const collectionId = req.nextUrl.searchParams.get("collection");
  const query = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const collections = guestDb.getAssetCollections(GUEST_USER_ID);
  let assets = guestDb.getCreativeAssets(GUEST_USER_ID);
  if (category) assets = assets.filter((asset) => asset.category === category);
  if (collectionId) {
    const collection = collections.find((item) => item.id === collectionId);
    if (!collection) return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    const ids = guestDb.getCollectionAssetIds(collection);
    assets = assets.filter((asset) => ids.has(asset.id));
  }
  if (query) {
    assets = assets.filter((asset) => [asset.name, asset.description, asset.prompt, asset.model]
      .filter(Boolean).join(" ").toLowerCase().includes(query));
  }
  const all = guestDb.getCreativeAssets(GUEST_USER_ID);
  const counts = Object.fromEntries(ASSET_CATEGORIES.map((name) => [name, all.filter((asset) => asset.category === name).length]));
  return NextResponse.json({ assets, total: assets.length, allTotal: all.length, counts, categories: ASSET_CATEGORIES, collections });
}
