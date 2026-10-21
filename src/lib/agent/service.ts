import "server-only";
import { sql, pgErrorCode, type TransactionSql } from "../db";
import { getCatalog, getClinic, findPatientByPhone, getScheduleBlocks, isUuid } from "../clinic";
import { computeSlots, expandBlocks, isOpenAt, isSlotFree } from "../slots";
import { env } from "../env";
import { addDaysKey, humanSlot, localDateKey, parseDateKey } from "../time";
import { normalizePhone } from "../phone";
import { sendPatientMessage, whatsappReadiness } from "../whatsapp";
import { notifyN8n } from "../n8n";
import type { Appointment, AppointmentSource, Clinic, Patient, Task, TaskPriority, TaskType } from "../types";

export type ToolContext = {
  clinicId: string;
  patientPhone: string;
  conversationId?: string;
  channel?: string;
};

export class ToolError extends Error {}

const ACTIVE = ["confirmado", "pendiente"];

export function sourceFromChannel(channel: string | undefined, phone: string): AppointmentSource {
  const c = (channel ?? "").toLowerCase();
  if (c === "panel") return "panel";
  // El Custom Channel de ElevenLabs solo se usa para WhatsApp por WAHA.
  if (c.includes("whatsapp") || c.includes("custom")) return "whatsapp";
  if (/(twilio|sip|phone|telephon|exotel)/.test(c)) return "telefono";
  if (phone.startsWith("web-")) return "web";
  return c ? "web" : "whatsapp";
}

async function ensurePatient(ctx: ToolContext, name?: string): Promise<Patient> {
  const phone = normalizePhone(ctx.patientPhone);
  if (!phone || phone === "desconocido") throw new ToolError("No tengo el teléfono del paciente para identificarlo.");
  const existing = await findPatientByPhone(ctx.clinicId, phone);
  if (existing) {
    if (name && !existing.full_name) {
      const [updated] = await sql<Patient[]>`update patients set full_name = ${name} where id = ${existing.id} returning *`;
      return updated;
    }
    return existing;
  }
  // "on conflict" cubre dos herramientas que crean al mismo paciente en paralelo.
  const [created] = await sql<Patient[]>`
    insert into patients (clinic_id, phone, full_name, last_contact_at)
    values (${ctx.clinicId}, ${phone}, ${name ?? null}, now())
    on conflict (clinic_id, phone) do update set full_name = coalesce(patients.full_name, excluded.full_name)
    returning *`;
  return created;
}

// ---------------------------------------------------------------------------
// registrar_paciente
// ---------------------------------------------------------------------------
export async function registerPatient(
  ctx: ToolContext,
  input: {
    nombre_completo?: string;
    dni?: string;
    fecha_nacimiento?: string;
    email?: string;
    cobertura?: string;
    plan?: string;
    numero_afiliado?: string;
    preferencias?: string;
    no_recibir_mensajes?: boolean;
  },
) {
  const patient = await ensurePatient(ctx, input.nombre_completo);
  const patch: Partial<Patient> = { last_contact_at: new Date().toISOString() };
  if (input.nombre_completo) patch.full_name = input.nombre_completo;
  if (input.dni) patch.dni = input.dni.replace(/\D/g, "");
  if (input.fecha_nacimiento && parseDateKey(input.fecha_nacimiento)) patch.birth_date = parseDateKey(input.fecha_nacimiento);
  if (input.email) patch.email = input.email;
  if (input.cobertura) patch.coverage = input.cobertura;
  if (input.plan) patch.coverage_plan = input.plan;
  if (input.numero_afiliado) patch.member_number = input.numero_afiliado;
  if (input.preferencias) patch.preferences = input.preferencias;
  if (typeof input.no_recibir_mensajes === "boolean") patch.contact_opt_out = input.no_recibir_mensajes;
  const [updated] = await sql<Patient[]>`update patients set ${sql(patch)} where id = ${patient.id} returning *`;
  return {
    ok: true,
    mensaje: updated.contact_opt_out && input.no_recibir_mensajes
      ? "Listo: no le vamos a mandar más campañas ni avisos. Los recordatorios de sus propios turnos siguen llegando."
      : "Datos del paciente guardados.",
    paciente: {
      nombre: updated.full_name,
      dni: updated.dni,
      cobertura: updated.coverage,
      plan: updated.coverage_plan,
      numero_afiliado: updated.member_number,
    },
  };
}

// ---------------------------------------------------------------------------
// consultar_disponibilidad
// ---------------------------------------------------------------------------
export async function checkAvailability(
  ctx: ToolContext,
  input: { tipo_turno_id: string; profesional_id?: string; desde?: string; hasta?: string; franja?: "manana" | "tarde" | "cualquiera" },
) {
  const clinic = await getClinic(ctx.clinicId);
  const catalog = await getCatalog(clinic.id);
  const type = catalog.appointmentTypes.find((t) => t.id === input.tipo_turno_id);
  if (!type) throw new ToolError("No encontré ese tipo de turno. Usá un id del catálogo.");

  let professionals = catalog.professionals.filter((p) => p.specialty === type.specialty);
  if (input.profesional_id) professionals = professionals.filter((p) => p.id === input.profesional_id);
  if (!professionals.length) throw new ToolError("No hay profesionales que hagan ese tipo de turno.");

  const now = new Date();
  const today = localDateKey(now, clinic.timezone);
  let fromKey = parseDateKey(input.desde) ?? today;
  if (fromKey < today) fromKey = today;
  let toKey = parseDateKey(input.hasta) ?? addDaysKey(fromKey, 14);
  if (toKey < fromKey) toKey = addDaysKey(fromKey, 14);
  if (toKey > addDaysKey(fromKey, 60)) toKey = addDaysKey(fromKey, 60);

  const proIds = professionals.map((p) => p.id);
  const rangeStart = `${addDaysKey(fromKey, -1)}T00:00:00Z`;
  const rangeEnd = `${addDaysKey(toKey, 1)}T23:59:59Z`;
  const [busy, blocks] = await Promise.all([
    sql<Array<{ professional_id: string; starts_at: string; ends_at: string }>>`
      select professional_id, starts_at, ends_at from appointments
      where professional_id = any(${proIds}::uuid[])
        and status = any(${ACTIVE}::text[])
        and ends_at >= ${rangeStart} and starts_at <= ${rangeEnd}`,
    getScheduleBlocks(clinic.id, rangeStart, rangeEnd),
  ]);

  const slots = computeSlots({
    schedules: catalog.schedules.filter((s) => proIds.includes(s.professional_id)),
    busy,
    blocked: expandBlocks(blocks, proIds),
    durationMin: type.duration_min,
    fromKey,
    toKey,
    timeZone: clinic.timezone,
    now,
    partOfDay: input.franja,
    limit: 6,
    perDayPerProfessional: 2,
  });

  const names = new Map(professionals.map((p) => [p.id, p.full_name]));
  if (!slots.length) {
    return {
      ok: true,
      turnos: [],
      mensaje: `No hay turnos libres entre ${fromKey} y ${toKey}. Ofrecé buscar más adelante o anotar al paciente en la lista de espera.`,
    };
  }
  return {
    ok: true,
    tipo_turno: type.name,
    duracion_min: type.duration_min,
    indicaciones: type.instructions,
    turnos: slots.map((s) => ({
      profesional_id: s.professional_id,
      profesional: names.get(s.professional_id),
      inicio: s.starts_at,
      cuando: s.label,
    })),
    mensaje: "Ofrecé 2 o 3 opciones al paciente, leyendo el campo 'cuando'. Para reservar usá 'inicio' y 'profesional_id' tal cual.",
  };
}

// ---------------------------------------------------------------------------
// reservar_turno
// ---------------------------------------------------------------------------
async function assertBookable(clinic: Clinic, professionalId: string, typeId: string, startsAt: Date, ignoreAppointmentId?: string) {
  const catalog = await getCatalog(clinic.id);
  const type = catalog.appointmentTypes.find((t) => t.id === typeId);
  if (!type) throw new ToolError("Tipo de turno inválido.");
  const pro = catalog.professionals.find((p) => p.id === professionalId);
  if (!pro) throw new ToolError("Profesional inválido.");
  if (pro.specialty !== type.specialty) throw new ToolError(`${pro.full_name} no hace ${type.name}.`);
  if (Number.isNaN(startsAt.getTime())) throw new ToolError("La fecha de inicio no es válida. Usá el campo 'inicio' de consultar_disponibilidad.");
  if (startsAt.getTime() < Date.now()) throw new ToolError("Ese horario ya pasó.");

  const endsAt = new Date(startsAt.getTime() + type.duration_min * 60_000);
  const [busy, blocks] = await Promise.all([
    sql<Array<{ professional_id: string; starts_at: string; ends_at: string }>>`
      select professional_id, starts_at, ends_at from appointments
      where professional_id = ${pro.id}
        and status = any(${ACTIVE}::text[])
        and starts_at < ${endsAt} and ends_at > ${startsAt}
        ${ignoreAppointmentId ? sql`and id <> ${ignoreAppointmentId}` : sql``}`,
    getScheduleBlocks(clinic.id, startsAt, endsAt),
  ]);
  const check = isSlotFree(
    catalog.schedules.filter((s) => s.professional_id === pro.id),
    busy,
    startsAt,
    type.duration_min,
    clinic.timezone,
    expandBlocks(blocks, [pro.id]),
  );
  if (!check.ok) throw new ToolError(`${check.reason} Consultá la disponibilidad de nuevo y ofrecé otra opción.`);
  return { type, pro, endsAt };
}

/** La constraint appointments_no_overlap rechazó el turno: alguien lo tomó recién. */
const isOverlapError = (error: unknown) => pgErrorCode(error) === "23P01";


type NewAppointment = Pick<
  Appointment,
  "clinic_id" | "patient_id" | "professional_id" | "appointment_type_id" | "starts_at" | "ends_at" | "status" | "source" | "coverage" | "notes"
>;

/**
 * Serializa las reservas de cada profesional dentro de la transacción: si dos
 * pacientes piden el mismo horario a la vez, el segundo espera al primero y
 * choca limpio con appointments_no_overlap. Sin esto, Postgres puede cortar a
 * uno con "deadlock detected" y el agente no sabría explicarlo. Los locks se
 * toman en orden fijo y antes de tocar filas, para no cruzarse entre sí.
 */
async function lockProfessionals(tx: TransactionSql, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx`select pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`;
  }
}

async function insertAppointment(tx: TransactionSql, row: NewAppointment): Promise<Appointment> {
  const [appt] = await tx<Appointment[]>`insert into appointments ${tx(row)} returning *`;
  return appt;
}

export async function bookAppointment(
  ctx: ToolContext,
  input: { tipo_turno_id: string; profesional_id: string; inicio: string; nombre_completo?: string; cobertura?: string; notas?: string },
) {
  const clinic = await getClinic(ctx.clinicId);
  const patient = await ensurePatient(ctx, input.nombre_completo);
  if (!patient.full_name) throw new ToolError("Antes de reservar necesito el nombre y apellido del paciente (registrar_paciente).");

  const startsAt = new Date(input.inicio);
  const { type, pro, endsAt } = await assertBookable(clinic, input.profesional_id, input.tipo_turno_id, startsAt);
  const coverage = input.cobertura || patient.coverage;
  if (pro.accepted_coverages?.length && coverage && !pro.accepted_coverages.includes(coverage)) {
    throw new ToolError(`${pro.full_name} no atiende por ${coverage}. Atiende: ${pro.accepted_coverages.join(", ")}.`);
  }

  let appt: Appointment;
  try {
    appt = await sql.begin(async (tx) => {
      await lockProfessionals(tx, [pro.id]);
      return insertAppointment(tx, {
        clinic_id: clinic.id,
        patient_id: patient.id,
        professional_id: pro.id,
        appointment_type_id: type.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "confirmado",
        source: sourceFromChannel(ctx.channel, ctx.patientPhone),
        coverage: coverage ?? null,
        notes: input.notas ?? null,
      });
    });
  } catch (e) {
    if (isOverlapError(e)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw e;
  }

  // Si el paciente estaba en lista de espera para esto, la damos por resuelta.
  await sql`
    update waitlist set status = 'resuelta'
    where patient_id = ${patient.id} and appointment_type_id = ${type.id} and status in ('activa', 'ofrecida')`;

  await notifyN8n("turno.reservado", { clinic_id: clinic.id, appointment: appt, patient, professional: pro.full_name, type: type.name });

  return {
    ok: true,
    turno_id: appt.id,
    mensaje: `Turno confirmado: ${type.name} con ${pro.full_name} el ${humanSlot(startsAt, clinic.timezone)}.`,
    direccion: clinic.address,
    indicaciones: type.instructions,
  };
}

// ---------------------------------------------------------------------------
// ver_turnos_paciente
// ---------------------------------------------------------------------------
export async function listPatientAppointments(ctx: ToolContext) {
  const clinic = await getClinic(ctx.clinicId);
  const patient = await findPatientByPhone(clinic.id, normalizePhone(ctx.patientPhone));
  if (!patient) return { ok: true, turnos: [], mensaje: "El paciente no tiene turnos registrados." };
  const rows = await sql<
    Array<{ id: string; starts_at: string; status: string; professional_id: string; appointment_type_id: string; professional: string; type_name: string }>
  >`
    select a.id, a.starts_at, a.status, a.professional_id, a.appointment_type_id,
           pr.full_name as professional, t.name as type_name
    from appointments a
    join professionals pr on pr.id = a.professional_id
    join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = ${patient.id} and a.status = any(${ACTIVE}::text[]) and a.starts_at >= now()
    order by a.starts_at`;
  return {
    ok: true,
    turnos: rows.map((r) => ({
      turno_id: r.id,
      cuando: humanSlot(new Date(r.starts_at), clinic.timezone),
      inicio: r.starts_at,
      tipo_turno: r.type_name,
      tipo_turno_id: r.appointment_type_id,
      profesional: r.professional,
      profesional_id: r.professional_id,
      estado: r.status,
    })),
  };
}

async function getOwnAppointment(ctx: ToolContext, appointmentId: string) {
  const patient = await findPatientByPhone(ctx.clinicId, normalizePhone(ctx.patientPhone));
  if (!patient) throw new ToolError("No encontré al paciente.");
  const [appt] = isUuid(appointmentId)
    ? await sql<Appointment[]>`select * from appointments where id = ${appointmentId} and patient_id = ${patient.id}`
    : [];
  if (!appt) throw new ToolError("No encontré ese turno para este paciente. Usá ver_turnos_paciente.");
  if (!ACTIVE.includes(appt.status)) throw new ToolError(`Ese turno ya está ${appt.status}.`);
  return { patient, appt };
}

// ---------------------------------------------------------------------------
// confirmar_turno (el paciente avisa que va a venir, ej. tras un recordatorio)
// ---------------------------------------------------------------------------
export async function confirmAppointment(ctx: ToolContext, input: { turno_id: string }) {
  const clinic = await getClinic(ctx.clinicId);
  const { patient, appt } = await getOwnAppointment(ctx, input.turno_id);
  if (new Date(appt.starts_at).getTime() < Date.now()) throw new ToolError("Ese turno ya pasó.");
  await sql`update appointments set status = 'confirmado', confirmed_at = coalesce(confirmed_at, now()) where id = ${appt.id}`;
  await notifyN8n("turno.confirmado", { clinic_id: clinic.id, appointment: appt, patient });
  return {
    ok: true,
    mensaje: `Asistencia confirmada para el ${humanSlot(new Date(appt.starts_at), clinic.timezone)}. Recordale la dirección y las indicaciones previas si las hay.`,
    direccion: clinic.address,
  };
}

// ---------------------------------------------------------------------------
// cancelar_turno (+ ofrece el hueco a la lista de espera)
// ---------------------------------------------------------------------------
export async function cancelAppointment(ctx: ToolContext, input: { turno_id: string; motivo?: string }) {
  const clinic = await getClinic(ctx.clinicId);
  const { patient, appt } = await getOwnAppointment(ctx, input.turno_id);
  const notes = [appt.notes, input.motivo && `Cancelado: ${input.motivo}`].filter(Boolean).join(" | ");
  await sql`update appointments set status = 'cancelado', cancelled_at = now(), notes = ${notes || null} where id = ${appt.id}`;
  await notifyN8n("turno.cancelado", { clinic_id: clinic.id, appointment: appt, patient, motivo: input.motivo });
  const offered = await offerFreedSlot(clinic, appt).catch((e) => {
    console.error("No se pudo ofrecer el turno liberado", e);
    return 0;
  });
  return {
    ok: true,
    mensaje: `Turno del ${humanSlot(new Date(appt.starts_at), clinic.timezone)} cancelado. Ofrecé reprogramarlo.`,
    avisados_lista_espera: offered,
  };
}

/** Cuando se libera un turno, se lo ofrecemos por WhatsApp a quienes esperan (flujo "Activa"). */
export async function offerFreedSlot(clinic: Clinic, appt: Appointment): Promise<number> {
  if (new Date(appt.starts_at).getTime() < Date.now() + 2 * 3600_000) return 0;
  const template = clinic.templates?.lista_espera ?? (clinic.whatsapp_provider === "waha" ? "lista_espera" : null);
  if (!template || whatsappReadiness(clinic)) return 0;

  const entries = await sql<Array<{ id: string; patient_id: string; professional_id: string | null; full_name: string | null; phone: string }>>`
    select w.id, w.patient_id, w.professional_id, p.full_name, p.phone
    from waitlist w join patients p on p.id = w.patient_id
    where w.clinic_id = ${clinic.id} and w.status = 'activa' and w.appointment_type_id = ${appt.appointment_type_id}
      and w.patient_id <> ${appt.patient_id}
    order by w.created_at
    limit 10`;

  const candidates = entries
    .filter((e) => !e.professional_id || e.professional_id === appt.professional_id)
    .filter((e) => /^\d+$/.test(e.phone))
    .slice(0, 3);

  const when = humanSlot(new Date(appt.starts_at), clinic.timezone);
  let sent = 0;
  for (const entry of candidates) {
    const phone = entry.phone;
    const context = `Le escribimos para ofrecerle un turno que se liberó: ${when} (profesional_id=${appt.professional_id}, tipo_turno_id=${appt.appointment_type_id}, inicio=${appt.starts_at}). Si lo quiere, reservalo enseguida porque se ofreció a varias personas.`;
    try {
      await sendPatientMessage(clinic, {
        phone,
        templateKey: "lista_espera",
        templateName: template,
        params: [entry.full_name?.split(" ")[0] || "hola", when],
        context,
      });
      await sql`update waitlist set status = 'ofrecida', offered_at = now() where id = ${entry.id}`;
      sent++;
    } catch (e) {
      console.error("Fallo al ofrecer turno liberado", e);
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// reprogramar_turno
// ---------------------------------------------------------------------------
export async function rescheduleAppointment(ctx: ToolContext, input: { turno_id: string; nuevo_inicio: string; profesional_id?: string }) {
  const clinic = await getClinic(ctx.clinicId);
  const { patient, appt } = await getOwnAppointment(ctx, input.turno_id);
  const professionalId = input.profesional_id || appt.professional_id;
  const startsAt = new Date(input.nuevo_inicio);
  const { type, pro, endsAt } = await assertBookable(clinic, professionalId, appt.appointment_type_id, startsAt, appt.id);

  // En una transacción: liberamos el turno viejo (puede superponerse con el
  // nuevo) y reservamos el nuevo. Si algo falla, el viejo queda como estaba.
  let newAppt: Appointment;
  try {
    newAppt = await sql.begin(async (tx) => {
      await lockProfessionals(tx, [appt.professional_id, pro.id]);
      await tx`update appointments set status = 'reprogramado', cancelled_at = now() where id = ${appt.id}`;
      return insertAppointment(tx, {
        clinic_id: clinic.id,
        patient_id: patient.id,
        professional_id: pro.id,
        appointment_type_id: type.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "confirmado",
        source: sourceFromChannel(ctx.channel, ctx.patientPhone),
        coverage: appt.coverage,
        notes: appt.notes,
      });
    });
  } catch (e) {
    if (isOverlapError(e)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw e;
  }
  await notifyN8n("turno.reprogramado", { clinic_id: clinic.id, before: appt, after: newAppt, patient });
  await offerFreedSlot(clinic, appt).catch(() => 0);

  return {
    ok: true,
    turno_id: newAppt.id,
    mensaje: `Listo: el turno pasó al ${humanSlot(startsAt, clinic.timezone)} con ${pro.full_name}.`,
  };
}

// ---------------------------------------------------------------------------
// crear_tarea (recetas, consultas clínicas, derivación a una persona, urgencias)
// ---------------------------------------------------------------------------
export async function createTask(
  ctx: ToolContext,
  input: { tipo: TaskType; prioridad?: TaskPriority; titulo: string; detalle?: string },
) {
  let patientId: string | null = null;
  try {
    patientId = (await ensurePatient(ctx)).id;
  } catch {
    patientId = null;
  }
  const clinic = await getClinic(ctx.clinicId);
  const catalog = await getCatalog(clinic.id);
  const now = new Date();
  const blocks = await getScheduleBlocks(clinic.id, now, new Date(now.getTime() + 60_000));
  const openNow = isOpenAt(catalog.schedules, expandBlocks(blocks, catalog.professionals.map((p) => p.id)), now, clinic.timezone);
  const [task] = await sql<Task[]>`
    insert into tasks ${sql({
      clinic_id: clinic.id,
      patient_id: patientId,
      conversation_id: ctx.conversationId ?? null,
      type: input.tipo,
      priority: input.prioridad ?? (input.tipo === "urgencia" ? "urgente" : "normal"),
      title: input.titulo,
      details: input.detalle ?? null,
    })}
    returning *`;
  // n8n avisa a recepción con el link al panel (derivación a una persona, urgencias, recetas…).
  await notifyN8n("tarea.creada", {
    clinic_id: clinic.id,
    task,
    fuera_de_horario: !openNow,
    panel_url: `${env.appUrl().replace(/\/$/, "")}/panel/tareas`,
  });
  return {
    ok: true,
    tarea_id: task.id,
    mensaje: openNow
      ? "Tarea creada para el equipo. Avisale al paciente que lo van a contactar a la brevedad."
      : "Tarea creada para el equipo. Ahora estamos fuera del horario de atención: avisale al paciente que lo contactan apenas abramos, y si es urgente repetí las indicaciones de urgencia.",
  };
}

// ---------------------------------------------------------------------------
// anotar_lista_espera
// ---------------------------------------------------------------------------
export async function joinWaitlist(ctx: ToolContext, input: { tipo_turno_id: string; profesional_id?: string; preferencias?: string }) {
  const patient = await ensurePatient(ctx);
  const catalog = await getCatalog(ctx.clinicId);
  if (!catalog.appointmentTypes.some((t) => t.id === input.tipo_turno_id)) throw new ToolError("Tipo de turno inválido.");
  const professionalId = input.profesional_id && catalog.professionals.some((p) => p.id === input.profesional_id) ? input.profesional_id : null;
  await sql`
    insert into waitlist ${sql({
      clinic_id: ctx.clinicId,
      patient_id: patient.id,
      appointment_type_id: input.tipo_turno_id,
      professional_id: professionalId,
      preferences: input.preferencias ?? null,
    })}`;
  return { ok: true, mensaje: "Paciente anotado en la lista de espera. Si se libera un turno le escribimos por WhatsApp." };
}
