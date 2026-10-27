"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { syncCalendarLater } from "@/lib/calendar/sync";
import { sql } from "@/lib/db";
import { findPatientByPhone, getClinic, isUuid } from "@/lib/clinic";
import { setupAgent } from "@/lib/agent/setup";
import { resolveTask } from "@/lib/tasks";
import { SESSION_COOKIE, createSessionToken, passwordMatches, safeNext, sessionCookieOptions } from "@/lib/session";
import { bookAppointment, cancelClinicAppointment, freeSlotsOnDay, registerPatient, rescheduleClinicAppointment, ToolError } from "@/lib/agent/service";
import { normalizePhone } from "@/lib/phone";
import { deletePatients, mergeDuplicates } from "@/lib/patients";
import { addDaysKey, humanSlot, localDateKey, parseClockTime, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import { AudioError, elegirVoces, generarAudio } from "@/lib/web-audios";
import { getConversacion } from "@/content/conversaciones";
import { selectMessagingChannel, messagingSettings, setDemoDailyLimit } from "@/lib/messaging-settings";
import { connectTelegram, telegramConfigured } from "@/lib/telegram";
import { missingWahaEnv } from "@/lib/env";
import { getPanelClinic, logClinicChange, requireAdmin, requirePanelSession, touchClinic } from "@/lib/panel-clinic";
import { normalizeWebsite } from "@/lib/demo/website";

const requireSession = requirePanelSession;

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const uuid = (form: FormData, key: string) => {
  const value = text(form, key);
  return isUuid(value) ? value : null;
};

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------
export async function login(_prev: { error?: string } | undefined, form: FormData) {
  if (!process.env.PANEL_PASSWORD) return { error: "Falta configurar PANEL_PASSWORD en Vercel." };
  if (!passwordMatches(String(form.get("password") ?? ""))) return { error: "Contraseña incorrecta." };
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/panel/login");
}

// ---------------------------------------------------------------------------
// Agenda y tareas
// ---------------------------------------------------------------------------
/** Los errores del servicio le hablan al agente; en el panel alcanza con el motivo. */
function panelError(e: unknown): FormState {
  const message = e instanceof Error ? e.message : String(e);
  if (!(e instanceof ToolError)) return { ok: false, message };
  return { ok: false, message: (e.panelMessage ?? message).replace(/ Consultá la disponibilidad.*$/, "").replace(/ Si lo quiere cambiar, usá reprogramar_turno\./, " Si lo quiere cambiar, reprogramalo desde su ficha."), forzable: e.forzable };
}

/**
 * Marcar un turno desde su ficha. Atendido y ausente, cuando ya empezó; corregir
 * (volver a confirmado), solo un turno pasado; cancelar, como si lo cancelara el
 * paciente: avisa a n8n y le ofrece el hueco a la lista de espera.
 */
export async function changeAppointmentStatus(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const id = uuid(form, "id");
  const status = text(form, "status");
  if (!id || !status) return { ok: false, message: "Elegí qué hacer con el turno." };
  const [appt] = await sql<Array<{ status: string; starts_at: string }>>`select status, starts_at from appointments where id = ${id} and clinic_id = ${clinic.id}`;
  if (!appt) return { ok: false, message: "Ese turno ya no existe." };
  const started = new Date(appt.starts_at).getTime() <= Date.now();
  try {
    if (status === "cancelado") {
      const r = await cancelClinicAppointment(clinic.id, id, text(form, "reason") ?? undefined);
      syncCalendarLater(clinic.id);
      revalidatePath("/panel/agenda");
      return { ok: true, message: r.mensaje };
    }
    if (status === "atendido" || status === "ausente") {
      if (!started) return { ok: false, message: "Todavía no empezó: se puede marcar cuando llegue el horario." };
      if (!["confirmado", "pendiente", "atendido", "ausente"].includes(appt.status)) return { ok: false, message: `Ese turno está ${appt.status}.` };
    } else if (status === "confirmado") {
      // Deshacer una marca equivocada (atendido ↔ ausente ↔ sin marcar).
      if (!started || !["atendido", "ausente"].includes(appt.status)) return { ok: false, message: "Solo se corrige la marca de un turno que ya pasó." };
    } else {
      return { ok: false, message: "Elegí qué hacer con el turno." };
    }
    await sql`update appointments set status = ${status} where id = ${id} and clinic_id = ${clinic.id}`;
    syncCalendarLater(clinic.id);
    revalidatePath("/panel/agenda");
    return { ok: true, message: status === "atendido" ? "Marcado como atendido." : status === "ausente" ? "Marcado como ausente." : "Marca corregida: quedó sin marcar." };
  } catch (e) {
    return panelError(e);
  }
}

/** Los turnos pasados de un día que siguen sin marcar → atendidos (lo que pasa casi siempre). */
export async function markDayAttended(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const ids = form.getAll("id").map(String).filter((v) => isUuid(v));
  if (!ids.length) return { ok: false, message: "No hay turnos para marcar." };
  const rows = await sql`
    update appointments set status = 'atendido'
    where clinic_id = ${clinic.id} and id = any(${ids}::uuid[]) and status in ('confirmado', 'pendiente') and ends_at <= now()
    returning id`;
  syncCalendarLater(clinic.id);
  revalidatePath("/panel/agenda");
  return { ok: true, message: rows.length === 1 ? "1 turno marcado como atendido." : `${rows.length} turnos marcados como atendidos.` };
}

export type FormState = {
  ok?: boolean;
  message?: string;
  /** El turno se puede dar igual (fuera de horario, día bloqueado u ocupado en Google). */
  forzable?: boolean;
};

export async function setupTelegramChannel(_previous: FormState, _form: FormData): Promise<FormState> {
  void _previous; void _form;
  await requireAdmin();
  if (!telegramConfigured()) return { ok: false, message: "Falta TELEGRAM_BOT_TOKEN o la conexión del agente en Vercel." };
  try {
    await connectTelegram();
    await sql`update messaging_settings set telegram_ready = true, updated_at = now() where id`;
    revalidatePath("/panel/configuracion", "layout");
    revalidatePath("/panel/sistema");
    return { ok: true, message: "Bot conectado. Ahora podés elegir Telegram y guardar el canal." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo conectar Telegram." };
  }
}

export async function saveMessagingChannel(_previous: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const channel = form.get("channel");
  if (channel !== "pausado" && channel !== "telegram" && channel !== "whatsapp") return { ok: false, message: "Elegí un canal válido." };
  if (channel === "telegram" && (!telegramConfigured() || !(await messagingSettings()).telegram_ready)) return { ok: false, message: "Primero conectá el bot de Telegram." };
  if (channel === "whatsapp" && missingWahaEnv().length) return { ok: false, message: "Falta la configuración de WhatsApp." };
  await selectMessagingChannel(channel);
  revalidatePath("/panel/configuracion", "layout");
  revalidatePath("/panel/sistema");
  revalidatePath("/probar-demo");
  return { ok: true, message: channel === "pausado" ? "Turnia quedó pausada en ambos canales." : `Canal guardado: ${channel === "telegram" ? "Telegram" : "WhatsApp"}. El otro canal queda pausado.` };
}

export async function saveDemoLimit(_previous: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const raw = String(form.get("demo_daily_limit") ?? "").trim();
  const limit = raw === "" ? 0 : Number(raw);
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000) return { ok: false, message: "Poné un número entero entre 0 y 1000 (0 = sin límite)." };
  await setDemoDailyLimit(limit);
  revalidatePath("/panel/sistema");
  return { ok: true, message: limit ? `Límite guardado: ${limit} demos por persona por día.` : "Sin límite de demos por persona." };
}

/** Horarios libres del día elegido en el turno a mano (incluye lo ocupado en Google Calendar). */
export async function loadDaySlots(form: FormData) {
  await requireSession();
  const clinic = await getPanelClinic(form);
  return freeSlotsOnDay(clinic.id, {
    tipo_turno_id: uuid(form, "appointment_type_id") ?? "",
    profesional_id: uuid(form, "professional_id") ?? "",
    fecha: text(form, "date") ?? "",
    ignorar_turno_id: uuid(form, "ignore_id") ?? undefined,
  });
}

export type KnownPatient = { name: string | null; coverage: string | null; upcoming: string[] };

/** Al escribir el celular en el turno a mano: si ya es paciente, su nombre, su cobertura y sus próximos turnos. */
export async function lookupPatient(form: FormData): Promise<KnownPatient | null> {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const phone = normalizePhone(text(form, "phone"));
  if (!/^\d{10,15}$/.test(phone)) return null;
  const patient = await findPatientByPhone(clinic.id, phone);
  if (!patient) return null;
  const next = await sql<Array<{ starts_at: string; type_name: string }>>`
    select a.starts_at, t.name as type_name from appointments a join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = ${patient.id} and a.status in ('confirmado', 'pendiente') and a.ends_at > now()
    order by a.starts_at limit 3`;
  return { name: patient.full_name, coverage: patient.coverage, upcoming: next.map((n) => `${n.type_name}, ${humanSlot(new Date(n.starts_at), clinic.timezone)}`) };
}

/** Fecha (YYYY-MM-DD) + hora escrita → instante, en la zona de la clínica. */
function panelStart(form: FormData, timeZone: string): { at: Date } | FormState {
  const date = parseDateKey(text(form, "date"));
  if (!date) return { ok: false, message: "Elegí la fecha." };
  const rawTime = text(form, "time");
  if (!rawTime) return { ok: false, message: "Elegí un horario." };
  const time = parseClockTime(rawTime);
  if (!time) return { ok: false, message: `No entendí la hora «${rawTime}». Escribila como 9:15 o 19:30.` };
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return { at: zonedTimeToUtc(y, m, d, hh, mm, timeZone) };
}

export async function createManualAppointment(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const phone = normalizePhone(text(form, "phone"));
  const typeId = uuid(form, "appointment_type_id");
  const professionalId = uuid(form, "professional_id");
  if (!typeId || !professionalId) return { ok: false, message: "Elegí la prestación y quién la atiende." };
  const start = panelStart(form, clinic.timezone);
  if (!("at" in start)) return start;
  if (!phone) return { ok: false, message: "Escribí el celular del paciente." };
  // Con código de área: así le llegan los recordatorios por WhatsApp.
  if (!/^\d{10,15}$/.test(phone)) return { ok: false, message: "Revisá el celular: va con código de área, por ejemplo 11 5555-0001." };
  const ctx = { clinicId: clinic.id, patientPhone: phone, channel: "panel" };
  try {
    await registerPatient(ctx, { nombre_completo: text(form, "full_name") ?? undefined, cobertura: text(form, "coverage") ?? undefined });
    const r = await bookAppointment(
      ctx,
      { tipo_turno_id: typeId, profesional_id: professionalId, inicio: start.at.toISOString(), notas: text(form, "notes") ?? undefined },
      { force: form.get("force") === "1" },
    );
    syncCalendarLater(clinic.id);
    revalidatePath("/panel/agenda");
    const aviso = "aviso" in r && r.aviso ? ` ${r.aviso.replace(" Preguntale si quiere mantener los dos o cancelar el otro.", "")}` : "";
    return { ok: true, message: `${r.mensaje}${aviso}` };
  } catch (e) {
    return panelError(e);
  }
}

/** Mover un turno desde su ficha: mismo paciente y prestación, otro horario (y, si hace falta, otro profesional). */
export async function rescheduleFromPanel(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const id = uuid(form, "appointment_id");
  if (!id) return { ok: false, message: "Ese turno ya no existe." };
  const start = panelStart(form, clinic.timezone);
  if (!("at" in start)) return start;
  let moved: { id: string; day: string };
  try {
    const r = await rescheduleClinicAppointment(
      clinic.id,
      id,
      { nuevo_inicio: start.at.toISOString(), profesional_id: uuid(form, "professional_id") ?? undefined },
      { force: form.get("force") === "1" },
    );
    syncCalendarLater(clinic.id);
    revalidatePath("/panel/agenda");
    moved = { id: r.turno_id, day: localDateKey(start.at, clinic.timezone) };
  } catch (e) {
    return panelError(e);
  }
  // Movido: la Agenda abre la ficha del turno nuevo, en su día, con la misma vista y filtro.
  const back = new URLSearchParams(text(form, "back") ?? "");
  const next = new URLSearchParams();
  for (const key of ["vista", "pro"]) if (back.get(key)) next.set(key, back.get(key)!);
  next.set("fecha", moved.day);
  next.set("turno", moved.id);
  redirect(`/panel/agenda?${next}`);
}

export async function setTaskStatus(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  const status = text(form, "status");
  if (!id || !status || !["abierta", "en_curso", "resuelta"].includes(status)) return;
  const clinic = await getPanelClinic(form);
  await sql`
    update tasks set status = ${status}, resolved_at = case when ${status} = 'resuelta' then now() else null end
    where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath("/panel/tareas");
  revalidatePath("/panel");
}

export async function setContactOptOut(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getPanelClinic(form);
  await sql`update patients set contact_opt_out = ${form.get("opt_out") === "true"} where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath(`/panel/pacientes/${id}`);
}

/** Ficha del paciente → «Unificar en esta ficha»: junta las fichas repetidas con el mismo DNI. */
export async function mergePatientDuplicates(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getPanelClinic(form);
  const merged = await mergeDuplicates(clinic.id, id);
  revalidatePath("/panel/pacientes");
  revalidatePath(`/panel/pacientes/${id}`);
  redirect(`/panel/pacientes/${id}?unificadas=${merged}`);
}

/** Pacientes → borrar una o varias fichas (solo el administrador, como dice el acceso del consultorio). */
export async function deletePatientsAction(form: FormData) {
  await requireAdmin();
  const ids = [...new Set(form.getAll("ids").filter(isUuid))];
  if (!ids.length) return;
  const clinic = await getPanelClinic(form);
  const { borradas, eventosSinSacar } = await deletePatients(clinic.id, ids);
  revalidatePath("/panel/pacientes");
  revalidatePath("/panel/agenda");
  revalidatePath("/panel/conversaciones");
  revalidatePath("/panel/tareas");
  revalidatePath("/panel");
  redirect(`/panel/pacientes?borradas=${borradas}${eventosSinSacar ? `&eventos=${eventosSinSacar}` : ""}`);
}

export async function resolveTaskAction(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return { ok: false, message: "Falta la tarea." };
  const clinic = await getPanelClinic(form);
  const result = await resolveTask(clinic.id, id, text(form, "response"));
  revalidatePath("/panel/tareas");
  revalidatePath("/panel");
  return { ok: result.ok, message: result.message };
}

// ---------------------------------------------------------------------------
// Configuración de la clínica
// ---------------------------------------------------------------------------
export async function saveClinic(form: FormData) {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const coverages = (text(form, "accepted_coverages") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const websiteInput = text(form, "website");
  const website = websiteInput ? normalizeWebsite(websiteInput) : null;
  if (websiteInput && !website) throw new Error("Revisá la dirección de la web.");
  const timezone = text(form, "timezone") ?? clinic.timezone;
  try { new Intl.DateTimeFormat("es", { timeZone: timezone }); } catch { throw new Error("Zona horaria inválida."); }
  await sql`
    update clinics set ${sql({
      name: text(form, "name") ?? clinic.name,
      agent_name: text(form, "agent_name") ?? clinic.agent_name,
      specialty: text(form, "specialty") ?? clinic.specialty,
      address: text(form, "address"),
      phone: text(form, "phone"),
      hours_text: text(form, "hours_text"),
      accepted_coverages: coverages,
      faq: text(form, "faq"),
      policies: text(form, "policies"),
      urgency_instructions: text(form, "urgency_instructions"),
      website,
      timezone,
      payment_methods: text(form, "payment_methods"),
      agent_context: text(form, "agent_context"),
      handoff_phone: text(form, "handoff_phone"),
      after_hours_instructions: text(form, "after_hours_instructions"),
    })}, retained_at = coalesce(retained_at, now()), updated_at = now(), context_revision = context_revision + 1
    where id = ${clinic.id}`;
  await logClinicChange(clinic.id, "Reglas del consultorio");
  revalidatePath("/panel/configuracion", "layout");
}

export async function saveClinicWithFeedback(_previous: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  try {
    await saveClinic(form);
    return { ok: true, message: "Perfil guardado y conservado. Las conversaciones nuevas usan esta información." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo guardar el perfil." }; }
}

export async function saveProfessional(form: FormData) {
  await saveProfessionalWithFeedback({}, form);
}

/** Editar un profesional, con confirmación o el motivo por el que no se guardó. */
export async function saveProfessionalWithFeedback(_previous: FormState, form: FormData): Promise<FormState> {
  let clinic;
  try {
    clinic = await getPanelClinic(form);
  } catch (error) {
    // Otra pestaña cambió la clínica elegida: se avisa acá, sin perder lo escrito.
    if (error instanceof Error && error.message.includes("clínica seleccionada")) return { ok: false, message: error.message };
    throw error;
  }
  const id = uuid(form, "id");
  const name = text(form, "full_name");
  const specialty = text(form, "specialty");
  if (!id) return { ok: false, message: "No encontré el profesional. Recargá la página." };
  if (!name || !specialty) return { ok: false, message: "Completá el nombre y la especialidad." };
  const coverages = (text(form, "accepted_coverages") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const rows = await sql`update professionals set full_name = ${name}, specialty = ${specialty}, bio = ${text(form, "bio")}, accepted_coverages = ${coverages.length ? coverages : null} where id = ${id} and clinic_id = ${clinic.id} returning id`;
  if (!rows.length) return { ok: false, message: "Este profesional no pertenece a la clínica elegida. Recargá la página." };
  await touchClinic(clinic.id, "Equipo");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: "Profesional guardado." };
}

export async function saveAppointmentType(form: FormData) {
  await saveAppointmentTypeWithFeedback({}, form);
}

/** Editar una prestación, con confirmación o el motivo por el que no se guardó. */
export async function saveAppointmentTypeWithFeedback(_previous: FormState, form: FormData): Promise<FormState> {
  let clinic;
  try {
    clinic = await getPanelClinic(form);
  } catch (error) {
    // Otra pestaña cambió la clínica elegida: se avisa acá, sin perder lo escrito.
    if (error instanceof Error && error.message.includes("clínica seleccionada")) return { ok: false, message: error.message };
    throw error;
  }
  const id = uuid(form, "id");
  const name = text(form, "name");
  const specialty = text(form, "specialty");
  const duration = Number(form.get("duration_min"));
  const recall = Number(form.get("recall_months"));
  if (!id) return { ok: false, message: "No encontré la prestación. Recargá la página." };
  if (!name || !specialty) return { ok: false, message: "Completá el nombre y la especialidad." };
  if (!Number.isFinite(duration) || duration < 5 || duration > 480) return { ok: false, message: "La duración tiene que estar entre 5 y 480 minutos." };
  const rawPrice = text(form, "price");
  const price = parsePrice(rawPrice);
  if (rawPrice && price === null) return { ok: false, message: "Revisá el precio: usá solo números (por ejemplo, 48000)." };
  const rows = await sql`update appointment_types set name = ${name}, specialty = ${specialty}, duration_min = ${Math.round(duration)}, price = ${price},
    instructions = ${text(form, "instructions")}, recall_months = ${Number.isFinite(recall) && recall > 0 && recall <= 60 ? Math.round(recall) : null},
    is_first_visit = ${form.get("is_first_visit") === "on"} where id = ${id} and clinic_id = ${clinic.id} returning id`;
  if (!rows.length) return { ok: false, message: "Esta prestación no pertenece a la clínica elegida. Recargá la página." };
  await touchClinic(clinic.id, "Prestaciones");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: "Prestación guardada." };
}

export async function addProfessional(form: FormData) {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const name = text(form, "full_name");
  const specialty = text(form, "specialty");
  if (!name || !specialty) return;
  const coverages = (text(form, "accepted_coverages") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  await sql`
    insert into professionals ${sql({
      clinic_id: clinic.id,
      full_name: name,
      specialty,
      bio: text(form, "bio"),
      accepted_coverages: coverages.length ? coverages : null,
    })}`;
  await touchClinic(clinic.id, "Equipo");
  revalidatePath("/panel/configuracion", "layout");
}

export async function toggleProfessional(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getPanelClinic(form);
  await sql`update professionals set active = ${form.get("active") === "true"} where id = ${id} and clinic_id = ${clinic.id}`;
  await touchClinic(clinic.id, "Equipo");
  revalidatePath("/panel/configuracion", "layout");
}

export async function addSchedule(form: FormData) {
  await requireSession();
  const professionalId = uuid(form, "professional_id");
  const start = text(form, "start_time");
  const end = text(form, "end_time");
  const weekdays = form.getAll("weekday").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (!professionalId || !start || !end || !weekdays.length || end <= start) return;
  const clinic = await getPanelClinic(form);
  await sql`
    insert into schedules (professional_id, weekday, start_time, end_time)
    select p.id, w.weekday, ${start}::time, ${end}::time
    from professionals p, unnest(${weekdays}::smallint[]) as w(weekday)
    where p.id = ${professionalId} and p.clinic_id = ${clinic.id}`;
  await touchClinic(clinic.id, "Horarios");
  revalidatePath("/panel/configuracion", "layout");
}

export async function deleteSchedule(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  const clinic = await getPanelClinic(form);
  if (id) {
    await sql`
      delete from schedules s using professionals p
      where s.id = ${id} and p.id = s.professional_id and p.clinic_id = ${clinic.id}`;
  }
  await touchClinic(clinic.id, "Horarios");
  revalidatePath("/panel/configuracion", "layout");
}

export async function addAppointmentType(form: FormData) {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const name = text(form, "name");
  const specialty = text(form, "specialty");
  const duration = Number(text(form, "duration_min") ?? 30);
  if (!name || !specialty || !Number.isFinite(duration)) return;
  const recall = Number(text(form, "recall_months") ?? "");
  const price = parsePrice(text(form, "price"));
  await sql`
    insert into appointment_types ${sql({
      price,
      clinic_id: clinic.id,
      name,
      specialty,
      duration_min: Math.min(480, Math.max(5, Math.round(duration))),
      instructions: text(form, "instructions"),
      recall_months: Number.isFinite(recall) && recall > 0 ? Math.round(recall) : null,
      is_first_visit: form.get("is_first_visit") === "on",
    })}`;
  await touchClinic(clinic.id, "Prestaciones");
  revalidatePath("/panel/configuracion", "layout");
}

/** "$45.000", "45000" o "45.000,50" → 45000 / 45000.5 (formato argentino). */
function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d,]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export async function setAppointmentTypePrice(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getPanelClinic(form);
  await sql`update appointment_types set price = ${parsePrice(text(form, "price"))} where id = ${id} and clinic_id = ${clinic.id}`;
  await touchClinic(clinic.id, "Prestaciones");
  revalidatePath("/panel/configuracion", "layout");
  revalidatePath("/panel");
}

// ---------------------------------------------------------------------------
// Feriados, vacaciones y bloqueos de agenda
// ---------------------------------------------------------------------------
export async function addScheduleBlock(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const fromKey = parseDateKey(text(form, "date_from"));
  const toKey = parseDateKey(text(form, "date_to")) ?? fromKey;
  if (!fromKey || !toKey || toKey < fromKey) return { ok: false, message: "Revisá las fechas." };
  const professionalId = uuid(form, "professional_id");
  const time = (key: string) => /^(\d{2}):(\d{2})$/.exec(text(form, key) ?? "");
  const startTime = time("time_from");
  const endTime = time("time_to");
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const startsAt = zonedTimeToUtc(fy, fm, fd, startTime ? Number(startTime[1]) : 0, startTime ? Number(startTime[2]) : 0, clinic.timezone);
  // Sin hora de fin, el bloqueo dura hasta el final del último día.
  const [ty, tm, td] = (endTime ? toKey : addDaysKey(toKey, 1)).split("-").map(Number);
  const endsAt = zonedTimeToUtc(ty, tm, td, endTime ? Number(endTime[1]) : 0, endTime ? Number(endTime[2]) : 0, clinic.timezone);
  if (endsAt <= startsAt) return { ok: false, message: "La hora de fin tiene que ser posterior a la de inicio." };
  const [block] = await sql<Array<{ id: string }>>`
    insert into schedule_blocks (clinic_id, professional_id, starts_at, ends_at, reason)
    select ${clinic.id}::uuid, ${professionalId}::uuid, ${startsAt}::timestamptz, ${endsAt}::timestamptz, ${text(form, "reason")}::text
    where ${professionalId}::uuid is null
       or exists (select 1 from professionals where id = ${professionalId} and clinic_id = ${clinic.id})
    returning id`;
  if (!block) return { ok: false, message: "No encontré ese profesional." };
  const [{ affected }] = await sql<Array<{ affected: number }>>`
    select count(*)::int as affected from appointments
    where clinic_id = ${clinic.id} and status in ('confirmado', 'pendiente')
      and starts_at < ${endsAt} and ends_at > ${startsAt}
      ${professionalId ? sql`and professional_id = ${professionalId}` : sql``}`;
  await touchClinic(clinic.id, "Feriados y bloqueos");
  revalidatePath("/panel/configuracion", "layout");
  revalidatePath("/panel/agenda");
  return {
    ok: true,
    message: affected
      ? `Bloqueo guardado. Ojo: hay ${affected} turno(s) ya dados en ese período; reprogramalos desde la Agenda.`
      : "Bloqueo guardado. El agente ya no ofrece turnos en ese período.",
  };
}

export async function deleteScheduleBlock(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getPanelClinic(form);
  await sql`delete from schedule_blocks where id = ${id} and clinic_id = ${clinic.id}`;
  await touchClinic(clinic.id, "Feriados y bloqueos");
  revalidatePath("/panel/configuracion", "layout");
  revalidatePath("/panel/agenda");
}

export async function toggleAppointmentType(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getPanelClinic(form);
  await sql`update appointment_types set active = ${form.get("active") === "true"} where id = ${id} and clinic_id = ${clinic.id}`;
  await touchClinic(clinic.id, "Prestaciones");
  revalidatePath("/panel/configuracion", "layout");
}

export type AgentSetupState = { ok?: boolean; message?: string };

export async function runAgentSetup(): Promise<AgentSetupState> {
  await requireAdmin();
  try {
    // El agente compartido es el de la clínica principal, sin importar la clínica elegida en el panel.
    const clinic = await getClinic();
    const result = await setupAgent(clinic);
    revalidatePath("/panel/configuracion", "layout");
    revalidatePath("/panel/sistema");
    return {
      ok: true,
      message: `${result.created ? "Agente creado" : "Agente actualizado"} (${result.agentId}) con ${result.toolIds.length} herramientas${
        result.voiceId ? "" : ". No se pudo elegir una voz argentina: elegí una en ElevenLabs y pegá su ID en Configuración"
      }.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Audios de las demos de la web pública
// ---------------------------------------------------------------------------
export type AudioWebState = { ok: boolean; message: string; slug: string; duracion?: number };

/** Genera (o regenera) el audio de una conversación de la web con las voces favoritas de ElevenLabs. */
export async function generarAudioWeb(slug: string): Promise<AudioWebState> {
  await requireAdmin();
  const conversacion = getConversacion(slug);
  if (!conversacion) return { ok: false, message: "No existe esa conversación.", slug };
  try {
    const voces = await elegirVoces();
    const duracion = await generarAudio(conversacion, voces);
    return {
      ok: true,
      slug,
      duracion,
      message: `Listo (${Math.floor(duracion / 60)}:${String(Math.round(duracion % 60)).padStart(2, "0")}). Sofi: ${voces.agente.nombre} · Paciente: ${voces.paciente.nombre}.`,
    };
  } catch (e) {
    console.error("audios: falló la generación", slug, e);
    const message = e instanceof AudioError ? e.message : "No se pudo generar el audio. Mirá los logs de Vercel.";
    return { ok: false, message, slug };
  }
}
