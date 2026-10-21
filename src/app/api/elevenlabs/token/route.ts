import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { buildDynamicVariables, getClinic } from "@/lib/clinic";
import { getConversationToken, getSignedUrl } from "@/lib/elevenlabs";
import { normalizePhone } from "@/lib/phone";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

// Para la demo web: da un token de conversación y las variables dinámicas
// (en la web no corre el webhook de inicio, así que las mandamos desde acá).
export async function POST(request: Request) {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "Ingresá al panel para probar el agente." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { phone?: string; mode?: "voz" | "chat" };
  try {
    const clinic = await getClinic();
    if (!clinic.elevenlabs_agent_id) {
      return NextResponse.json(
        { error: "Todavía no creaste el agente. Entrá al panel → Configuración → “Crear/actualizar agente”." },
        { status: 409 },
      );
    }
    const phone = normalizePhone(body.phone) || `web-${randomBytes(4).toString("hex")}`;
    const chat = body.mode === "chat";
    const [credential, dynamicVariables] = await Promise.all([
      chat ? getSignedUrl(clinic.elevenlabs_agent_id) : getConversationToken(clinic.elevenlabs_agent_id),
      buildDynamicVariables(clinic, phone),
    ]);
    return NextResponse.json({
      ...(chat ? { signedUrl: credential } : { token: credential }),
      agentId: clinic.elevenlabs_agent_id,
      clinicName: clinic.name,
      dynamicVariables,
      userId: phone,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("token demo", e);
    return NextResponse.json({ error: "No se pudo iniciar la demo. Revisá la configuración del agente en el panel." }, { status: 500 });
  }
}
