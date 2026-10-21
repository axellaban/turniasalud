import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, service: "turnia-salud", configured: isConfigured() });
}
