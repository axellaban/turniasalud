import "server-only";
import { sql } from "../db";
import { readWaitlist, type WaitlistFilters } from "../waitlist";
import { getCatalog, getClinic, isUuid } from "../clinic";
import { displayPhone, normalizePhone } from "../phone";
import { PAUSE_HOURS, isMuted, muteNumber, unmuteNumber } from "../chat-guard";
import { staffForPhone } from "../staff";
import { findOrCreatePatientForPhone } from "../patients";
import { createScheduleBlock } from "../schedule-blocks";
import { resolveTask } from "../tasks";
import { appointmentDetail, givenBy, summarySince } from "../daily-summary";
import { addDaysKey, humanSlot, localDateKey, parseDateKey, zonedTimeToUtc } from "../time";
import { ToolError, type ToolContext } from "./service";

// Herramientas de Sofi para el equipo del consultorio por WhatsApp (acceso total). La ruta
// decide quién es del equipo; acá se exige otra vez, por si una herramienta se llama sin eso.

function requireStaff(ctx: ToolContext): void {
  if (!ctx.staff) throw new ToolError("Esta herramienta es solo para el equipo del consultorio. Con un paciente, seguí con las herramientas de siempre.");
}

/** Inicio de un día (AAAA-MM-DD) en la zona de la clínica. */
function dayStart(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, 0, 0, timeZone);
}

/** Lista actual, solo para los números autorizados del consultorio. */
export async function viewWaitlist(ctx: ToolContext, input: WaitlistFilters) {
  requireStaff(ctx);
  return readWaitlist(ctx.clinicId, input);
}

const STATUS_LABEL: Record<string, string> = {
  confirmado: "confirmado",
  pendiente: "falta confirmar",
  atendido: "atendido",
  ausente: "ausente",
};

/** ver_agenda: los turnos de uno o varios días (hasta 14), de toda la clínica o de un profesional. */
export async function viewAgenda(ctx: ToolContext, input: { desde?: string; hasta?: string; profesional_id?: string }) {
  requireStaff(ctx);
  const clinic = await getClinic(ctx.clinicId);
  const today = localDateKey(new Date(), clinic.timezone);
  const fromKey = parseDateKey(input.desde) ?? today;
  let toKey = parseDateKey(input.hasta) ?? fromKey;
  if (toKey < fromKey) toKey = fromKey;
  if (toKey > addDaysKey(fromKey, 13)) toKey = addDaysKey(fromKey, 13);
  const pro = input.profesional_id && isUuid(input.profesional_id) ? input.profesional_id : null;
  const rows = await sql<Array<{ id: string; starts_at: string; ends_at: string; status: string; patient: string | null; patient_id: string; phone: string | null; type_name: string; professional: string; notes: string | null; source: string }>>`
    select a.id, a.starts_at, a.ends_at, a.status, a.source, p.full_name as patient, p.id as patient_id, p.phone,
      coalesce(a.title, t.name) as type_name, pr.full_name || coalesce(' y ' || p2.full_name, '') as professional, a.notes
    from appointments a
    join patients p on p.id = a.patient_id
    join appointment_types t on t.id = a.appointment_type_id
    join professionals pr on pr.id = a.professional_id
    left join professionals p2 on p2.id = a.second_professional_id
    where a.clinic_id = ${clinic.id} and a.status in ('confirmado', 'pendiente', 'atendido', 'ausente')
      and a.starts_at >= ${dayStart(fromKey, clinic.timezone)} and a.starts_at < ${dayStart(addDaysKey(toKey, 1), clinic.timezone)}
      ${pro ? sql`and (a.professional_id = ${pro} or a.second_professional_id = ${pro})` : sql``}
    order by a.starts_at
    limit 120`;
  return {
    ok: true,
    desde: fromKey,
    hasta: toKey,
    turnos: rows.map((r) => ({
      turno_id: r.id,
      cuando: humanSlot(new Date(r.starts_at), clinic.timezone),
      paciente: r.patient ?? "Paciente sin nombre",
      paciente_id: r.patient_id,
      prestacion: r.type_name,
      profesional: r.professional,
      estado: STATUS_LABEL[r.status] ?? r.status,
      dio: givenBy(r.source, clinic.agent_name),
      ...(r.notes && { notas: r.notes }),
    })),
    mensaje: rows.length
      ? "Contale la agenda en orden, en pocas líneas (hora, paciente y prestación). Si pregunta quién dio un turno, está en «dio»; para todos sus datos, usá detalle_turno. Para mover o cancelar uno, usá su turno_id."
      : "No hay turnos en esas fechas.",
  };
}

/** equipo_buscar_pacientes: por nombre, DNI o celular, con sus próximos turnos. */
export async function searchPatients(ctx: ToolContext, input: { texto: string }) {
  requireStaff(ctx);
  const text = input.texto.trim();
  if (text.length < 2) throw new ToolError("Pedile al menos dos letras del nombre, el DNI o el celular.");
  const pattern = `%${text}%`;
  const digits = text.replace(/\D/g, "");
  const rows = await sql<Array<{ id: string; full_name: string | null; dni: string | null; phone: string | null; coverage: string | null; coverage_plan: string | null }>>`
    select id, full_name, dni, phone, coverage, coverage_plan from patients
    where clinic_id = ${ctx.clinicId}
      and (full_name ilike ${pattern} or dni ilike ${pattern} ${digits.length >= 6 ? sql`or phone like ${`%${digits}%`}` : sql``})
    order by full_name nulls last
    limit 8`;
  const upcoming = rows.length
    ? await sql<Array<{ patient_id: string; id: string; starts_at: string; type_name: string }>>`
        select a.patient_id, a.id, a.starts_at, coalesce(a.title, t.name) as type_name
        from appointments a join appointment_types t on t.id = a.appointment_type_id
        where a.patient_id = any(${rows.map((r) => r.id)}::uuid[]) and a.status in ('confirmado', 'pendiente') and a.starts_at >= now()
        order by a.starts_at`
    : [];
  const clinic = await getClinic(ctx.clinicId);
  return {
    ok: true,
    pacientes: rows.map((r) => ({
      paciente_id: r.id,
      nombre: r.full_name ?? "Sin nombre",
      ...(r.dni && { dni: r.dni }),
      ...(r.phone && { celular: r.phone }),
      cobertura: r.coverage ? `${r.coverage}${r.coverage_plan ? ` ${r.coverage_plan}` : ""}` : "sin dato",
      proximos_turnos: upcoming.filter((a) => a.patient_id === r.id).slice(0, 3).map((a) => ({ turno_id: a.id, cuando: humanSlot(new Date(a.starts_at), clinic.timezone), prestacion: a.type_name })),
    })),
    mensaje: rows.length
      ? "Si hay más de uno, preguntale cuál es. Para darle o moverle un turno, usá su paciente_id."
      : "No encontré a nadie así. Si es nuevo, pedile nombre y apellido, DNI y celular y creá la ficha nueva con la herramienta del equipo para crear pacientes.",
  };
}

/** equipo_crear_paciente: una ficha nueva, para darle un turno a alguien que todavía no es paciente. */
export async function createPatientForStaff(
  ctx: ToolContext,
  input: { nombre_completo: string; celular?: string; dni?: string; cobertura?: string; plan?: string },
) {
  requireStaff(ctx);
  const name = input.nombre_completo.trim();
  if (name.length < 3) throw new ToolError("Necesito el nombre y apellido.");
  const phone = normalizePhone(input.celular);
  const dni = input.dni?.replace(/\D/g, "") || null;
  if (dni) {
    const [same] = await sql<Array<{ id: string; full_name: string | null }>>`select id, full_name from patients where clinic_id = ${ctx.clinicId} and dni = ${dni} limit 1`;
    if (same) return { ok: true, paciente_id: same.id, mensaje: `Ya tenía ficha: ${same.full_name ?? "sin nombre"}. Usá este paciente_id.` };
  }
  const fields = { dni, coverage: input.cobertura?.trim() || null, coverage_plan: input.plan?.trim() || null };
  let id: string;
  if (/^\d{8,15}$/.test(phone)) {
    const { patient, created } = await findOrCreatePatientForPhone(ctx.clinicId, phone, { name });
    if (!created && patient.full_name && patient.full_name.toLowerCase() !== name.toLowerCase()) {
      return { ok: true, paciente_id: patient.id, mensaje: `Ese celular ya es de ${patient.full_name}. Si es otra persona, creala sin celular. Si es la misma, usá este paciente_id.` };
    }
    id = patient.id;
    await sql`update patients set full_name = coalesce(full_name, ${name}), dni = coalesce(dni, ${fields.dni}), coverage = coalesce(coverage, ${fields.coverage}), coverage_plan = coalesce(coverage_plan, ${fields.coverage_plan}) where id = ${id}`;
  } else {
    [{ id }] = await sql<Array<{ id: string }>>`
      insert into patients (clinic_id, full_name, dni, coverage, coverage_plan) values (${ctx.clinicId}, ${name}, ${fields.dni}, ${fields.coverage}, ${fields.coverage_plan}) returning id`;
  }
  return { ok: true, paciente_id: id, mensaje: "Ficha lista. Para darle un turno, usá este paciente_id en consultar_disponibilidad y reservar_turno." };
}

/** bloquear_agenda: un feriado, vacaciones o un rato sin atender, de la clínica o de un profesional. */
export async function blockAgenda(
  ctx: ToolContext,
  input: { desde: string; hasta?: string; hora_desde?: string; hora_hasta?: string; profesional_id?: string; motivo?: string },
) {
  requireStaff(ctx);
  const clinic = await getClinic(ctx.clinicId);
  if (input.profesional_id && !(await getCatalog(clinic.id)).professionals.some((p) => p.id === input.profesional_id)) {
    throw new ToolError("No encontré ese profesional. Usá un id del catálogo.");
  }
  const result = await createScheduleBlock(clinic, {
    professionalId: input.profesional_id || null,
    from: input.desde,
    to: input.hasta,
    timeFrom: input.hora_desde,
    timeTo: input.hora_hasta,
    reason: input.motivo ?? `Bloqueado por ${ctx.staff!.name} por WhatsApp`,
  });
  if (!result.ok) throw new ToolError(result.message);
  await sql`update clinics set updated_at = now(), context_revision = context_revision + 1 where id = ${clinic.id}`;
  return {
    ok: true,
    mensaje: `Agenda bloqueada del ${humanSlot(result.startsAt, clinic.timezone)} al ${humanSlot(result.endsAt, clinic.timezone)}.${
      result.affected ? ` Ojo: ya hay ${result.affected} turno(s) en ese período; no se cancelan solos. Preguntale si los movés o los cancelás (con ver_agenda los ves).` : ""
    }`,
  };
}

/** ver_tareas: los pedidos al equipo que siguen abiertos. */
export async function listOpenTasks(ctx: ToolContext) {
  requireStaff(ctx);
  const clinic = await getClinic(ctx.clinicId);
  const rows = await sql<Array<{ id: string; type: string; priority: string; title: string; details: string | null; created_at: string; patient: string | null }>>`
    select t.id, t.type, t.priority, t.title, t.details, t.created_at, p.full_name as patient
    from tasks t left join patients p on p.id = t.patient_id
    where t.clinic_id = ${clinic.id} and t.status <> 'resuelta'
    order by case t.priority when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end, t.created_at
    limit 20`;
  return {
    ok: true,
    tareas: rows.map((t) => ({
      tarea_id: t.id,
      tipo: t.type,
      prioridad: t.priority,
      titulo: t.title,
      ...(t.patient && { paciente: t.patient }),
      ...(t.details && { detalle: t.details }),
      pedido: humanSlot(new Date(t.created_at), clinic.timezone),
    })),
    mensaje: rows.length ? "Contale primero las urgentes. Para cerrar una, usá resolver_tarea (con respuesta, le llega al paciente)." : "No hay pedidos abiertos.",
  };
}

/** resolver_tarea: cierra un pedido; con respuesta, se la manda al paciente por WhatsApp. */
export async function resolveTaskForStaff(ctx: ToolContext, input: { tarea_id: string; respuesta?: string }) {
  requireStaff(ctx);
  if (!isUuid(input.tarea_id)) throw new ToolError("No encontré esa tarea. Usá ver_tareas.");
  const result = await resolveTask(ctx.clinicId, input.tarea_id, input.respuesta?.trim() || null);
  if (!result.ok) throw new ToolError(result.message);
  return { ok: true, mensaje: result.message };
}

/** detalle_turno: todo lo de un turno, para cargarlo en el sistema del consultorio (quién lo dio, datos y nota). */
export async function appointmentDetailForStaff(ctx: ToolContext, input: { turno_id: string }) {
  requireStaff(ctx);
  if (!isUuid(input.turno_id)) throw new ToolError("No encontré ese turno. Buscalo con ver_agenda (el día y la hora).");
  const clinic = await getClinic(ctx.clinicId);
  const detail = await appointmentDetail(clinic, input.turno_id);
  if (!detail) throw new ToolError("No encontré ese turno. Buscalo con ver_agenda (el día y la hora).");
  return {
    ok: true,
    turno: detail,
    mensaje:
      "Contale quién lo dio y cuándo, el paciente (nombre, DNI, celular), la prestación, la cobertura y lo que pidió. Pasale la «nota» tal cual, en un renglón aparte, para que la copie en su agenda.",
  };
}

/** turnos_de_sofi: lo que diste, moviste y cancelaste desde un día (como el resumen de las 10). */
export async function agentActivityForStaff(ctx: ToolContext, input: { desde?: string }) {
  requireStaff(ctx);
  const clinic = await getClinic(ctx.clinicId);
  const today = localDateKey(new Date(), clinic.timezone);
  let fromKey = parseDateKey(input.desde) ?? addDaysKey(today, -1);
  if (fromKey > today) fromKey = today;
  if (fromKey < addDaysKey(today, -31)) fromKey = addDaysKey(today, -31);
  const summary = await summarySince(clinic.id, dayStart(fromKey, clinic.timezone));
  const brief = (items: typeof summary.nuevos) => items.slice(0, 40).map(({ turno_id, cuando, profesional, paciente, prestacion, nota, antes, motivo, dio }) => ({
    turno_id, cuando, profesional, paciente, prestacion, nota, dio, ...(antes && { antes }), ...(motivo && { motivo }),
  }));
  return {
    ok: true,
    desde: fromKey,
    nuevos: brief(summary.nuevos),
    movidos: brief(summary.movidos),
    cancelados: brief(summary.cancelados),
    mensaje:
      summary.nuevos.length + summary.movidos.length + summary.cancelados.length
        ? "Contale primero cuántos fueron y después cada uno (día y hora, profesional, paciente y prestación). Para todos los datos de uno, usá detalle_turno."
        : "Desde ese día no diste, moviste ni cancelaste turnos.",
  };
}

/** El celular del chat que el equipo quiere pausar o reactivar: el que dijo o el de la ficha elegida. */
async function chatPhoneFor(ctx: ToolContext, celular: string | undefined): Promise<string> {
  if (ctx.patientId) {
    const [p] = await sql<{ phone: string | null }[]>`select phone from patients where id = ${ctx.patientId} and clinic_id = ${ctx.clinicId}`;
    if (!p?.phone) throw new ToolError("Esa ficha no tiene celular. Pedile el número del chat.");
    return p.phone;
  }
  const phone = normalizePhone(celular);
  if (!/^\d{10,15}$/.test(phone)) throw new ToolError("Necesito el celular del paciente (con código de área) o su paciente_id.");
  return phone;
}

/** pausar_chat: el equipo le contesta desde el celular del consultorio y Sofi no responde a ese número por un rato. */
export async function pauseChatForStaff(ctx: ToolContext, input: { celular?: string; horas?: number }) {
  requireStaff(ctx);
  const hours = PAUSE_HOURS.includes(input.horas as (typeof PAUSE_HOURS)[number]) ? (input.horas as number) : 4;
  const phone = await chatPhoneFor(ctx, input.celular);
  if (normalizePhone(ctx.patientPhone) === phone) throw new ToolError("Ese es tu propio número: la pausa es para el chat de un paciente.");
  if (await staffForPhone(ctx.clinicId, phone)) throw new ToolError("Ese número es del equipo: no se pausa.");
  await muteNumber(ctx.clinicId, phone, "equipo", `La pausó ${ctx.staff!.name} por WhatsApp: el equipo atiende este chat.`, hours);
  return {
    ok: true,
    celular: displayPhone(phone),
    horas: hours,
    mensaje: `Listo: no le contesto a ${displayPhone(phone)} por ${hours === 1 ? "1 hora" : hours < 24 ? `${hours} horas` : hours === 24 ? "1 día" : `${hours / 24} días`}. Los avisos y confirmaciones de turnos siguen saliendo. Para que vuelva a contestar, pedímelo o reactivalo desde el panel.`,
  };
}

/** reactivar_chat: Sofi vuelve a contestar en un chat que estaba en pausa. */
export async function reactivateChatForStaff(ctx: ToolContext, input: { celular?: string }) {
  requireStaff(ctx);
  const phone = await chatPhoneFor(ctx, input.celular);
  const wasMuted = await isMuted(ctx.clinicId, phone);
  await unmuteNumber(ctx.clinicId, phone);
  return {
    ok: true,
    celular: displayPhone(phone),
    mensaje: wasMuted ? `Listo: vuelvo a contestarle a ${displayPhone(phone)}.` : `Ese chat no estaba en pausa: le contesto como siempre.`,
  };
}
