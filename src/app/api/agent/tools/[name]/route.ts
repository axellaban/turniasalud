import { NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/agent/auth";
import { contextSchema, getToolDefinition } from "@/lib/agent/tools";
import {
  bookAppointment,
  cancelAppointment,
  checkAvailability,
  createTask,
  joinWaitlist,
  listPatientAppointments,
  registerPatient,
  rescheduleAppointment,
  ToolError,
  type ToolContext,
} from "@/lib/agent/service";

export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HANDLERS: Record<string, (ctx: ToolContext, input: any) => Promise<unknown>> = {
  registrar_paciente: registerPatient,
  consultar_disponibilidad: checkAvailability,
  reservar_turno: bookAppointment,
  ver_turnos_paciente: listPatientAppointments,
  cancelar_turno: cancelAppointment,
  reprogramar_turno: rescheduleAppointment,
  crear_tarea: createTask,
  anotar_lista_espera: joinWaitlist,
};

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!hasValidSecret(request)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { name } = await params;
  const def = getToolDefinition(name);
  const handler = HANDLERS[name];
  if (!def || !handler) return NextResponse.json({ ok: false, error: `Herramienta desconocida: ${name}` }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "El cuerpo debe ser JSON." }, { status: 400 });
  }

  const ctx = contextSchema.safeParse(body);
  if (!ctx.success) {
    return NextResponse.json({ ok: false, error: "Faltan clinic_id o patient_phone (variables dinámicas)." }, { status: 400 });
  }
  // ElevenLabs puede mandar strings vacíos en parámetros opcionales: los limpiamos.
  const cleaned = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== "" && v !== null));
  const input = def.schema.safeParse(cleaned);
  if (!input.success) {
    return NextResponse.json({
      ok: false,
      error: `Parámetros inválidos: ${input.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    });
  }

  try {
    const result = await handler(
      {
        clinicId: ctx.data.clinic_id,
        patientPhone: ctx.data.patient_phone,
        conversationId: ctx.data.conversation_id,
        channel: ctx.data.canal,
      },
      input.data,
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ToolError) return NextResponse.json({ ok: false, error: e.message });
    console.error(`Error en herramienta ${name}`, e);
    return NextResponse.json(
      { ok: false, error: "Hubo un problema técnico. Disculpate y creá una tarea de derivacion_humana con el pedido." },
      { status: 500 },
    );
  }
}
