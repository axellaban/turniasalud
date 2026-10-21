import "server-only";
import { json, sql } from "./db";
import { INBOUND_CONTEXT, findPatientByPhone, isUuid, resolveClinic } from "./clinic";
import { normalizePhone } from "./phone";
import { notifyN8n } from "./n8n";
import type { Conversation, Patient } from "./types";

export type PostCallPayload = {
  agent_id: string;
  conversation_id: string;
  status?: string;
  user_id?: string | null;
  transcript?: Array<{ role: string; message: string | null; time_in_call_secs?: number }>;
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    phone_call?: { type?: string; external_number?: string } | null;
    whatsapp?: unknown;
    [key: string]: unknown;
  };
  analysis?: {
    call_successful?: string;
    transcript_summary?: string;
    call_summary_title?: string;
    data_collection_results?: Record<string, { value?: unknown }>;
    evaluation_criteria_results?: Record<string, unknown>;
  };
  conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
};

function collected(data: PostCallPayload, key: string): string | null {
  const value = data.analysis?.data_collection_results?.[key]?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Puntaje 0-10 de la encuesta (ElevenLabs lo manda como número o como texto). */
export function satisfactionScore(data: PostCallPayload): number | null {
  const value = data.analysis?.data_collection_results?.satisfaccion?.value;
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : null;
}

export function detectChannel(data: PostCallPayload, phone: string): Conversation["channel"] {
  const vars = data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const channel = String(vars.system__channel ?? "").toLowerCase();
  // El Custom Channel solo se usa para WhatsApp por WAHA.
  if (data.metadata?.whatsapp || channel.includes("whatsapp") || channel.includes("custom")) return "whatsapp";
  if (data.metadata?.phone_call || /(twilio|sip|phone|telephon)/.test(channel)) return "telefono";
  if (phone.startsWith("web-")) return "web";
  return /^\d+$/.test(phone) ? "whatsapp" : "web";
}

/** Combina la memoria previa con lo nuevo, sin crecer indefinidamente. */
export function mergeMemory(previous: string | null, addition: string | null, max = 800): string | null {
  if (!addition) return previous;
  if (previous?.includes(addition)) return previous;
  const merged = previous ? `${previous} ${addition}` : addition;
  return merged.length > max ? `…${merged.slice(merged.length - max)}` : merged;
}

export async function recordConversation(data: PostCallPayload): Promise<void> {
  const vars = data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const clinic = await resolveClinic({ agentId: data.agent_id });
  const clinicId = isUuid(vars.clinic_id) ? vars.clinic_id : clinic.id;
  const phone = normalizePhone(
    (typeof vars.patient_phone === "string" && vars.patient_phone !== "desconocido" ? vars.patient_phone : null) ??
      data.user_id ??
      data.metadata?.phone_call?.external_number ??
      "",
  );
  const campaignId = isUuid(vars.campaign_id) ? vars.campaign_id : null;
  const direction = campaignId || (typeof vars.conversation_context === "string" && vars.conversation_context !== INBOUND_CONTEXT) ? "saliente" : "entrante";

  let patient: Patient | null = await findPatientByPhone(clinicId, phone);
  const name = collected(data, "nombre_paciente");
  const memory = collected(data, "memoria");
  if (!patient && phone && name) {
    [patient] = await sql<Patient[]>`
      insert into patients (clinic_id, phone, full_name) values (${clinicId}, ${phone}, ${name})
      on conflict (clinic_id, phone) do update set full_name = coalesce(patients.full_name, excluded.full_name)
      returning *`;
  }
  if (patient) {
    await sql`
      update patients set
        last_contact_at = now(),
        memory_summary = ${mergeMemory(patient.memory_summary, memory)},
        full_name = coalesce(full_name, ${name})
      where id = ${patient.id}`;
  }

  const startedAt = data.metadata?.start_time_unix_secs
    ? new Date(data.metadata.start_time_unix_secs * 1000).toISOString()
    : new Date().toISOString();

  const row = {
    clinic_id: clinicId,
    patient_id: patient?.id ?? null,
    campaign_id: campaignId,
    elevenlabs_conversation_id: data.conversation_id,
    channel: detectChannel(data, phone),
    direction,
    started_at: startedAt,
    duration_secs: data.metadata?.call_duration_secs ?? null,
    status: data.status ?? null,
    title: data.analysis?.call_summary_title ?? null,
    summary: data.analysis?.transcript_summary ?? null,
    intent: collected(data, "motivo"),
    outcome: collected(data, "resultado"),
    call_successful: data.analysis?.call_successful ?? null,
    satisfaction: satisfactionScore(data),
    transcript: (data.transcript ?? []).map((t) => ({ role: t.role, message: t.message, time_in_call_secs: t.time_in_call_secs })),
    analysis: {
      data_collection: data.analysis?.data_collection_results ?? {},
      evaluation: data.analysis?.evaluation_criteria_results ?? {},
      sentimiento: collected(data, "sentimiento"),
    },
  };
  // ElevenLabs puede reenviar el webhook: la conversación se guarda una sola vez.
  const values = { ...row, transcript: json(row.transcript), analysis: json(row.analysis) };
  await sql`
    insert into conversations ${sql(values)}
    on conflict (elevenlabs_conversation_id) do update set
      patient_id = excluded.patient_id, campaign_id = excluded.campaign_id, channel = excluded.channel,
      direction = excluded.direction, started_at = excluded.started_at, duration_secs = excluded.duration_secs,
      status = excluded.status, title = excluded.title, summary = excluded.summary, intent = excluded.intent,
      outcome = excluded.outcome, call_successful = excluded.call_successful, satisfaction = excluded.satisfaction,
      transcript = excluded.transcript,
      analysis = excluded.analysis`;

  if (campaignId && patient) await updateCampaignRecipient(campaignId, patient.id, data);

  await notifyN8n("conversacion.finalizada", {
    clinic_id: clinicId,
    conversation_id: data.conversation_id,
    channel: row.channel,
    patient: patient ? { id: patient.id, name: patient.full_name, phone: patient.phone } : null,
    summary: row.summary,
    intent: row.intent,
    outcome: row.outcome,
    satisfaction: row.satisfaction,
  });
}

/** Marca si el destinatario de una campaña respondió o sacó turno. */
export async function updateCampaignRecipient(campaignId: string, patientId: string, data: PostCallPayload) {
  const [recipient] = await sql<Array<{ id: string; sent_at: string | null; status: string }>>`
    select id, sent_at, status from campaign_recipients where campaign_id = ${campaignId} and patient_id = ${patientId}`;
  if (!recipient || recipient.status === "agendo") return;
  const userSpoke = (data.transcript ?? []).some((t) => t.role === "user" && t.message);
  if (!userSpoke) return;
  const [{ booked }] = await sql<Array<{ booked: boolean }>>`
    select exists (
      select 1 from appointments
      where patient_id = ${patientId} and created_at >= ${recipient.sent_at ?? new Date(0)} and status <> 'cancelado'
    ) as booked`;
  await sql`update campaign_recipients set status = ${booked ? "agendo" : "respondio"} where id = ${recipient.id}`;
}
