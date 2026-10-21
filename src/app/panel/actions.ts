"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getClinic } from "@/lib/clinic";
import { setupAgent } from "@/lib/agent/setup";
import { createCampaign, sendCampaign, CAMPAIGN_LABELS } from "@/lib/campaigns";
import { SESSION_COOKIE, createSessionToken, passwordMatches, sessionCookieOptions, verifySessionToken } from "@/lib/session";
import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/types";
import { bookAppointment, registerPatient, ToolError } from "@/lib/agent/service";
import { normalizePhone } from "@/lib/phone";
import { zonedTimeToUtc } from "@/lib/time";

async function requireSession() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE)?.value)) redirect("/panel/login");
}

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  redirect(next.startsWith("/panel") ? next : "/panel");
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
  const id = text(form, "id");
  const status = text(form, "status");
  if (!id || !status || !APPOINTMENT_STATUSES.includes(status)) return;
  await db()
    .from("appointments")
    .update({ status, ...(status === "cancelado" ? { cancelled_at: new Date().toISOString() } : {}) })
    .eq("id", id);
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
  const id = text(form, "id");
  const status = text(form, "status");
  if (!id || !status || !["abierta", "en_curso", "resuelta"].includes(status)) return;
  await db()
    .from("tasks")
    .update({ status, resolved_at: status === "resuelta" ? new Date().toISOString() : null })
    .eq("id", id);
  revalidatePath("/panel/tareas");
  revalidatePath("/panel");
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
  for (const key of ["recordatorio", "recall", "lista_espera", "reactivacion", "no_show", "idioma"]) {
    const value = text(form, `template_${key}`);
    if (value) templates[key] = value;
    else delete templates[key];
  }
  await db()
    .from("clinics")
    .update({
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
      elevenlabs_voice_id: text(form, "elevenlabs_voice_id"),
      templates,
    })
    .eq("id", clinic.id);
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
  await db()
    .from("professionals")
    .insert({ clinic_id: clinic.id, full_name: name, specialty, bio: text(form, "bio"), accepted_coverages: coverages.length ? coverages : null });
  revalidatePath("/panel/configuracion");
}

export async function toggleProfessional(form: FormData) {
  await requireSession();
  const id = text(form, "id");
  if (!id) return;
  await db().from("professionals").update({ active: form.get("active") === "true" }).eq("id", id);
  revalidatePath("/panel/configuracion");
}

export async function addSchedule(form: FormData) {
  await requireSession();
  const professionalId = text(form, "professional_id");
  const start = text(form, "start_time");
  const end = text(form, "end_time");
  const weekdays = form.getAll("weekday").map(Number).filter((n) => n >= 0 && n <= 6);
  if (!professionalId || !start || !end || !weekdays.length || end <= start) return;
  await db()
    .from("schedules")
    .insert(weekdays.map((weekday) => ({ professional_id: professionalId, weekday, start_time: start, end_time: end })));
  revalidatePath("/panel/configuracion");
}

export async function deleteSchedule(form: FormData) {
  await requireSession();
  const id = text(form, "id");
  if (id) await db().from("schedules").delete().eq("id", id);
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
  await db().from("appointment_types").insert({
    clinic_id: clinic.id,
    name,
    specialty,
    duration_min: Math.min(480, Math.max(5, Math.round(duration))),
    instructions: text(form, "instructions"),
    recall_months: Number.isFinite(recall) && recall > 0 ? Math.round(recall) : null,
    is_first_visit: form.get("is_first_visit") === "on",
  });
  revalidatePath("/panel/configuracion");
}

export async function toggleAppointmentType(form: FormData) {
  await requireSession();
  const id = text(form, "id");
  if (!id) return;
  await db().from("appointment_types").update({ active: form.get("active") === "true" }).eq("id", id);
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
  const template = text(form, "template_name") ?? clinic.templates?.[templateKey];
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
  const id = text(form, "id");
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
