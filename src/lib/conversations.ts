import "server-only";
import { db } from "./supabase";
import { INBOUND_CONTEXT, findPatientByPhone, resolveClinic } from "./clinic";
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

export function detectChannel(data: PostCallPayload, phone: string): Conversation["channel"] {
  const vars = data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const channel = String(vars.system__channel ?? "").toLowerCase();
  if (data.metadata?.whatsapp || channel.includes("whatsapp")) return "whatsapp";
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
  const clinicId = typeof vars.clinic_id === "string" ? vars.clinic_id : clinic.id;
  const phone = normalizePhone(
    (typeof vars.patient_phone === "string" && vars.patient_phone !== "desconocido" ? vars.patient_phone : null) ??
      data.user_id ??
      data.metadata?.phone_call?.external_number ??
      "",
  );
  const campaignId = typeof vars.campaign_id === "string" && vars.campaign_id !== "ninguna" ? vars.campaign_id : null;
  const direction = campaignId || (typeof vars.conversation_context === "string" && vars.conversation_context !== INBOUND_CONTEXT) ? "saliente" : "entrante";

  let patient: Patient | null = await findPatientByPhone(clinicId, phone);
  const name = collected(data, "nombre_paciente");
  const memory = collected(data, "memoria");
  if (!patient && phone && name) {
    const created = await db().from("patients").insert({ clinic_id: clinicId, phone, full_name: name }).select("*").single();
    patient = (created.data as Patient) ?? null;
  }
  if (patient) {
    await db()
      .from("patients")
      .update({
        last_contact_at: new Date().toISOString(),
        memory_summary: mergeMemory(patient.memory_summary, memory),
        ...(name && !patient.full_name ? { full_name: name } : {}),
      })
      .eq("id", patient.id);
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
    transcript: (data.transcript ?? []).map((t) => ({ role: t.role, message: t.message, time_in_call_secs: t.time_in_call_secs })),
    analysis: {
      data_collection: data.analysis?.data_collection_results ?? {},
      evaluation: data.analysis?.evaluation_criteria_results ?? {},
      sentimiento: collected(data, "sentimiento"),
    },
  };
  const saved = await db().from("conversations").upsert(row, { onConflict: "elevenlabs_conversation_id" });
  if (saved.error) throw new Error(`No se pudo guardar la conversación: ${saved.error.message}`);

  if (campaignId && patient) await updateCampaignRecipient(campaignId, patient.id, data);

  await notifyN8n("conversacion.finalizada", {
    clinic_id: clinicId,
    conversation_id: data.conversation_id,
    channel: row.channel,
    patient: patient ? { id: patient.id, name: patient.full_name, phone: patient.phone } : null,
    summary: row.summary,
    intent: row.intent,
    outcome: row.outcome,
  });
}

async function updateCampaignRecipient(campaignId: string, patientId: string, data: PostCallPayload) {
  const recipient = await db()
    .from("campaign_recipients")
    .select("id, sent_at, status")
    .eq("campaign_id", campaignId)
    .eq("patient_id", patientId)
    .maybeSingle();
  if (!recipient.data) return;
  const userSpoke = (data.transcript ?? []).some((t) => t.role === "user" && t.message);
  if (!userSpoke) return;
  const booked = await db()
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .gte("created_at", recipient.data.sent_at ?? new Date(0).toISOString());
  await db()
    .from("campaign_recipients")
    .update({ status: (booked.count ?? 0) > 0 ? "agendo" : "respondio" })
    .eq("id", recipient.data.id);
}
