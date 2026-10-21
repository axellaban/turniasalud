import { NextResponse } from "next/server";
import { neonPublicJwks } from "@/lib/neon-auth";

export const dynamic = "force-dynamic";

export function GET() {
  if (!process.env.NEON_SERVER_PRIVATE_KEY) return NextResponse.json({ keys: [] }, { status: 503 });
  return NextResponse.json(neonPublicJwks(), { headers: { "Cache-Control": "public, max-age=300" } });
}
