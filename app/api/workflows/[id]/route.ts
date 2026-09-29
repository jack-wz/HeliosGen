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

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const existing = getSpace(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null) as { action?: string; patch?: Array<{ op: string; path: string; value?: unknown }> } | null;
  if (!body?.action) return NextResponse.json({ error: "action required" }, { status: 400 });
  if (body.action === "summary") return NextResponse.json({ id, name: existing.name, version: existing.updatedAt ?? existing.createdAt, nodeCount: existing.nodes.length, edgeCount: existing.edges.length, nodeTypes: [...new Set(existing.nodes.map((n: any) => n.type).filter(Boolean))] });
  if (body.action === "validate") {
    const ids = new Set(existing.nodes.map((n: any) => n.id));
    const errors = existing.edges.flatMap((e: any) => [e.source, e.target].filter((x: string) => !ids.has(x)).map((x: string) => "edge references missing node " + x));
    return NextResponse.json({ valid: errors.length === 0, errors });
  }
  if (body.action !== "patch" || !Array.isArray(body.patch)) return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  const next: any = structuredClone(existing);
  for (const op of body.patch) {
    const m = op.path.match(/^\/(nodes|edges)\/(\d+)$/);
    if (!m || !["add", "replace", "remove"].includes(op.op)) return NextResponse.json({ error: "unsupported patch " + op.op + " " + op.path }, { status: 400 });
    const list = next[m[1]] as unknown[]; const index = Number(m[2]);
    if (op.op === "remove") list.splice(index, 1); else if (op.op === "add") list.splice(index, 0, op.value); else list[index] = op.value;
  }
  next.updatedAt = Date.now(); saveSpace(next);
  return NextResponse.json({ ok: true, id, version: next.updatedAt, summary: { nodeCount: next.nodes.length, edgeCount: next.edges.length } });
}
