import { NextRequest, NextResponse } from "next/server";
import { listProviders } from "@/lib/providerRegistry";
export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ providers: listProviders() }); }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string" || !/^[a-z0-9._-]+$/.test(body.id)) return NextResponse.json({ error: "valid provider id required" }, { status: 400 });
  if (body.kind !== "custom" || typeof body.baseUrl !== "string") return NextResponse.json({ error: "custom provider requires kind=custom and baseUrl" }, { status: 400 });
  try { const u = new URL(body.baseUrl); if (u.protocol !== "https:" && u.hostname !== "localhost") throw new Error("https required"); } catch { return NextResponse.json({ error: "baseUrl must be https (localhost allowed)" }, { status: 400 }); }
  return NextResponse.json({ ok: true, provider: { id: body.id, kind: "custom", status: "registered", execution: "isolated-plugin-required" } }, { status: 201 });
}
