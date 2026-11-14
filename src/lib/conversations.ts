import "server-only";
import { json, sql } from "./db";
import { INBOUND_CONTEXT, findPatientByPhone, getClinic, isUuid, resolveClinic } from "./clinic";
import { checkCallFuse } from "./chat-guard";
import { CALL_LIMITS } from "./chat-limits";
import { env } from "./env";
import { readAppointmentAccess } from "./agent/appointment-access";
import { findOrCreatePatientForPhone } from "./patients";
import { normalizePhone } from "./phone";
import { formatDate } from "./time";
import { mergeMemory } from "./memory";
import { notifyN8n } from "./n8n";
import type { Clinic, Conversation, Patient, Task } from "./types";

export { mergeMemory };

export type PostCallPayload = {
  agent_id: string;
  conversation_id: string;
  status?: string;
  user_id?: string | null;
  transcript?: Array<{ role: string; message: string | null; time_in_call_secs?: number }>;
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    phone_call?: { type?: string; external_number?: string; direction?: string; call_result?: string | null; stream_sid?: string | null } | null;
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
  if (phone.startsWith("telegram:")) return "telegram";
  if (data.metadata?.whatsapp || channel.includes("whatsapp") || channel.includes("custom")) return "whatsapp";
  if (data.metadata?.phone_call || /(twilio|sip|phone|telephon)/.test(channel)) return "telefono";
  if (phone.startsWith("web-")) return "web";
  return /^\d+$/.test(phone) ? "whatsapp" : "web";
}


/**
 * `quiet`: solo guarda la conversación (la recuperación desde ElevenLabs de las que no llegaron por el
 * webhook): no crea ni actualiza pacientes, no toca campañas, no genera tareas ni avisa a n8n.
 */
export async function recordConversation(data: PostCallPayload, { quiet = false }: { quiet?: boolean } = {}): Promise<void> {
  const vars = data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const clinic = await resolveClinic({ agentId: data.agent_id });
  const clinicId = isUuid(vars.clinic_id) ? vars.clinic_id : clinic.id;
  const phone = normalizePhone(
    (typeof vars.patient_phone === "string" && vars.patient_phone !== "desconocido" ? vars.patient_phone : null) ??
      data.user_id ??
      data.metadata?.phone_call?.external_number ??
      "",
  );
  // La charla puede mezclar a quien escribe con el paciente verificado para un turno.
  // Queda disponible para recepción sin sumar sus datos a la memoria de ninguna ficha.
  const temporaryAccess = await readAppointmentAccess({ clinicId, patientPhone: phone, conversationId: data.conversation_id });
  const campaignId = !temporaryAccess && isUuid(vars.campaign_id) ? vars.campaign_id : null;
  const direction = campaignId || (typeof vars.conversation_context === "string" && vars.conversation_context !== INBOUND_CONTEXT) ? "saliente" : "entrante";

  let patient: Patient | null = temporaryAccess ? null : await findPatientByPhone(clinicId, phone);
  const name = collected(data, "nombre_paciente");
  const memory = collected(data, "memoria");
  if (!quiet && !temporaryAccess && !patient && phone && name) patient = (await findOrCreatePatientForPhone(clinicId, phone, { name })).patient;
  const startedAt = data.metadata?.start_time_unix_secs
    ? new Date(data.metadata.start_time_unix_secs * 1000).toISOString()
    : new Date().toISOString();
  if (patient && !quiet) {
    await sql`
      update patients set
        last_contact_at = now(),
        memory_summary = ${mergeMemory(patient.memory_summary, memory, undefined, formatDate(startedAt, clinic.timezone))},
        full_name = coalesce(full_name, ${name})
      where id = ${patient.id}`;
  }

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

  if (quiet) return;
  if (campaignId && patient) await updateCampaignRecipient(campaignId, patient.id, data);

  if (row.channel === "telefono") {
    await afterCall(clinic, clinicId, data, patient, phone).catch((e) =>
      console.error("Límites de llamadas: no se pudo revisar la llamada", e instanceof Error ? e.message : e));
  }

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

/**
 * Después de cada llamada: si el agente propio de la clínica la cortó al llegar al tope de minutos,
 * recepción recibe una tarea para llamar al paciente; y se revisa el fusible de minutos del día.
 * El agente general no corta a los 8 minutos (también atiende chats), así que ahí no hay tarea.
 */
async function afterCall(agentClinic: Clinic, clinicId: string, data: PostCallPayload, patient: Patient | null, phone: string): Promise<void> {
  const clinic = clinicId === agentClinic.id ? agentClinic : await getClinic(clinicId);
  const ownAgent = agentClinic.elevenlabs_agent_id === data.agent_id && agentClinic.id !== (await getClinic()).id;
  const reachedLimit = (data.metadata?.call_duration_secs ?? 0) >= CALL_LIMITS.maxSeconds - 10;
  if (ownAgent && reachedLimit && !clinic.is_demo) {
    const [first] = await sql`insert into channel_events (key) values (${`tope-llamada:${data.conversation_id}`}) on conflict do nothing returning key`;
    if (first) {
      const who = patient?.full_name ?? (phone ? `+${phone}` : "quien llamó");
      const summary = data.analysis?.transcript_summary?.trim();
      const [task] = await sql<Task[]>`
        insert into tasks ${sql({
          clinic_id: clinic.id,
          patient_id: patient?.id ?? null,
          conversation_id: data.conversation_id,
          type: "derivacion_humana",
          priority: "normal",
          title: `Llamar a ${who}: la llamada llegó al tope de ${CALL_LIMITS.maxSeconds / 60} minutos`,
          details: `${clinic.agent_name || "Sofi"} cortó la llamada al llegar a los ${CALL_LIMITS.maxSeconds / 60} minutos y le dijo que lo iban a contactar.${summary ? ` Resumen: ${summary}` : ""}`,
        })}
        returning *`;
      await notifyN8n("tarea.creada", { clinic_id: clinic.id, task, panel_url: `${env.appUrl().replace(/\/$/, "")}/panel/tareas` });
    }
  }
  await checkCallFuse(clinic);
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
