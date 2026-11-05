import { NextResponse } from "next/server";
import { syncCalendarLater } from "@/lib/calendar/sync";
import { readAppointmentAccess } from "@/lib/agent/appointment-access";
import { hasValidSecret } from "@/lib/agent/auth";
import { contextSchema, getToolDefinition } from "@/lib/agent/tools";
import {
  bookAppointment,
  cancelAppointment,
  checkAvailability,
  confirmAppointment,
  createTask,
  findPatientByDni,
  joinWaitlist,
  listPatientAppointments,
  muteSender,
  registerPatient,
  rescheduleAppointment,
  saveHealthForm,
  sourceFromChannel,
  ToolError,
  type ToolContext,
} from "@/lib/agent/service";
import { blockAgenda, createPatientForStaff, listOpenTasks, resolveTaskForStaff, searchPatients, viewAgenda } from "@/lib/agent/staff-tools";
import { isUuid } from "@/lib/clinic";
import { sql } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { staffForPhone } from "@/lib/staff";

export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HANDLERS: Record<string, (ctx: ToolContext, input: any) => Promise<unknown>> = {
  buscar_paciente: findPatientByDni,
  registrar_paciente: registerPatient,
  consultar_disponibilidad: checkAvailability,
  reservar_turno: bookAppointment,
  ver_turnos_paciente: listPatientAppointments,
  confirmar_turno: confirmAppointment,
  cancelar_turno: cancelAppointment,
  reprogramar_turno: rescheduleAppointment,
  crear_tarea: createTask,
  anotar_lista_espera: joinWaitlist,
  guardar_ficha_salud: saveHealthForm,
  silenciar_numero: muteSender,
  // Equipo del consultorio (acceso total por WhatsApp).
  ver_agenda: viewAgenda,
  buscar_pacientes: searchPatients,
  crear_paciente: createPatientForStaff,
  bloquear_agenda: blockAgenda,
  ver_tareas: listOpenTasks,
  resolver_tarea: resolveTaskForStaff,
};

const CHANGES_AGENDA = new Set(["reservar_turno", "confirmar_turno", "cancelar_turno", "reprogramar_turno"]);
const TEMPORARY_TOOLS = new Set(["ver_turnos_paciente", "confirmar_turno", "cancelar_turno", "reprogramar_turno"]);

/**
 * ¿Le escribe alguien del equipo del consultorio? Solo por WhatsApp, donde el número lo garantiza
 * WhatsApp. Alcanza con una de dos señales: el canal que informa ElevenLabs (variable de sistema,
 * que no se puede cambiar desde afuera) o que la conversación la abrió nuestra línea (webhook firmado
 * de WAHA) para ese mismo número. Por teléfono el número de quien llama se puede falsear, y la web
 * no tiene número: ahí nunca hay acceso del equipo.
 */
async function staffOf(clinicId: string, phone: string, channel: string | undefined, conversationId: string | undefined) {
  const normalized = normalizePhone(phone);
  if (!/^\d{8,15}$/.test(normalized)) return null;
  const viaWhatsapp = Boolean(channel?.trim()) && sourceFromChannel(channel, normalized) === "whatsapp";
  if (!viaWhatsapp) {
    if (!conversationId) return null;
    const [chat] = await sql`
      select 1 from channel_conversations
      where clinic_id = ${clinicId} and elevenlabs_conversation_id = ${conversationId} and phone = ${normalized}
        and chat_id not like 'telegram:%'
      limit 1`;
    if (!chat) return null;
  }
  return staffForPhone(clinicId, normalized);
}

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

  // Una línea JSON por llamada: en Vercel → Logs se puede filtrar por herramienta y resultado.
  const started = Date.now();
  const log = (resultado: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ evento: "herramienta", herramienta: name, resultado, ms: Date.now() - started, conversacion: ctx.data.conversation_id, canal: ctx.data.canal, ...extra }));
  try {
    const staff = await staffOf(ctx.data.clinic_id, ctx.data.patient_phone, ctx.data.canal, ctx.data.conversation_id);
    // El equipo puede pedir por otro paciente (paciente_id); un paciente, no.
    const { paciente_id: patientId, ...toolInput } = input.data as { paciente_id?: string };
    if (patientId) {
      if (!staff) throw new ToolError("Pedir por otro paciente es solo para el equipo del consultorio. Seguí con la ficha de este número.");
      const [patient] = isUuid(patientId) ? await sql`select id from patients where id = ${patientId} and clinic_id = ${ctx.data.clinic_id}` : [];
      if (!patient) throw new ToolError("No encontré ese paciente. Usá buscar_pacientes.");
    }
    const context: ToolContext = {
      clinicId: ctx.data.clinic_id,
      patientPhone: ctx.data.patient_phone,
      conversationId: ctx.data.conversation_id,
      channel: ctx.data.canal,
      staff: staff ? { name: staff.name } : null,
      ...(patientId && { patientId }),
    };
    // El equipo actúa como el consultorio: no depende de una verificación temporal de paciente.
    if (name !== "buscar_paciente" && !staff) {
      const access = await readAppointmentAccess(context);
      const receptionTask = name === "crear_tarea" && ["derivacion_humana", "urgencia"].includes(String(input.data.tipo));
      if (access && !access.active && !receptionTask) {
        throw new ToolError("La verificación temporal venció. Volvé a verificar la identidad para gestionar el turno.");
      }
      if (access?.active) {
        const searchingMove = name === "consultar_disponibilidad" && Boolean(input.data.turno_id);
        if (!TEMPORARY_TOOLS.has(name) && !searchingMove && !receptionTask) {
          throw new ToolError("Esta verificación solo permite gestionar turnos existentes. Para otros trámites, ofrecé que recepción lo revise.");
        }
        context.appointmentPatientId = access.patient_id;
      }
    }
    const result = await handler(context, toolInput);
    log("ok");
    // Los turnos nuevos o cambiados se escriben en Google Calendar sin demorar la respuesta.
    if (CHANGES_AGENDA.has(name)) syncCalendarLater(ctx.data.clinic_id);
    if (staff) log("equipo", { equipo: staff.name });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ToolError) {
      log("rechazo", { motivo: e.message });
      return NextResponse.json({ ok: false, error: e.message });
    }
    log("error");
    console.error(`Error en herramienta ${name}`, e);
    return NextResponse.json(
      { ok: false, error: "Hubo un problema técnico. Disculpate y creá una tarea de derivacion_humana con el pedido." },
      { status: 500 },
    );
  }
}
