import { NextRequest, NextResponse } from "next/server";
import { importCreativeAsset } from "@/lib/guest/creativeAssets";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const asset = await importCreativeAsset(body);
    return NextResponse.json({ ok: true, asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /must point|escapes|not a file|Unsupported|Invalid/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
