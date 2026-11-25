import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

const API = "https://api.elevenlabs.io";

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

export async function elevenlabs<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "xi-api-key": env.elevenLabsApiKey(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no JSON: la dejamos como texto
  }
  if (!res.ok) {
    // Un 422 puede incluir el cuerpo enviado, con secretos de los webhooks.
    // No los exponemos en el panel ni en los logs del servidor.
    let safeText = text;
    for (const [name, value] of Object.entries(process.env)) {
      if (value && /(?:KEY|SECRET|PASSWORD)$/.test(name)) safeText = safeText.replaceAll(value, "[secreto]");
    }
    let safeBody: unknown = safeText;
    try { safeBody = JSON.parse(safeText); } catch { /* respuesta de error no JSON */ }
    throw new ElevenLabsError(`ElevenLabs ${init.method ?? "GET"} ${path} → ${res.status}: ${safeText.slice(0, 500)}`, res.status, safeBody);
  }
  return body as T;
}

/** Token para conversaciones WebRTC desde el navegador (demo web). */
export async function getConversationToken(agentId: string): Promise<string> {
  const body = await elevenlabs<{ token: string }>(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`);
  return body.token;
}

type AgentSettings = {
  conversation_config?: { agent?: { prompt?: { llm?: string } } };
  platform_settings?: { overrides?: { conversation_config_override?: { agent?: { first_message?: boolean; prompt?: { llm?: boolean } } } } };
};

/**
 * LLM para una charla por voz con este agente. El agente general piensa con el LLM de chat
 * (WhatsApp); sus demos por voz piden el de voz, que contesta más rápido. Solo se pide si el
 * agente ya permite cambiar el LLM por charla (se activa con «Actualizar a Sofi»): si no,
 * ElevenLabs rechazaría la charla, y es mejor que siga con su LLM. Puro.
 */
export function voiceLlmOverride(agent: AgentSettings | null | undefined, voiceLlm: string): string | undefined {
  if (agent?.platform_settings?.overrides?.conversation_config_override?.agent?.prompt?.llm !== true) return undefined;
  return agent.conversation_config?.agent?.prompt?.llm === voiceLlm ? undefined : voiceLlm;
}

/** Lo que hay que mandarle a un agente para hablar por voz con él: su LLM de voz, si hace falta cambiarlo. */
export async function voiceLlmFor(agentId: string): Promise<string | undefined> {
  const agent = await elevenlabs<AgentSettings>(`/v1/convai/agents/${encodeURIComponent(agentId)}`).catch(() => null);
  return voiceLlmOverride(agent, env.agentVoiceLlm());
}

/** Token de una charla por voz en el navegador y, si hace falta, el LLM de voz para pedir al arrancar. */
export async function getVoiceCredential(agentId: string): Promise<{ token: string; llm?: string }> {
  const [token, llm] = await Promise.all([getConversationToken(agentId), voiceLlmFor(agentId)]);
  return llm ? { token, llm } : { token };
}

/** URL firmada para conversaciones por WebSocket (modo chat de la demo web). */
export async function getSignedUrl(agentId: string): Promise<string> {
  const body = await elevenlabs<{ signed_url: string }>(
    `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
  );
  return body.signed_url;
}

/**
 * Chat de la demo: URL firmada y si el agente deja arrancar sin su saludo. En el chat
 * el paciente escribe primero; sin saludo, el agente contesta una sola vez (saludo y
 * respuesta juntos) en lugar de dos mensajes seguidos. Hasta que se toca «Crear /
 * actualizar agente» ElevenLabs no lo permite y el chat sigue como antes.
 */
export async function getChatCredential(agentId: string): Promise<{ signedUrl: string; sinSaludo: boolean }> {
  const [signedUrl, agent] = await Promise.all([
    getSignedUrl(agentId),
    elevenlabs<{ platform_settings?: { overrides?: { conversation_config_override?: { agent?: { first_message?: boolean } } } } }>(
      `/v1/convai/agents/${encodeURIComponent(agentId)}`,
    ).catch(() => null),
  ]);
  return { signedUrl, sinSaludo: agent?.platform_settings?.overrides?.conversation_config_override?.agent?.first_message === true };
}

export type TemplateMessage = {
  phoneNumberId: string;
  userId: string;
  templateName: string;
  language: string;
  params: string[];
  agentId: string;
  dynamicVariables: Record<string, string>;
};

/** Envía un template aprobado por Meta e inicia una conversación de WhatsApp con el agente. */
export async function sendWhatsAppTemplate(msg: TemplateMessage): Promise<{ conversation_id?: string }> {
  return elevenlabs("/v1/convai/whatsapp/outbound-message", {
    method: "POST",
    body: JSON.stringify({
      whatsapp_phone_number_id: msg.phoneNumberId,
      whatsapp_user_id: msg.userId,
      template_name: msg.templateName,
      template_language_code: msg.language,
      template_params: msg.params.length
        ? [{ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) }]
        : [],
      agent_id: msg.agentId,
      conversation_initiation_client_data: { dynamic_variables: msg.dynamicVariables },
    }),
  });
}

/** Transcribe un audio de WhatsApp con Speech to Text (la clave necesita ese permiso). */
export async function transcribeAudio(audio: Blob, mimetype: string): Promise<string> {
  const extension = mimetype.includes("ogg") ? "ogg" : mimetype.split("/")[1]?.split(";")[0] || "bin";
  const form = new FormData();
  form.append("model_id", env.sttModel());
  form.append("language_code", "es");
  form.append("tag_audio_events", "false");
  form.append("file", audio, `audio.${extension}`);
  const res = await fetch(`${API}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": env.elevenLabsApiKey() },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new ElevenLabsError(`ElevenLabs POST /v1/speech-to-text → ${res.status}`, res.status, null);
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}

export type ChannelMessage = {
  messageId: string;
  text: string;
  userIdentifier: string;
  conversationId?: string | null;
  dynamicVariables: Record<string, string>;
};

/**
 * Manda el mensaje de un paciente al agente por el Custom Channel de ElevenLabs
 * (alpha). Responde 202 enseguida; la respuesta del agente llega después a
 * /api/elevenlabs/canal. user_message_id evita duplicados si se reintenta.
 */
export async function sendChannelMessage(msg: ChannelMessage): Promise<{ conversation_id: string }> {
  const res = await fetch(env.channelUrl(), {
    method: "POST",
    headers: { "X-Webhook-Secret": env.channelSecret(), "Content-Type": "application/json" },
    body: JSON.stringify({
      data: { type: "user_message", text: msg.text, user_identifier: msg.userIdentifier },
      user_message_id: msg.messageId,
      ...(msg.conversationId ? { conversation_id: msg.conversationId } : {}),
      dynamic_variables: msg.dynamicVariables,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new ElevenLabsError(`ElevenLabs Custom Channel → ${res.status}: ${text.slice(0, 300)}`, res.status, null);
  let body: { conversation_id?: string } = {};
  try {
    body = JSON.parse(text || "{}");
  } catch {
    // respuesta no JSON: la tratamos como error abajo
  }
  if (!body.conversation_id) throw new ElevenLabsError("ElevenLabs Custom Channel no devolvió conversation_id", res.status, null);
  return { conversation_id: body.conversation_id };
}

/**
 * Verifica la firma HMAC de los webhooks de ElevenLabs.
 * Header: "ElevenLabs-Signature: t=<unix>,v0=<hex sha256 de `${t}.${body}`>"
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signature = parts.find((p) => p.startsWith("v0="));
  if (!timestamp || !signature) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!/^\d+$/.test(timestamp) || !Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > 30 * 60 * 1000) return false;
  const expected = "v0=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Voz del agente (la que usa en las llamadas), para que los audios de WhatsApp suenen igual. */
export async function agentVoiceId(agentId: string): Promise<string | null> {
  const agent = await elevenlabs<{ conversation_config?: { tts?: { voice_id?: string } } }>(
    `/v1/convai/agents/${encodeURIComponent(agentId)}`,
  );
  return agent.conversation_config?.tts?.voice_id ?? null;
}

/** Nota de voz (Ogg Opus, el formato de WhatsApp) con Text to Speech. */
export async function textToSpeech(text: string, voiceId: string): Promise<Buffer> {
  const key = process.env.ELEVENLABS_TTS_API_KEY || env.elevenLabsApiKey();
  const res = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=opus_48000_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/ogg" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2", language_code: "es" }),
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new ElevenLabsError(`ElevenLabs POST /v1/text-to-speech → ${res.status}`, res.status, null);
  return Buffer.from(await res.arrayBuffer());
}

/** Llamada telefónica saliente del agente por el número de Twilio importado en ElevenLabs. */
export async function startPhoneCall(call: {
  agentId: string;
  phoneNumberId: string;
  toNumber: string;
  dynamicVariables: Record<string, string>;
  /** LLM de voz, si el agente piensa con otro (ver voiceLlmFor). */
  llm?: string;
}): Promise<{ conversation_id: string | null }> {
  const body = await elevenlabs<{ success?: boolean; message?: string; conversation_id?: string | null }>("/v1/convai/twilio/outbound-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: call.agentId,
      agent_phone_number_id: call.phoneNumberId,
      to_number: call.toNumber,
      // Grabación nativa en Twilio; record_voice de ElevenLabs es independiente.
      call_recording_enabled: true,
      conversation_initiation_client_data: {
        dynamic_variables: call.dynamicVariables,
        user_id: call.toNumber.replace(/^\+/, ""),
        ...(call.llm && { conversation_config_override: { agent: { prompt: { llm: call.llm } } } }),
      },
    }),
  });
  if (body.success === false) throw new ElevenLabsError(`No se pudo iniciar la llamada: ${body.message ?? "sin detalle"}`, 200, null);
  return { conversation_id: body.conversation_id ?? null };
}
