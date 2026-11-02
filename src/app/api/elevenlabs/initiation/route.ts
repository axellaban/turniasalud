import { NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/agent/auth";
import { buildDynamicVariables, InboundClinicError, resolveInboundClinic } from "@/lib/clinic";
import { normalizePhone } from "@/lib/phone";
import { z } from "zod";

export const dynamic = "force-dynamic";

const initiation = z.object({
  agent_id: z.string().trim().min(1).max(200),
  caller_id: z.string().max(200).nullish(),
  called_number: z.string().max(200).nullish(),
});

// Webhook de inicio de conversación: ElevenLabs lo llama cuando entra un
// WhatsApp o una llamada, y nosotros devolvemos la "memoria" del paciente.
export async function POST(request: Request) {
  if (!hasValidSecret(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = initiation.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos de inicio inválidos" }, { status: 400 });
  const body = parsed.data;
  let clinic;
  try {
    clinic = await resolveInboundClinic({ agentId: body.agent_id, calledNumber: body.called_number });
  } catch (e) {
    if (!(e instanceof InboundClinicError)) throw e;
    return NextResponse.json({ error: e.message }, { status: 409 });
  }
  const phone = normalizePhone(body.caller_id);
  const dynamicVariables = await buildDynamicVariables(clinic, phone);

  return NextResponse.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: dynamicVariables,
    user_id: phone || undefined,
  }, { headers: { "Cache-Control": "no-store" } });
}
