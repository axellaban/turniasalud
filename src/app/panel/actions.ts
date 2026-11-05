"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { syncCalendarLater } from "@/lib/calendar/sync";
import { sql } from "@/lib/db";
import { findPatientByPhone, getClinic, isUuid } from "@/lib/clinic";
import { setupAgent } from "@/lib/agent/setup";
import { resolveTask } from "@/lib/tasks";
import { unmuteNumber } from "@/lib/chat-guard";
import { SESSION_COOKIE, createSessionToken, passwordMatches, safeNext, sessionCookieOptions } from "@/lib/session";
import { bookAppointment, cancelClinicAppointment, freeSlotsOnDay, registerPatient, rescheduleClinicAppointment, ToolError, type ToolContext } from "@/lib/agent/service";
import { normalizePhone } from "@/lib/phone";
import { addHouseholdMember, deletePatients, mergeDuplicates } from "@/lib/patients";
import { humanSlot, localDateKey, parseClockTime, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import { AudioError, elegirVoces, generarAudio } from "@/lib/web-audios";
import { getConversacion } from "@/content/conversaciones";
import { selectMessagingChannel, messagingSettings, setDemoDailyLimit } from "@/lib/messaging-settings";
import { connectTelegram, telegramConfigured } from "@/lib/telegram";
import { missingWahaEnv } from "@/lib/env";
import { getPanelClinic, logClinicChange, requireAdmin, requirePanelSession, touchClinic } from "@/lib/panel-clinic";
import { normalizeWebsite } from "@/lib/demo/website";
import { createScheduleBlock } from "@/lib/schedule-blocks";
import { PRICE_MODES, type PriceMode } from "@/lib/types";

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
    segundo_profesional_id: uuid(form, "second_professional_id") ?? undefined,
  });
}

export type KnownPatient = { id: string; name: string | null; coverage: string | null; upcoming: string[] };

/**
 * Al escribir el celular en el turno a mano: las fichas de ese celular, con su nombre, su cobertura y
 * sus próximos turnos. Una familia puede tener varias: primero la que usa hoy ese número.
 */
export async function lookupPatient(form: FormData): Promise<KnownPatient[]> {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const phone = normalizePhone(text(form, "phone"));
  if (!/^\d{10,15}$/.test(phone)) return [];
  const main = await findPatientByPhone(clinic.id, phone);
  if (!main) return [];
  const patients = await sql<Array<{ id: string; full_name: string | null; coverage: string | null }>>`
    select id, full_name, coverage from patients
    where clinic_id = ${clinic.id} and (id = ${main.id} or phone = ${phone})
    order by (id = ${main.id}) desc, birth_date nulls last, created_at, id`;
  const next = await sql<Array<{ patient_id: string; starts_at: string; type_name: string }>>`
    select a.patient_id, a.starts_at, coalesce(a.title, t.name) as type_name from appointments a join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = any(${patients.map((p) => p.id)}::uuid[]) and a.status in ('confirmado', 'pendiente') and a.ends_at > now()
    order by a.starts_at`;
  return patients.map((p) => ({
    id: p.id,
    name: p.full_name,
    coverage: p.coverage,
    upcoming: next
      .filter((n) => n.patient_id === p.id)
      .slice(0, 3)
      .map((n) => `${n.type_name}, ${humanSlot(new Date(n.starts_at), clinic.timezone)}`),
  }));
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
  const ctx: ToolContext = { clinicId: clinic.id, patientPhone: phone, channel: "panel" };
  // En un celular compartido (una familia), para quién es el turno: una de sus fichas u otra persona.
  const choice = text(form, "patient_id");
  let created: string | null = null;
  if (choice === "nueva") {
    const name = text(form, "full_name");
    if (!name) return { ok: false, message: "Escribí el nombre y apellido de la persona nueva." };
    created = (await addHouseholdMember(clinic.id, phone, { full_name: name, coverage: text(form, "coverage") })).id;
    ctx.patientId = created;
  } else if (isUuid(choice)) {
    const [chosen] = await sql<Array<{ id: string }>>`
      select p.id from patients p where p.id = ${choice} and p.clinic_id = ${clinic.id}
        and (p.phone = ${phone} or exists (select 1 from patient_phones pp where pp.clinic_id = p.clinic_id and pp.phone = ${phone} and pp.patient_id = p.id))`;
    if (chosen) ctx.patientId = chosen.id;
  }
  try {
    await registerPatient(ctx, { nombre_completo: text(form, "full_name") ?? undefined, cobertura: text(form, "coverage") ?? undefined });
    const r = await bookAppointment(
      ctx,
      { tipo_turno_id: typeId, profesional_id: professionalId, inicio: start.at.toISOString(), notas: text(form, "notes") ?? undefined },
      { force: form.get("force") === "1", secondProfessionalId: uuid(form, "second_professional_id") },
    ).catch(async (e) => {
      // Si el turno no se pudo dar, la ficha nueva no queda suelta (se vuelve a crear al reintentar).
      if (created) await sql`delete from patients p where p.id = ${created} and not exists (select 1 from appointments a where a.patient_id = p.id)`;
      throw e;
    });
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

/** Conversaciones → Números en pausa → «Reactivar»: Sofi le vuelve a contestar a ese número. */
export async function reactivateChatNumber(form: FormData) {
  await requireSession();
  const phone = text(form, "phone");
  if (!phone) return;
  const clinic = await getPanelClinic(form);
  await unmuteNumber(clinic.id, phone);
  revalidatePath("/panel/conversaciones");
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
/** Lo que el panel guarda de la ficha de la clínica con saveClinic (cada pantalla manda solo lo suyo). */
const CLINIC_TEXT_FIELDS = [
  "address", "phone", "hours_text", "faq", "policies", "urgency_instructions", "payment_methods",
  "agent_context", "handoff_phone", "after_hours_instructions",
] as const;

/**
 * Guarda la ficha de la clínica. Cada pantalla del panel manda solo sus campos: lo que no viene en
 * el formulario se conserva como estaba (así guardar una pantalla nunca borra lo de otra).
 */
export async function saveClinic(form: FormData) {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const fields: Record<string, unknown> = {};
  if (form.has("name")) fields.name = text(form, "name") ?? clinic.name;
  if (form.has("agent_name")) fields.agent_name = text(form, "agent_name") ?? clinic.agent_name;
  if (form.has("specialty")) fields.specialty = text(form, "specialty") ?? clinic.specialty;
  for (const key of CLINIC_TEXT_FIELDS) if (form.has(key)) fields[key] = text(form, key);
  if (form.has("accepted_coverages")) {
    fields.accepted_coverages = (text(form, "accepted_coverages") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  }
  if (form.has("website")) {
    const websiteInput = text(form, "website");
    const website = websiteInput ? normalizeWebsite(websiteInput) : null;
    if (websiteInput && !website) throw new Error("Revisá la dirección de la web.");
    fields.website = website;
  }
  if (form.has("timezone")) {
    const timezone = text(form, "timezone") ?? clinic.timezone;
    try { new Intl.DateTimeFormat("es", { timeZone: timezone }); } catch { throw new Error("Zona horaria inválida."); }
    fields.timezone = timezone;
  }
  // Si el paciente no contesta los horarios que le pasó el agente: cuántas veces se le vuelve a escribir.
  if (form.has("followup_attempts")) {
    const attempts = Number(text(form, "followup_attempts") ?? clinic.followup_attempts);
    if (![0, 1, 2].includes(attempts)) throw new Error("Elegí cuántas veces volver a escribir (ninguna, 1 o 2).");
    fields.followup_attempts = attempts;
  }
  if (form.has("followup_delay_hours")) {
    const delay = Number(text(form, "followup_delay_hours") ?? clinic.followup_delay_hours);
    if (!Number.isInteger(delay) || delay < 1 || delay > 24) throw new Error("Elegí cuánto esperar antes de volver a escribir.");
    fields.followup_delay_hours = delay;
  }
  if (form.has("tone")) fields.tone = text(form, "tone") === "usted" ? "usted" : text(form, "tone") === "vos" ? "vos" : null;
  // El ayudante de postgres.js tiene que ir directo después de «set» (dentro de otro fragmento no
  // se arma bien), así que sin campos se marca la ficha sola.
  if (Object.keys(fields).length) {
    await sql`
      update clinics set ${sql(fields)}, retained_at = coalesce(retained_at, now()), updated_at = now(), context_revision = context_revision + 1
      where id = ${clinic.id}`;
  } else {
    await sql`update clinics set retained_at = coalesce(retained_at, now()), updated_at = now(), context_revision = context_revision + 1 where id = ${clinic.id}`;
  }
  await logClinicChange(clinic.id, "Consultorio");
  revalidatePath("/panel/configuracion", "layout");
}

export async function saveClinicWithFeedback(_previous: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  try {
    await saveClinic(form);
    return { ok: true, message: "Perfil guardado y conservado. Las conversaciones nuevas usan esta información." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo guardar el perfil." }; }
}

/**
 * Qué prestaciones hace el profesional (casillas de Equipo y horarios). Solo si el formulario las
 * trae: sin marcar ninguna, hace todas las de su especialidad.
 */
async function saveProfessionalTypes(form: FormData, clinicId: string, professionalId: string): Promise<void> {
  if (!form.has("types_field")) return;
  const ids = [...new Set(form.getAll("appointment_type_ids").filter((v): v is string => typeof v === "string" && isUuid(v)))];
  await sql.begin(async (tx) => {
    await tx`delete from professional_appointment_types where professional_id = ${professionalId}`;
    if (ids.length) {
      await tx`
        insert into professional_appointment_types (professional_id, appointment_type_id)
        select ${professionalId}::uuid, t.id from appointment_types t
        where t.clinic_id = ${clinicId} and t.id = any(${ids}::uuid[])`;
    }
  });
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
  // Las coberturas del profesional se cargan en Configuración → Coberturas: sin el campo, se conservan.
  const coverages = (text(form, "accepted_coverages") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const rows = await sql`
    update professionals set full_name = ${name}, specialty = ${specialty}, bio = ${text(form, "bio")}
      ${form.has("accepted_coverages") ? sql`, accepted_coverages = ${coverages.length ? coverages : null}` : sql``}
    where id = ${id} and clinic_id = ${clinic.id} returning id`;
  if (!rows.length) return { ok: false, message: "Este profesional no pertenece a la clínica elegida. Recargá la página." };
  await saveProfessionalTypes(form, clinic.id, id);
  await touchClinic(clinic.id, "Equipo");
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: "Profesional guardado." };
}

/**
 * Lo que Sofi hace con la prestación (si puede moverla, urgencia, prestación previa, qué preguntar y
 * cómo dice el precio). Solo si el formulario trae esos campos; si algo está mal, el motivo.
 */
async function appointmentTypeRules(form: FormData, clinicId: string, selfId?: string): Promise<Record<string, unknown> | string> {
  if (!form.has("protocol_fields")) return {};
  const requires = uuid(form, "requires_type_id");
  if (requires) {
    if (requires === selfId) return "Una prestación no puede pedirse a sí misma antes.";
    const chain = await sql<Array<{ id: string; requires_type_id: string | null }>>`
      select id, requires_type_id from appointment_types where clinic_id = ${clinicId}`;
    if (!chain.some((t) => t.id === requires)) return "La prestación previa no es de esta clínica. Recargá la página.";
    // Que la cadena de prestaciones previas no vuelva a esta (A pide B, B pide A).
    const next = new Map(chain.map((t) => [t.id, t.requires_type_id]));
    for (let at: string | null | undefined = requires, steps = 0; at && steps < chain.length; at = next.get(at), steps++) {
      if (selfId && next.get(at) === selfId) return "Esas prestaciones se piden una a la otra: dejá la previa en una sola.";
    }
  }
  const mode = (text(form, "price_mode") ?? "referencia") as PriceMode;
  if (!PRICE_MODES.includes(mode)) return "Elegí cómo dice el precio Sofi.";
  return {
    agent_can_reschedule: form.get("agent_can_reschedule") === "on",
    is_urgent: form.get("is_urgent") === "on",
    requires_type_id: requires,
    ask_before: text(form, "ask_before")?.slice(0, 300) ?? null,
    price_mode: mode,
  };
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
  const rules = await appointmentTypeRules(form, clinic.id, id);
  if (typeof rules === "string") return { ok: false, message: rules };
  // El control periódico se carga en Campañas → Controles periódicos: sin el campo, se conserva.
  const rows = await sql`update appointment_types set name = ${name}, specialty = ${specialty}, duration_min = ${Math.round(duration)}, price = ${price},
    instructions = ${text(form, "instructions")},
    ${form.has("recall_months") ? sql`recall_months = ${Number.isFinite(recall) && recall > 0 && recall <= 60 ? Math.round(recall) : null},` : sql``}
    is_first_visit = ${form.get("is_first_visit") === "on"}, panel_only = ${form.get("panel_only") === "on"}
    where id = ${id} and clinic_id = ${clinic.id} returning id`;
  if (!rows.length) return { ok: false, message: "Esta prestación no pertenece a la clínica elegida. Recargá la página." };
  if (Object.keys(rules).length) await sql`update appointment_types set ${sql(rules)} where id = ${id} and clinic_id = ${clinic.id}`;
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
  const [created] = await sql<Array<{ id: string }>>`
    insert into professionals ${sql({
      clinic_id: clinic.id,
      full_name: name,
      specialty,
      bio: text(form, "bio"),
      accepted_coverages: coverages.length ? coverages : null,
    })}
    returning id`;
  await saveProfessionalTypes(form, clinic.id, created.id);
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
  // Horas reservadas para urgencias y horarios solo para algunas prestaciones (de esta clínica).
  const urgentOnly = form.get("urgent_only") === "on";
  const wanted = [...new Set(form.getAll("appointment_type_ids").filter((v): v is string => typeof v === "string" && isUuid(v)))];
  const typeIds = wanted.length
    ? (await sql<Array<{ id: string }>>`select id from appointment_types where clinic_id = ${clinic.id} and id = any(${wanted}::uuid[])`).map((t) => t.id)
    : [];
  await sql`
    insert into schedules (professional_id, weekday, start_time, end_time, urgent_only, appointment_type_ids)
    select p.id, w.weekday, ${start}::time, ${end}::time, ${urgentOnly}, ${typeIds.length ? typeIds : null}::uuid[]
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
  const rules = await appointmentTypeRules(form, clinic.id);
  if (typeof rules === "string") return;
  await sql`
    insert into appointment_types ${sql({
      ...rules,
      price,
      clinic_id: clinic.id,
      name,
      specialty,
      duration_min: Math.min(480, Math.max(5, Math.round(duration))),
      instructions: text(form, "instructions"),
      recall_months: Number.isFinite(recall) && recall > 0 ? Math.round(recall) : null,
      is_first_visit: form.get("is_first_visit") === "on",
      panel_only: form.get("panel_only") === "on",
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
  const result = await createScheduleBlock(clinic, {
    professionalId: uuid(form, "professional_id"),
    from: text(form, "date_from"),
    to: text(form, "date_to"),
    timeFrom: text(form, "time_from"),
    timeTo: text(form, "time_to"),
    reason: text(form, "reason"),
  });
  if (!result.ok) return result;
  await touchClinic(clinic.id, "Feriados y bloqueos");
  revalidatePath("/panel/configuracion", "layout");
  revalidatePath("/panel/agenda");
  return {
    ok: true,
    message: result.affected
      ? `Bloqueo guardado. Ojo: hay ${result.affected} turno(s) ya dados en ese período; reprogramalos desde la Agenda.`
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

/**
 * Después de actualizar un agente, las conversaciones abiertas siguen con el agente con el que
 * empezaron. Subir la revisión de la ficha hace que el próximo mensaje arranque una conversación
 * nueva con el agente actual y un resumen de lo hablado (ver forwardToAgent). Sin ids: todas.
 */
async function restartOpenConversations(clinicIds?: string[]): Promise<void> {
  if (clinicIds) await sql`update clinics set context_revision = context_revision + 1 where id = any(${clinicIds}::uuid[])`;
  else await sql`update clinics set context_revision = context_revision + 1 where id in (select clinic_id from channel_conversations where closed_at is null)`;
}

export type AgentSetupState = { ok?: boolean; message?: string };

export async function runAgentSetup(): Promise<AgentSetupState> {
  await requireAdmin();
  try {
    // El agente compartido es el de la clínica principal, sin importar la clínica elegida en el panel.
    const clinic = await getClinic();
    const result = await setupAgent(clinic);
    // El general atiende el WhatsApp de todas las clínicas: sus charlas abiertas toman el agente nuevo.
    await restartOpenConversations();
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

/** Prepara el agente propio del consultorio elegido; no cambia el agente general ni activa una línea. */
export async function runClinicAgentSetup(_previous: AgentSetupState | undefined, form: FormData): Promise<AgentSetupState> {
  await requireAdmin();
  const clinic = await getPanelClinic(form);
  const main = await getClinic();
  if (clinic.id === main.id) return { ok: false, message: "El agente general se administra desde Sistema." };
  try {
    const result = await setupAgent(clinic);
    await restartOpenConversations([clinic.id]);
    revalidatePath("/panel/configuracion", "layout");
    return {
      ok: true,
      // Recién creado, todavía no tiene número; actualizado, la línea que ya atiende toma los cambios.
      message: result.created
        ? `Sofi de ${clinic.name}: agente creado (${result.agentId}). Falta asignarle la línea entrante en el proveedor telefónico y comprobar una llamada real.`
        : `Sofi de ${clinic.name}: agente actualizado (${result.agentId}). Las llamadas ya toman las instrucciones y herramientas nuevas.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo preparar el agente de esta clínica." };
  }
}

/**
 * Pone al día a los agentes que atienden a esta clínica (el general, que atiende su WhatsApp, y el
 * propio de llamadas si tiene uno) con el prompt y las herramientas del equipo del consultorio.
 */
export async function runStaffAgentSetup(_previous: AgentSetupState | undefined, form: FormData): Promise<AgentSetupState> {
  await requireAdmin();
  const clinic = await getPanelClinic(form);
  const main = await getClinic();
  try {
    await setupAgent(main);
    const own = clinic.id !== main.id && clinic.elevenlabs_agent_id && clinic.elevenlabs_agent_id !== main.elevenlabs_agent_id;
    if (own) await setupAgent(clinic);
    // ElevenLabs fija el agente al empezar cada conversación: las abiertas arrancan de nuevo con el actual.
    await restartOpenConversations(clinic.id === main.id ? [main.id] : [main.id, clinic.id]);
    revalidatePath("/panel/configuracion", "layout");
    revalidatePath("/panel/sistema");
    return {
      ok: true,
      message: `Listo: ${clinic.agent_name} ya tiene las herramientas del equipo${own ? " (en WhatsApp y en las llamadas)" : ""}. Escribile un mensaje nuevo desde ese celular para probar.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No se pudo actualizar el agente." };
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
