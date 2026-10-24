import { NextResponse } from "next/server";
import { startWebConversation, webDemoState, WebDemoError } from "@/lib/demo/web";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Demo en el navegador: el token de la página es la única credencial (no hay sesión del panel).
export async function GET(_request: Request, { params }: RouteContext<"/api/demo/web/[token]">) {
  const state = await webDemoState((await params).token);
  if (!state) return NextResponse.json({ error: "Esta demo ya no está disponible." }, { status: 404, headers: NO_STORE });
  return NextResponse.json(state, { headers: NO_STORE });
}

export async function POST(request: Request, { params }: RouteContext<"/api/demo/web/[token]">) {
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
  if (body.mode !== "chat" && body.mode !== "voz") return NextResponse.json({ error: "Elegí chat o voz." }, { status: 400 });
  try {
    return NextResponse.json(await startWebConversation((await params).token, body.mode), { headers: NO_STORE });
  } catch (e) {
    if (e instanceof WebDemoError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    console.error("Demo web: no se pudo iniciar la conversación", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo iniciar la conversación. Probá de nuevo en un ratito." }, { status: 500, headers: NO_STORE });
  }
}
