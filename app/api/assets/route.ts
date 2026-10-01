import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import { ASSET_CATEGORIES, CATEGORY_IDS, normalizeCategory } from "@/lib/guest/creativeAssets";
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
    if (!collection) return NextResponse.json({ error: "Collection not found", code: "collection_not_found" }, { status: 404 });
    const ids = guestDb.getCollectionAssetIds(collection);
    assets = assets.filter((asset) => ids.has(asset.id));
  }
  if (query) {
    assets = assets.filter((asset) => [asset.name, asset.description, asset.prompt, asset.model]
      .filter(Boolean).join(" ").toLowerCase().includes(query));
  }
  const all = guestDb.getCreativeAssets(GUEST_USER_ID);
  const counts = Object.fromEntries(ASSET_CATEGORIES.map((name) => [name, all.filter((asset) => asset.category === name).length]));
  const uncategorized = all.filter((asset) => !asset.category).length;

  // Pagination: the asset grid pages through results instead of rendering
  // every file at once. Omitting `limit` keeps the old "return everything"
  // behaviour for the CLI/MCP clients.
  const total = assets.length;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);
  if (limitParam) {
    const limit = Math.min(200, Math.max(1, Number(limitParam) || 48));
    assets = assets.slice(offset, offset + limit);
  }
  const page = assets.map((asset) => {
    if (!asset.mime_type.startsWith("video/")) return asset;
    const poster = guestDb.findGenerationByMediaUrl(asset.url)?.poster_url ?? null;
    return { ...asset, poster_url: poster };
  });
  return NextResponse.json({
    assets: page, total, offset, hasMore: offset + page.length < total,
    allTotal: all.length, uncategorized, counts,
    categories: ASSET_CATEGORIES, categoryIds: CATEGORY_IDS, collections,
  });
}
