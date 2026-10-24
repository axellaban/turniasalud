import { NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/agent/auth";
import { runSalesTool } from "@/lib/sales/service";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!hasValidSecret(request)) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  const { name } = await params;
  try {
    return NextResponse.json(await runSalesTool(name, await request.json()));
  } catch {
    return NextResponse.json({ ok: false, error: "No se guardó. Revisá los parámetros y la autorización de la llamada." }, { status: 400 });
  }
}
