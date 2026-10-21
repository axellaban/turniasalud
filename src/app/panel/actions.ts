"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { json, sql } from "@/lib/db";
import { getClinic, isUuid } from "@/lib/clinic";
import { setupAgent } from "@/lib/agent/setup";
import { createCampaign, sendCampaign, CAMPAIGN_LABELS } from "@/lib/campaigns";
import { resolveTask } from "@/lib/tasks";
import { SESSION_COOKIE, createSessionToken, passwordMatches, sessionCookieOptions, verifySessionToken } from "@/lib/session";
import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/types";
import { bookAppointment, registerPatient, ToolError } from "@/lib/agent/service";
import { normalizePhone } from "@/lib/phone";
import { addDaysKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import { AudioError, elegirVoces, generarAudio } from "@/lib/web-audios";
import { getConversacion } from "@/content/conversaciones";

async function requireSession() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE)?.value)) redirect("/panel/login");
}

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
  const next = String(form.get("next") ?? "/panel");
  redirect(next === "/demo" || next === "/panel" || next.startsWith("/panel/") ? next : "/panel");
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
  const clinic = await getClinic();
  await sql`
    update appointments set status = ${status},
      cancelled_at = case when ${status} = 'cancelado' then now() else cancelled_at end
    where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath("/panel/agenda");
}

export type FormState = { ok?: boolean; message?: string };

export async function createManualAppointment(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const clinic = await getClinic();
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
  const clinic = await getClinic();
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
  const clinic = await getClinic();
  await sql`update patients set contact_opt_out = ${form.get("opt_out") === "true"} where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath(`/panel/pacientes/${id}`);
}

export async function resolveTaskAction(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return { ok: false, message: "Falta la tarea." };
  const clinic = await getClinic();
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
  const clinic = await getClinic();
  const coverages = (text(form, "accepted_coverages") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const templates: Record<string, string> = { ...clinic.templates };
  for (const key of ["recordatorio", "recall", "lista_espera", "reactivacion", "no_show", "encuesta", "respuesta", "idioma"]) {
    const value = text(form, `template_${key}`);
    if (value) templates[key] = value;
    else delete templates[key];
  }
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
      whatsapp_phone_number_id: text(form, "whatsapp_phone_number_id"),
      whatsapp_provider: text(form, "whatsapp_provider") === "waha" ? "waha" : "meta",
      elevenlabs_voice_id: text(form, "elevenlabs_voice_id"),
      handoff_phone: text(form, "handoff_phone"),
      after_hours_instructions: text(form, "after_hours_instructions"),
      templates: json(templates),
    })}
    where id = ${clinic.id}`;
  revalidatePath("/panel/configuracion");
}

export async function addProfessional(form: FormData) {
  await requireSession();
  const clinic = await getClinic();
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
  revalidatePath("/panel/configuracion");
}

export async function toggleProfessional(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getClinic();
  await sql`update professionals set active = ${form.get("active") === "true"} where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath("/panel/configuracion");
}

export async function addSchedule(form: FormData) {
  await requireSession();
  const professionalId = uuid(form, "professional_id");
  const start = text(form, "start_time");
  const end = text(form, "end_time");
  const weekdays = form.getAll("weekday").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (!professionalId || !start || !end || !weekdays.length || end <= start) return;
  const clinic = await getClinic();
  await sql`
    insert into schedules (professional_id, weekday, start_time, end_time)
    select p.id, w.weekday, ${start}::time, ${end}::time
    from professionals p, unnest(${weekdays}::smallint[]) as w(weekday)
    where p.id = ${professionalId} and p.clinic_id = ${clinic.id}`;
  revalidatePath("/panel/configuracion");
}

export async function deleteSchedule(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  const clinic = await getClinic();
  if (id) {
    await sql`
      delete from schedules s using professionals p
      where s.id = ${id} and p.id = s.professional_id and p.clinic_id = ${clinic.id}`;
  }
  revalidatePath("/panel/configuracion");
}

export async function addAppointmentType(form: FormData) {
  await requireSession();
  const clinic = await getClinic();
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
  revalidatePath("/panel/configuracion");
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
  const clinic = await getClinic();
  await sql`update appointment_types set price = ${parsePrice(text(form, "price"))} where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath("/panel/configuracion");
  revalidatePath("/panel");
}

// ---------------------------------------------------------------------------
// Feriados, vacaciones y bloqueos de agenda
// ---------------------------------------------------------------------------
export async function addScheduleBlock(_prev: FormState | undefined, form: FormData): Promise<FormState> {
  await requireSession();
  const clinic = await getClinic();
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
  revalidatePath("/panel/configuracion");
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
  const clinic = await getClinic();
  await sql`delete from schedule_blocks where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath("/panel/configuracion");
  revalidatePath("/panel/agenda");
}

export async function toggleAppointmentType(form: FormData) {
  await requireSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getClinic();
  await sql`update appointment_types set active = ${form.get("active") === "true"} where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath("/panel/configuracion");
}

export type AgentSetupState = { ok?: boolean; message?: string };

export async function runAgentSetup(): Promise<AgentSetupState> {
  await requireSession();
  try {
    const clinic = await getClinic();
    const result = await setupAgent(clinic);
    revalidatePath("/panel/configuracion");
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
  const clinic = await getClinic();
  const type = text(form, "type") as CampaignType | null;
  if (!type || !CAMPAIGN_TYPES.includes(type)) return;
  const templateKey = type === "personalizada" ? "" : type;
  // Por WAHA no hay templates de Meta: se manda el texto sugerido para ese tipo.
  const template = text(form, "template_name") ?? clinic.templates?.[templateKey] ?? (clinic.whatsapp_provider === "waha" ? type : null);
  if (!template) return;
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
  await requireSession();
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
