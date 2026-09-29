import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/providerRegistry";
import { getSetting, setSetting, deleteSetting } from "@/lib/guest/db";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params; const p = getProvider(id);
  if (!p) return NextResponse.json({ error: "provider not found" }, { status: 404 });
  const key = p.auth.secretRef ? getSetting(p.auth.secretRef) : null;
  return NextResponse.json({ provider: p, configured: !!key, lastTestAt: getSetting("provider:" + id + ":lastTestAt") });
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params; const p = getProvider(id);
  if (!p || !p.auth.secretRef) return NextResponse.json({ error: "provider does not accept api key" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (typeof body?.apiKey !== "string" || !body.apiKey.trim()) return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  setSetting(p.auth.secretRef, body.apiKey.trim());
  return NextResponse.json({ ok: true, providerId: id, configured: true });
}
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params; const p = getProvider(id);
  if (!p?.auth.secretRef) return NextResponse.json({ error: "provider not found" }, { status: 404 });
  deleteSetting(p.auth.secretRef); return NextResponse.json({ ok: true, providerId: id, configured: false });
}
