import { NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/agent/auth";
import { buildDynamicVariables, resolveClinic } from "@/lib/clinic";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

// Webhook de inicio de conversación: ElevenLabs lo llama cuando entra un
// WhatsApp o una llamada, y nosotros devolvemos la "memoria" del paciente.
export async function POST(request: Request) {
  if (!hasValidSecret(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    caller_id?: string;
    called_number?: string;
    agent_id?: string;
  };

  const clinic = await resolveClinic({ agentId: body.agent_id, whatsappPhoneNumberId: body.called_number });
  const phone = normalizePhone(body.caller_id);
  const dynamicVariables = await buildDynamicVariables(clinic, phone);

  return NextResponse.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: dynamicVariables,
    user_id: phone || undefined,
  });
}
