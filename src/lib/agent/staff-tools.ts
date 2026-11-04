import "server-only";
import { sql } from "../db";
import { getCatalog, getClinic, isUuid } from "../clinic";
import { normalizePhone } from "../phone";
import { findOrCreatePatientForPhone } from "../patients";
import { createScheduleBlock } from "../schedule-blocks";
import { resolveTask } from "../tasks";
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
  const rows = await sql<Array<{ id: string; starts_at: string; ends_at: string; status: string; patient: string | null; patient_id: string; phone: string | null; type_name: string; professional: string; notes: string | null }>>`
    select a.id, a.starts_at, a.ends_at, a.status, p.full_name as patient, p.id as patient_id, p.phone,
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
      ...(r.notes && { notas: r.notes }),
    })),
    mensaje: rows.length
      ? "Contale la agenda en orden, en pocas líneas (hora, paciente y prestación). Para mover o cancelar uno, usá su turno_id."
      : "No hay turnos en esas fechas.",
  };
}

/** buscar_pacientes: por nombre, DNI o celular, con sus próximos turnos. */
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
      : "No encontré a nadie así. Si es nuevo, pedile nombre y apellido, DNI y celular y usá crear_paciente.",
  };
}

/** crear_paciente: una ficha nueva, para darle un turno a alguien que todavía no es paciente. */
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
