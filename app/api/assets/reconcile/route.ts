import { NextResponse } from "next/server";
import { reconcileCreativeAssets } from "@/lib/guest/creativeAssets";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const assets = await reconcileCreativeAssets();
    return NextResponse.json({ ok: true, count: assets.length, assets });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
