import { NextResponse } from "next/server";
import { getClinic } from "@/lib/clinic";
import { getConversationToken } from "@/lib/elevenlabs";
import { demoDynamicVariables, sessionForCallToken } from "@/lib/demo/session";

export const dynamic = "force-dynamic";

// Llamada por la web de la demo del lead magnet: el link que se manda por
// WhatsApp lleva un token propio de esa demo (no requiere sesión del panel).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const found = await sessionForCallToken(String(body.token ?? ""));
  if (!found) return NextResponse.json({ error: "Este link ya venció. Pedí la demo de nuevo por WhatsApp." }, { status: 404 });
  try {
    const main = await getClinic();
    if (!main.elevenlabs_agent_id) return NextResponse.json({ error: "La demo por voz todavía no está disponible." }, { status: 409 });
    const [token, dynamicVariables] = await Promise.all([
      getConversationToken(main.elevenlabs_agent_id),
      demoDynamicVariables(found.clinic, found.session.phone),
    ]);
    return NextResponse.json(
      { token, dynamicVariables, userId: found.session.phone, clinicName: found.clinic.name, agentName: found.clinic.agent_name },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("Demo: no se pudo iniciar la llamada web", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo iniciar la llamada. Probá de nuevo en un ratito." }, { status: 500 });
  }
}
