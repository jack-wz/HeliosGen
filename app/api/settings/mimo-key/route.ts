import { NextRequest, NextResponse } from "next/server";
import { getMimoApiKey, setMimoApiKey, deleteMimoApiKey } from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ hasKey: !!getMimoApiKey() });
}

export async function POST(req: NextRequest) {
  const { mimoApiKey } = await req.json();
  if (typeof mimoApiKey !== "string" || !mimoApiKey.trim()) {
    return NextResponse.json({ error: "mimoApiKey is required", code: "mimo_api_key_required" }, { status: 400 });
  }
  setMimoApiKey(mimoApiKey.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  deleteMimoApiKey();
  return NextResponse.json({ ok: true });
}
