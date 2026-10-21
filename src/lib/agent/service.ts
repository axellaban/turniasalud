import "server-only";
import { db, unwrap } from "../supabase";
import { getCatalog, getClinic, findPatientByPhone, buildDynamicVariables } from "../clinic";
import { computeSlots, isSlotFree } from "../slots";
import { addDaysKey, humanSlot, localDateKey, parseDateKey } from "../time";
import { normalizePhone } from "../phone";
import { sendWhatsAppTemplate } from "../elevenlabs";
import { notifyN8n } from "../n8n";
import type { Appointment, AppointmentSource, Clinic, Patient, TaskPriority, TaskType } from "../types";

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
  if (c.includes("whatsapp")) return "whatsapp";
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
      const updated = unwrap(
        await db().from("patients").update({ full_name: name }).eq("id", existing.id).select("*").single(),
        "actualizar paciente",
      );
      return updated as Patient;
    }
    return existing;
  }
  const created = unwrap(
    await db()
      .from("patients")
      .insert({ clinic_id: ctx.clinicId, phone, full_name: name ?? null, last_contact_at: new Date().toISOString() })
      .select("*")
      .single(),
    "crear paciente",
  );
  return created as Patient;
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
  const updated = unwrap(
    await db().from("patients").update(patch).eq("id", patient.id).select("*").single(),
    "actualizar paciente",
  ) as Patient;
  return {
    ok: true,
    mensaje: "Datos del paciente guardados.",
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
  const busy = unwrap(
    await db()
      .from("appointments")
      .select("professional_id, starts_at, ends_at")
      .in("professional_id", proIds)
      .in("status", ACTIVE)
      .gte("ends_at", new Date(`${fromKey}T00:00:00Z`).toISOString())
      .lte("starts_at", new Date(`${addDaysKey(toKey, 1)}T23:59:59Z`).toISOString()),
    "turnos ocupados",
  ) as Array<{ professional_id: string; starts_at: string; ends_at: string }>;

  const slots = computeSlots({
    schedules: catalog.schedules.filter((s) => proIds.includes(s.professional_id)),
    busy,
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
  let q = db()
    .from("appointments")
    .select("professional_id, starts_at, ends_at, id")
    .eq("professional_id", pro.id)
    .in("status", ACTIVE)
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString());
  if (ignoreAppointmentId) q = q.neq("id", ignoreAppointmentId);
  const busy = unwrap(await q, "turnos ocupados") as Array<{ professional_id: string; starts_at: string; ends_at: string }>;
  const check = isSlotFree(
    catalog.schedules.filter((s) => s.professional_id === pro.id),
    busy,
    startsAt,
    type.duration_min,
    clinic.timezone,
  );
  if (!check.ok) throw new ToolError(`${check.reason} Consultá la disponibilidad de nuevo y ofrecé otra opción.`);
  return { type, pro, endsAt };
}

function isOverlapError(error: { code?: string; message: string } | null): boolean {
  return Boolean(error && (error.code === "23P01" || error.message.includes("appointments_no_overlap")));
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

  const result = await db()
    .from("appointments")
    .insert({
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
    })
    .select("*")
    .single();
  if (isOverlapError(result.error)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
  const appt = unwrap(result, "reservar turno") as Appointment;

  // Si el paciente estaba en lista de espera para esto, la damos por resuelta.
  await db()
    .from("waitlist")
    .update({ status: "resuelta" })
    .eq("patient_id", patient.id)
    .eq("appointment_type_id", type.id)
    .in("status", ["activa", "ofrecida"]);

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
  const rows = unwrap(
    await db()
      .from("appointments")
      .select("id, starts_at, status, professional_id, appointment_type_id, professionals(full_name), appointment_types(name)")
      .eq("patient_id", patient.id)
      .in("status", ACTIVE)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at"),
    "turnos",
  ) as unknown as Array<{
    id: string;
    starts_at: string;
    status: string;
    professional_id: string;
    appointment_type_id: string;
    professionals: { full_name: string } | null;
    appointment_types: { name: string } | null;
  }>;
  return {
    ok: true,
    turnos: rows.map((r) => ({
      turno_id: r.id,
      cuando: humanSlot(new Date(r.starts_at), clinic.timezone),
      inicio: r.starts_at,
      tipo_turno: r.appointment_types?.name,
      tipo_turno_id: r.appointment_type_id,
      profesional: r.professionals?.full_name,
      profesional_id: r.professional_id,
      estado: r.status,
    })),
  };
}

async function getOwnAppointment(ctx: ToolContext, appointmentId: string) {
  const patient = await findPatientByPhone(ctx.clinicId, normalizePhone(ctx.patientPhone));
  if (!patient) throw new ToolError("No encontré al paciente.");
  const r = await db().from("appointments").select("*").eq("id", appointmentId).eq("patient_id", patient.id).maybeSingle();
  if (r.error || !r.data) throw new ToolError("No encontré ese turno para este paciente. Usá ver_turnos_paciente.");
  const appt = r.data as Appointment;
  if (!ACTIVE.includes(appt.status)) throw new ToolError(`Ese turno ya está ${appt.status}.`);
  return { patient, appt };
}

// ---------------------------------------------------------------------------
// cancelar_turno (+ ofrece el hueco a la lista de espera)
// ---------------------------------------------------------------------------
export async function cancelAppointment(ctx: ToolContext, input: { turno_id: string; motivo?: string }) {
  const clinic = await getClinic(ctx.clinicId);
  const { patient, appt } = await getOwnAppointment(ctx, input.turno_id);
  const notes = [appt.notes, input.motivo && `Cancelado: ${input.motivo}`].filter(Boolean).join(" | ");
  unwrap(
    await db()
      .from("appointments")
      .update({ status: "cancelado", cancelled_at: new Date().toISOString(), notes: notes || null })
      .eq("id", appt.id)
      .select("id")
      .single(),
    "cancelar turno",
  );
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
  const template = clinic.templates?.lista_espera;
  if (!template || !clinic.whatsapp_phone_number_id || !clinic.elevenlabs_agent_id || !process.env.ELEVENLABS_API_KEY) return 0;

  const entries = unwrap(
    await db()
      .from("waitlist")
      .select("id, patient_id, professional_id, patients(full_name, phone)")
      .eq("clinic_id", clinic.id)
      .eq("status", "activa")
      .eq("appointment_type_id", appt.appointment_type_id)
      .order("created_at")
      .limit(10),
    "lista de espera",
  ) as unknown as Array<{ id: string; patient_id: string; professional_id: string | null; patients: { full_name: string | null; phone: string } | null }>;

  const candidates = entries
    .filter((e) => !e.professional_id || e.professional_id === appt.professional_id)
    .filter((e) => e.patients && /^\d+$/.test(e.patients.phone))
    .slice(0, 3);

  const when = humanSlot(new Date(appt.starts_at), clinic.timezone);
  let sent = 0;
  for (const entry of candidates) {
    const phone = entry.patients!.phone;
    const context = `Le escribimos para ofrecerle un turno que se liberó: ${when} (profesional_id=${appt.professional_id}, tipo_turno_id=${appt.appointment_type_id}, inicio=${appt.starts_at}). Si lo quiere, reservalo enseguida porque se ofreció a varias personas.`;
    try {
      await sendWhatsAppTemplate({
        phoneNumberId: clinic.whatsapp_phone_number_id,
        userId: phone,
        templateName: template,
        language: clinic.templates?.idioma || "es_AR",
        params: [entry.patients!.full_name?.split(" ")[0] || "hola", when],
        agentId: clinic.elevenlabs_agent_id,
        dynamicVariables: await buildDynamicVariables(clinic, phone, { context }),
      });
      await db().from("waitlist").update({ status: "ofrecida", offered_at: new Date().toISOString() }).eq("id", entry.id);
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

  // Primero liberamos el turno viejo (puede superponerse con el nuevo) y, si
  // la reserva nueva falla, lo restauramos.
  unwrap(
    await db()
      .from("appointments")
      .update({ status: "reprogramado", cancelled_at: new Date().toISOString() })
      .eq("id", appt.id)
      .select("id")
      .single(),
    "liberar turno anterior",
  );
  const restore = () => db().from("appointments").update({ status: appt.status, cancelled_at: null }).eq("id", appt.id);

  const inserted = await db()
    .from("appointments")
    .insert({
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
    })
    .select("*")
    .single();
  if (inserted.error) {
    await restore();
    if (isOverlapError(inserted.error)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw new Error(`reprogramar turno: ${inserted.error.message}`);
  }
  const newAppt = inserted.data as Appointment;
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
  const task = unwrap(
    await db()
      .from("tasks")
      .insert({
        clinic_id: ctx.clinicId,
        patient_id: patientId,
        conversation_id: ctx.conversationId ?? null,
        type: input.tipo,
        priority: input.prioridad ?? (input.tipo === "urgencia" ? "urgente" : "normal"),
        title: input.titulo,
        details: input.detalle ?? null,
      })
      .select("*")
      .single(),
    "crear tarea",
  );
  await notifyN8n("tarea.creada", { clinic_id: ctx.clinicId, task });
  return {
    ok: true,
    tarea_id: (task as { id: string }).id,
    mensaje: "Tarea creada para el equipo. Avisale al paciente que lo van a contactar (en horario de atención).",
  };
}

// ---------------------------------------------------------------------------
// anotar_lista_espera
// ---------------------------------------------------------------------------
export async function joinWaitlist(ctx: ToolContext, input: { tipo_turno_id: string; profesional_id?: string; preferencias?: string }) {
  const patient = await ensurePatient(ctx);
  const catalog = await getCatalog(ctx.clinicId);
  if (!catalog.appointmentTypes.some((t) => t.id === input.tipo_turno_id)) throw new ToolError("Tipo de turno inválido.");
  unwrap(
    await db()
      .from("waitlist")
      .insert({
        clinic_id: ctx.clinicId,
        patient_id: patient.id,
        appointment_type_id: input.tipo_turno_id,
        professional_id: input.profesional_id || null,
        preferences: input.preferencias ?? null,
      })
      .select("id")
      .single(),
    "lista de espera",
  );
  return { ok: true, mensaje: "Paciente anotado en la lista de espera. Si se libera un turno le escribimos por WhatsApp." };
}
