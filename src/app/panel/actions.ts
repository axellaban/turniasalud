"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { syncCalendarLater } from "@/lib/calendar/sync";
import { sql } from "@/lib/db";
import { getClinic, isUuid } from "@/lib/clinic";
import { setupAgent } from "@/lib/agent/setup";
import { createCampaign, sendCampaign, CAMPAIGN_LABELS } from "@/lib/campaigns";
import { resolveTask } from "@/lib/tasks";
import { SESSION_COOKIE, createSessionToken, passwordMatches, safeNext, sessionCookieOptions } from "@/lib/session";
import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/types";
import { bookAppointment, registerPatient, ToolError } from "@/lib/agent/service";
import { normalizePhone } from "@/lib/phone";
import { addDaysKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
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
const APPOINTMENT_STATUSES = ["confirmado", "pendiente", "cancelado", "ausente", "atendido"];

export async function setAppointmentStatus(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  const status = text(form, "status");
  if (!id || !status || !APPOINTMENT_STATUSES.includes(status)) return;
  const clinic = await getPanelClinic(form);
  await sql`
    update appointments set status = ${status},
      cancelled_at = case when ${status} = 'cancelado' then now() else cancelled_at end
    where id = ${id} and clinic_id = ${clinic.id}`;
  syncCalendarLater(clinic.id);
  revalidatePath("/panel/agenda");
}

export type FormState = { ok?: boolean; message?: string };

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

export async function createManualAppointment(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const phone = normalizePhone(text(form, "phone"));
  const date = text(form, "date");
  const time = text(form, "time");
  const typeId = text(form, "appointment_type_id");
  const professionalId = text(form, "professional_id");
  if (!phone || !date || !time || !typeId || !professionalId) return { ok: false, message: "Completá todos los campos." };
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const startsAt = zonedTimeToUtc(y, m, d, hh, mm, clinic.timezone);
  const ctx = { clinicId: clinic.id, patientPhone: phone, channel: "panel" };
  try {
    await registerPatient(ctx, { nombre_completo: text(form, "full_name") ?? undefined, cobertura: text(form, "coverage") ?? undefined });
    const r = await bookAppointment(ctx, {
      tipo_turno_id: typeId,
      profesional_id: professionalId,
      inicio: startsAt.toISOString(),
      notas: text(form, "notes") ?? undefined,
    });
    syncCalendarLater(clinic.id);
    revalidatePath("/panel/agenda");
    return { ok: true, message: r.mensaje };
  } catch (e) {
    return { ok: false, message: e instanceof ToolError || e instanceof Error ? e.message : String(e) };
  }
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
// Campañas
// ---------------------------------------------------------------------------
export async function createCampaignAction(form: FormData) {
  await requireSession();
  const clinic = await getPanelClinic(form);
  const type = text(form, "type") as CampaignType | null;
  if (!type || !CAMPAIGN_TYPES.includes(type)) return;
  const templateKey = type === "personalizada" ? "" : type;
  // Por WAHA no hay templates de Meta: se manda el texto sugerido para ese tipo.
  const template = text(form, "template_name") ?? clinic.templates?.[templateKey] ?? (clinic.whatsapp_provider === "waha" ? type : null);
  if (!template) return;
  if (clinic.is_demo) throw new Error("Los perfiles de demo usan datos ficticios y no envían campañas.");
  const campaign = await createCampaign({
    clinicId: clinic.id,
    name: text(form, "name") ?? CAMPAIGN_LABELS[type].label,
    type,
    templateName: template,
    templateLanguage: text(form, "template_language") ?? clinic.templates?.idioma ?? "es_AR",
    goal: text(form, "goal") ?? undefined,
  });
  redirect(`/panel/campanas/${campaign.id}`);
}

export type SendState = { ok?: boolean; message?: string };

export async function sendCampaignAction(_prev: SendState | undefined, form: FormData): Promise<SendState> {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return { ok: false, message: "Falta la campaña." };
  const clinic = await getPanelClinic(form);
  if (clinic.is_demo) return { ok: false, message: "Los perfiles de demo no envían campañas." };
  if (!(await sql`select id from campaigns where id = ${id} and clinic_id = ${clinic.id}`).length) return { ok: false, message: "La campaña no pertenece a esta clínica." };
  try {
    const r = await sendCampaign(id);
    revalidatePath(`/panel/campanas/${id}`);
    return {
      ok: r.failed === 0,
      message: `Audiencia: ${r.audience}. Enviados: ${r.sent}. Omitidos: ${r.skipped}. Errores: ${r.failed}.${r.errors.length ? ` ${r.errors.slice(0, 3).join(" · ")}` : ""}`,
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
