import { NextRequest, NextResponse } from "next/server";
import { getSkill, listSkills, resolveSkills, type SkillScope } from "@/lib/skillRegistry";
export async function GET(req: NextRequest) { const ids = req.nextUrl.searchParams.get("ids"); const scope = req.nextUrl.searchParams.get("scope") as SkillScope | null; return NextResponse.json(ids ? { skills: resolveSkills(ids.split(","), scope ?? undefined) } : { skills: listSkills() }); }
export async function POST(req: NextRequest) { const b = await req.json().catch(() => null); const s = b?.id ? getSkill(b.id) : null; if (!s) return NextResponse.json({ error: "skill not found", code: "skill_not_found" }, { status: 404 }); return NextResponse.json({ ok: true, skill: s }); }
