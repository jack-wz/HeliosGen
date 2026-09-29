import { NextResponse } from "next/server";
import { listProviders, providerCapabilities } from "@/lib/providerRegistry";
import { listSkills } from "@/lib/skillRegistry";
import { NODE_META } from "@/lib/nodeTypes";
export async function GET() { return NextResponse.json({ version: "1", providers: listProviders(), providerCapabilities: providerCapabilities(), skills: listSkills(), nodes: Object.keys(NODE_META) }); }
