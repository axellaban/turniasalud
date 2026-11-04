import { readAppointmentAccess } from "./agent/appointment-access";
import "server-only";
import { json, sql, type Sql, type TransactionSql } from "./db";
import { INBOUND_CONTEXT, buildDynamicVariables, findPatientByPhone, getClinic } from "./clinic";
import { agentVoiceId, sendChannelMessage, textToSpeech } from "./elevenlabs";
import { updateCampaignRecipient } from "./conversations";
import { notifyN8n } from "./n8n";
import { sendChatText, sendChatVoice } from "./messaging";
import { channelForChat, chatIsActive, requireActiveChannel, ChannelPausedError } from "./messaging-settings";
import type { Clinic } from "./types";
import { currentWahaConnection, wahaConnectionById, withWahaConnection } from "./waha-connections";

// Conversaciones de WhatsApp por WAHA + Custom Channel de ElevenLabs.
// WAHA entrega cada mensaje suelto; acá decidimos a qué conversación del
// agente pertenece y a qué chat va su respuesta.

/** Sin mensajes durante este tiempo, el próximo arranca una conversación nueva. */
export const IDLE_MINUTES = 15;
/** Un mensaje de campaña espera la respuesta del paciente hasta 3 días. */
const CAMPAIGN_REPLY_HOURS = 72;

export type TranscriptLine = { role: "user" | "agent"; message: string; at: string; voiceReplyFor?: string };

/** Lo último que se habló, para que el agente siga el hilo al arrancar una conversación nueva. */
export function recapTranscript(lines: TranscriptLine[], max = 1200): string {
  const text = lines.slice(-6).map((l) => `${l.role === "user" ? "Paciente" : "Agente"}: ${l.message.replace(/\s+/g, " ").trim()}`).join(" | ");
  return text.length > max ? `…${text.slice(-max)}` : text;
}

export type ChannelConversation = {
  id: string;
  channel_revision: number;
  waha_connection_id: string | null;
  clinic_id: string;
  phone: string;
  chat_id: string;
  elevenlabs_conversation_id: string | null;
  campaign_id: string | null;
  context: string | null;
  transcript: TranscriptLine[];
  /** El agente contesta con notas de voz (modo audio de la demo). */
  reply_with_voice: boolean;
  /** Revisión de la ficha de la clínica con la que arrancó la conversación del agente. */
  context_revision: number | null;
  last_activity_at: string;
  closed_at: string | null;
  created_at: string;
};

/** Clínica que atiende el WhatsApp de WAHA (la primera con ese proveedor, o la de por defecto). */
export async function whatsappClinic(): Promise<Clinic> {
  const [clinic] = await sql<Clinic[]>`
    select * from clinics where whatsapp_provider = 'waha' and not is_demo order by created_at limit 1`;
  return clinic ?? getClinic();
}

/** Marca un mensaje como procesado. Devuelve false si ya lo estaba (reintento del webhook). */
export async function claimEvent(key: string): Promise<boolean> {
  const rows = await sql`insert into channel_events (key) values (${key}) on conflict do nothing returning key`;
  return rows.length > 0;
}

/** Libera la marca si el envío falló, para que el reintento lo vuelva a procesar. */
export async function releaseEvent(key: string): Promise<void> {
  await sql`delete from channel_events where key = ${key}`;
}

const line = (role: TranscriptLine["role"], message: string): TranscriptLine => ({ role, message, at: new Date().toISOString() });

/** Solo cuando la persona pide una respuesta en audio, aunque ella haya escrito. */
export function requestsVoiceReply(text: string): boolean {
  const request = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/^\(audio\)\s*/, "").trim();
  const format = /\b(?:en audio|(?:por|un|una) (?:audio|nota de voz|mensaje de voz))\b/;
  if (!format.test(request) || /\b(?:no|sin|nunca) (?:\w+ ){0,4}(?:audio|nota de voz|mensaje de voz)\b/.test(request)) return false;
  return /^(?:en audio|por audio|una nota de voz|un audio)[\s,.!?¡¿]*$/.test(request)
    || /\b(?:manda\w*|envia\w*|deci\w*|respon\w*|contesta\w*|pasa\w*|recorda\w*|prefiero|quiero|pod\w*)\b/.test(request);
}

async function findOpen(db: Sql | TransactionSql, clinicId: string, phone: string): Promise<ChannelConversation | null> {
  const [conv] = await db<ChannelConversation[]>`
    select * from channel_conversations
    where clinic_id = ${clinicId} and phone = ${phone} and closed_at is null
      and waha_connection_id is not distinct from ${currentWahaConnection()?.id ?? null}::text
      and (last_activity_at > now() - make_interval(mins => ${IDLE_MINUTES})
        or (elevenlabs_conversation_id is null and created_at > now() - make_interval(hours => ${CAMPAIGN_REPLY_HOURS})))
    order by last_activity_at desc
    limit 1`;
  return conv ?? null;
}

/**
 * Guarda un mensaje saliente (campaña, lista de espera, respuesta a un pedido)
 * para que, si el paciente contesta, el agente sepa qué le escribimos.
 */
export async function registerOutbound(
  clinicId: string,
  msg: { phone: string; chatId: string; text: string; context: string; campaignId?: string },
): Promise<void> {
  const settings = await requireActiveChannel(channelForChat(msg.chatId));
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${clinicId}:${msg.phone}`}, 0))`;
    await tx`update channel_conversations set closed_at = now() where clinic_id = ${clinicId} and phone = ${msg.phone} and closed_at is null
      and waha_connection_id is not distinct from ${currentWahaConnection()?.id ?? null}::text`;
    await tx`
      insert into channel_conversations ${tx({
        clinic_id: clinicId,
        waha_connection_id: currentWahaConnection()?.id ?? null,
        channel_revision: settings.revision,
        phone: msg.phone,
        chat_id: msg.chatId,
        campaign_id: msg.campaignId ?? null,
        context: `${msg.context} Ya le mandamos este mensaje por WhatsApp: «${msg.text}»`,
        transcript: json([line("agent", msg.text)]),
      })}`;
  });
}

/**
 * Pasa el mensaje del paciente al agente. Sigue la conversación abierta o
 * arranca una nueva, siempre con todas las variables dinámicas (si falta una,
 * ElevenLabs corta la conversación). `context` y `replyWithVoice` valen para
 * una conversación nueva (la demo del lead magnet).
 */
export async function forwardToAgent(
  clinic: Clinic,
  input: { messageId: string; chatId: string; phone: string; text: string },
  opts: { context?: string; replyWithVoice?: boolean; voiceForMessage?: boolean } = {},
): Promise<{ conversation_id: string; continued: boolean }> {
  if (currentWahaConnection() && currentWahaConnection()!.clinicId !== clinic.id) throw new Error("La línea de WhatsApp no corresponde a esta clínica.");
  const settings = await requireActiveChannel(channelForChat(input.chatId));
  // Fuera de la transacción: son varias consultas y no conviene retener la conexión.
  const vars = await buildDynamicVariables(clinic, input.phone);
  return sql.begin(async (tx) => {
    // Dos mensajes seguidos del mismo paciente no pueden abrir dos conversaciones.
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${clinic.id}:${input.phone}`}, 0))`;
    const open = await findOpen(tx, clinic.id, input.phone);
    // Si la ficha de la clínica cambió durante la charla (alguien editó reglas, horarios o
    // prestaciones), el agente arranca una conversación nueva con los datos actuales y un
    // resumen de lo que ya se habló. ElevenLabs fija las variables al empezar cada conversación.
    const revision = clinic.context_revision ?? null;
    const stale = Boolean(open?.elevenlabs_conversation_id) && open!.context_revision != null && revision != null && open!.context_revision !== revision;
    await tx`
      update channel_conversations set closed_at = now()
      where clinic_id = ${clinic.id} and phone = ${input.phone} and closed_at is null and id is distinct from ${open?.id ?? null}::uuid
        and waha_connection_id is not distinct from ${currentWahaConnection()?.id ?? null}::text`;

    vars.conversation_context = open?.context ?? opts.context ?? INBOUND_CONTEXT;
    if (channelForChat(input.chatId) === "telegram") vars.conversation_context += " Canal actual: Telegram. Respondé en texto breve sin Markdown; cuando el usuario elige audio, Turnia convierte tu respuesta con tu voz de ElevenLabs. No pidas un teléfono para identificarlo: patient_phone es su identidad de Telegram.";
    if (stale && open?.transcript.length) vars.conversation_context += ` La información de la clínica se actualizó durante esta charla: usá la de ahora. Lo último que se habló: ${recapTranscript(open.transcript)}`;
    vars.campaign_id = open?.campaign_id ?? "ninguna";
    // El webhook decide: un audio del paciente, o un pedido de audio en una línea propia con voz.
    const voiceForMessage = Boolean(opts.voiceForMessage) && channelForChat(input.chatId) === "whatsapp";
    const text = voiceForMessage
      ? `${input.text}\n[Canal: esta respuesta se enviará como nota de voz. Respondé a lo que pide con frases breves para escuchar.]`
      : input.text;
    const res = await sendChannelMessage({
      messageId: input.messageId,
      text,
      userIdentifier: input.phone,
      conversationId: stale ? undefined : open?.elevenlabs_conversation_id,
      dynamicVariables: vars,
    });

    const userLine = json([{ ...line("user", input.text), ...(voiceForMessage && { voiceReplyFor: input.messageId }) }]);
    if (open) {
      await tx`
        update channel_conversations set
          elevenlabs_conversation_id = ${res.conversation_id},
          context_revision = ${revision},
          chat_id = ${input.chatId},
          transcript = transcript || ${userLine},
          last_activity_at = now()
        where id = ${open.id}`;
    } else {
      await tx`
        insert into channel_conversations ${tx({
          clinic_id: clinic.id,
          waha_connection_id: currentWahaConnection()?.id ?? null,
          channel_revision: settings.revision,
          phone: input.phone,
          chat_id: input.chatId,
          elevenlabs_conversation_id: res.conversation_id,
          context: opts.context ?? null,
          reply_with_voice: opts.replyWithVoice ?? false,
          context_revision: revision,
          transcript: userLine,
        })}
        on conflict (elevenlabs_conversation_id) do update set
          closed_at = null, chat_id = excluded.chat_id, last_activity_at = now(),
          transcript = channel_conversations.transcript || excluded.transcript`;
    }
    return { conversation_id: res.conversation_id, continued: Boolean(open?.elevenlabs_conversation_id) && !stale };
  });
}

// ---------------------------------------------------------------------------
// Respuestas del agente (webhook del Custom Channel)
// ---------------------------------------------------------------------------
export type ChannelReply = {
  version?: string;
  conversation_id: string;
  user_message_ids?: string[];
  status: "completed" | "failed" | string;
  data?: Array<{ type: string; event?: Record<string, unknown> }>;
  error?: string | null;
};

/** Une las respuestas del turno en un solo mensaje y detecta si el agente cerró la conversación. Puro. */
export function summarizeReply(reply: ChannelReply): { text: string; ended: boolean; responseIds: string[] } {
  const texts: string[] = [];
  const responseIds: string[] = [];
  let ended = false;
  for (const item of reply.data ?? []) {
    const event = item.event ?? {};
    if (item.type === "agent_response" && typeof event.agent_response === "string" && event.agent_response.trim()) {
      texts.push(event.agent_response.trim());
      if (typeof event.response_id === "string") responseIds.push(event.response_id);
    }
    if (item.type === "agent_tool_response" && event.tool_name === "end_call" && event.status === "success") ended = true;
  }
  return { text: texts.join("\n\n"), ended, responseIds };
}

/** WhatsApp usa *negrita* y no entiende los links de Markdown. */
export function toWhatsAppText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/^#{1,6}\s+/gm, "");
}

export const AUDIO_FAILED_REPLY = "Perdón, no pude escuchar tu audio. ¿Me lo escribís?";
export const MEDIA_ONLY_REPLY =
  "No pude ver esa foto o archivo. ¿Me contás por escrito qué necesitás? Si es la credencial o una orden médica, probá mandar otra foto con buena luz, o traela el día del turno.";
export const FAILED_REPLY = "Perdón, tuve un problema para responderte. ¿Me lo escribís de nuevo en un ratito?";

export type ReplyOutcome =
  | { status: "unknown_conversation" }
  | { status: "duplicate" | "inactive" }
  | { status: "send_failed"; error: string }
  | { status: "sent" | "empty"; ended: boolean };

export async function handleReply(reply: ChannelReply): Promise<ReplyOutcome> {
  const [conv] = await sql<ChannelConversation[]>`
    select * from channel_conversations where elevenlabs_conversation_id = ${reply.conversation_id}`;
  // Puede llegar antes de que terminemos de guardar la conversación: un 409 hace que ElevenLabs reintente.
  if (!conv) return { status: "unknown_conversation" };

  if (conv.waha_connection_id) {
    const own = wahaConnectionById(conv.waha_connection_id);
    // Nunca usar el WAHA general si una conexión se pausó, borró o reasignó.
    if (!own || !own.enabled || own.clinicId !== conv.clinic_id || own.revision !== conv.channel_revision) return { status: "inactive" };
    return withWahaConnection(own, () => deliverReply(reply, conv));
  }
  return deliverReply(reply, conv);
}

async function deliverReply(reply: ChannelReply, conv: ChannelConversation): Promise<ReplyOutcome> {

  if (conv.closed_at || !(await chatIsActive(conv.chat_id, conv.channel_revision))) return { status: "inactive" };

  const { text: agentText, ended, responseIds } = summarizeReply(reply);
  const ids = [...(reply.user_message_ids ?? [])].sort();
  const key = `out:${reply.conversation_id}:${(ids.length ? ids : responseIds).join(",") || reply.status}`;
  if (!(await claimEvent(key))) return { status: "duplicate" };

  const failed = reply.status === "failed";
  if (failed) console.error("Custom Channel: el agente no pudo responder", reply.conversation_id, reply.error);
  const text = failed ? FAILED_REPLY : toWhatsAppText(agentText);

  if (text) {
    try {
      const requestedVoice = conv.transcript.some((t) => t.voiceReplyFor && ids.includes(t.voiceReplyFor));
      if ((conv.reply_with_voice || requestedVoice) && !failed) await sendVoiceReply(conv, text, requestedVoice);
      else await sendChatText(conv.chat_id, text);
    } catch (e) {
      if (e instanceof ChannelPausedError) return { status: "inactive" };
      await releaseEvent(key);
      return { status: "send_failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  const [updated] = await sql<ChannelConversation[]>`
    update channel_conversations set
      transcript = transcript || ${json(text && !failed ? [line("agent", text)] : [])},
      last_activity_at = now(),
      closed_at = case when ${ended} then now() else closed_at end
    where id = ${conv.id}
    returning *`;
  await savePanelConversation(updated, ended);
  return { status: text ? "sent" : "empty", ended };
}

const agentVoices = new Map<string, string | null>();

async function voiceOfAgent(agentId: string): Promise<string | null> {
  if (agentVoices.has(agentId)) return agentVoices.get(agentId) ?? null;
  try {
    const voice = await agentVoiceId(agentId);
    agentVoices.set(agentId, voice);
    return voice;
  } catch (e) {
    // Sin guardar: si ElevenLabs falló un momento, la próxima nota lo vuelve a intentar.
    console.error("Canal: no se pudo leer la voz del agente", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Voz de la nota: la de la clínica que atiende (su voz guardada o la de su agente), así un consultorio
 * suena igual que en sus llamadas. Las clínicas que arma la demo no tienen agente: usan la general.
 */
async function replyVoiceId(clinicId: string): Promise<string | null> {
  const clinic = await getClinic(clinicId).catch(() => null);
  if (clinic?.elevenlabs_voice_id) return clinic.elevenlabs_voice_id;
  if (clinic?.elevenlabs_agent_id) {
    const voice = await voiceOfAgent(clinic.elevenlabs_agent_id);
    if (voice) return voice;
  }
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  const main = await getClinic();
  if (main.elevenlabs_voice_id) return main.elevenlabs_voice_id;
  return main.elevenlabs_agent_id ? voiceOfAgent(main.elevenlabs_agent_id) : null;
}

/** Contesta con una nota de voz; si no se puede (sin voz, TTS o WAHA sin envío de audio), manda el texto. */
async function sendVoiceReply(conv: ChannelConversation, text: string, requestedVoice: boolean): Promise<void> {
  const hasLink = /https?:\/\//.test(text);
  // El paciente tiene el enlace incluso si después falla la nota de voz.
  if (hasLink) await sendChatText(conv.chat_id, text);
  try {
    const voiceId = await replyVoiceId(conv.clinic_id);
    if (!voiceId) throw new Error("no hay voz configurada");
    const spoken = text.replace(/[*_~`]/g, "").replace(/https?:\/\/\S+/g, "el enlace del mensaje escrito");
    const audio = await textToSpeech(spoken, voiceId);
    if (!(await chatIsActive(conv.chat_id, conv.channel_revision))) throw new ChannelPausedError();
    await sendChatVoice(conv.chat_id, audio, { convert: !requestedVoice });
  } catch (e) {
    if (e instanceof ChannelPausedError) throw e;
    console.error("No se pudo mandar la nota de voz; se entrega el texto", e instanceof Error ? e.message : e);
    if (!hasLink) await sendChatText(conv.chat_id, text);
  }
}

/**
 * Deja la conversación en el panel (Conversaciones) mientras ocurre. Si después
 * llega el webhook post-conversación, ese la completa con resumen y resultado.
 */
async function savePanelConversation(conv: ChannelConversation, ended: boolean): Promise<void> {
  if (!conv.elevenlabs_conversation_id) return;
  const temporaryAccess = await readAppointmentAccess({
    clinicId: conv.clinic_id, patientPhone: conv.phone, conversationId: conv.elevenlabs_conversation_id,
  });
  const patient = temporaryAccess ? null : await findPatientByPhone(conv.clinic_id, conv.phone);
  const started = new Date(conv.created_at).getTime();
  const transcript = conv.transcript.map((t) => ({
    role: t.role,
    message: t.message,
    time_in_call_secs: Math.max(0, Math.round((new Date(t.at).getTime() - started) / 1000)),
  }));
  const direction = conv.campaign_id || (conv.context && conv.context !== INBOUND_CONTEXT) ? "saliente" : "entrante";
  const row = {
    clinic_id: conv.clinic_id,
    patient_id: patient?.id ?? null,
    campaign_id: temporaryAccess ? null : conv.campaign_id,
    elevenlabs_conversation_id: conv.elevenlabs_conversation_id,
    channel: channelForChat(conv.chat_id),
    direction,
    started_at: conv.created_at,
    status: ended ? "done" : "in-progress",
    transcript: json(transcript),
  };
  await sql`
    insert into conversations ${sql(row)}
    on conflict (elevenlabs_conversation_id) do update set
      patient_id = case when ${Boolean(temporaryAccess)} then null else coalesce(conversations.patient_id, excluded.patient_id) end,
      campaign_id = case when ${Boolean(temporaryAccess)} then null else conversations.campaign_id end,
      status = excluded.status,
      transcript = excluded.transcript
    where conversations.summary is null`;

  if (patient) await sql`update patients set last_contact_at = now() where id = ${patient.id}`;
  if (conv.campaign_id && patient) {
    await updateCampaignRecipient(conv.campaign_id, patient.id, { agent_id: "", conversation_id: conv.elevenlabs_conversation_id, transcript });
  }
  if (ended) {
    await notifyN8n("conversacion.finalizada", {
      clinic_id: conv.clinic_id,
      conversation_id: conv.elevenlabs_conversation_id,
      channel: channelForChat(conv.chat_id),
      patient: patient ? { id: patient.id, name: patient.full_name, phone: patient.phone } : null,
      summary: null,
      intent: null,
      outcome: null,
      satisfaction: null,
    });
  }
}
