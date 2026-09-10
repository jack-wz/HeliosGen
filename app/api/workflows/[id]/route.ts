/**
 * Single-workflow access for CLI / agent clients.
 *
 *   GET    /api/workflows/<id> → GuestSpace | 404
 *   PUT    /api/workflows/<id> → upsert one space (does NOT touch others,
 *          unlike the full-replace PUT /api/workflows)
 *   DELETE /api/workflows/<id> → { ok: true } | 404
 */
import { NextRequest, NextResponse } from "next/server";
import { getSpace, saveSpace, deleteSpace, type GuestSpace } from "@/lib/guest/spaces";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const space = getSpace(id);
  if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(space);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: Partial<GuestSpace>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    return NextResponse.json({ error: "nodes[] and edges[] required" }, { status: 400 });
  }
  const existing = getSpace(id);
  const now = Date.now();
  const space: GuestSpace = {
    id,
    name: typeof body.name === "string" && body.name.trim() ? body.name : (existing?.name ?? "Untitled"),
    nodes: body.nodes,
    edges: body.edges,
    nodeCounters: body.nodeCounters ?? existing?.nodeCounters ?? {},
    createdAt: existing?.createdAt ?? body.createdAt ?? now,
    updatedAt: now,
    viewport: body.viewport ?? existing?.viewport,
  };
  saveSpace(space);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!deleteSpace(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
