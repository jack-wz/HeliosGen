import { NextRequest, NextResponse } from "next/server";
import { getProvider, getProviderDefinition } from "@/lib/providerRegistry";
import { getSetting, setSetting, deleteSetting } from "@/lib/guest/db";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params; const p = getProvider(id);
  if (!p) return NextResponse.json({ error: "provider not found", code: "provider_not_found" }, { status: 404 });
  // Report the provider's own `configured` so the nested and top-level values
  // can never disagree (they used to: the nested one ignored env fallbacks).
  return NextResponse.json({ provider: p, configured: p.configured, lastTestAt: getSetting("provider:" + id + ":lastTestAt") });
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params; const def = getProviderDefinition(id);
  if (!def?.auth.secretRef) return NextResponse.json({ error: "provider does not accept api key", code: "provider_no_api_key" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (typeof body?.apiKey !== "string" || !body.apiKey.trim()) return NextResponse.json({ error: "apiKey is required", code: "api_key_required" }, { status: 400 });
  setSetting(def.auth.secretRef, body.apiKey.trim());
  return NextResponse.json({ ok: true, providerId: id, configured: getProvider(id)?.configured ?? false });
}
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params; const def = getProviderDefinition(id);
  if (!def?.auth.secretRef) return NextResponse.json({ error: "provider not found", code: "provider_not_found" }, { status: 404 });
  deleteSetting(def.auth.secretRef);
  // Recompute rather than assuming false: an env-provided key still counts.
  return NextResponse.json({ ok: true, providerId: id, configured: getProvider(id)?.configured ?? false });
}
