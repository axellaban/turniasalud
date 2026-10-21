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
    throw new ElevenLabsError(`ElevenLabs ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 500)}`, res.status, body);
  }
  return body as T;
}

/** Token para conversaciones WebRTC desde el navegador (demo web). */
export async function getConversationToken(agentId: string): Promise<string> {
  const body = await elevenlabs<{ token: string }>(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`);
  return body.token;
}

/** URL firmada para conversaciones por WebSocket (modo chat de la demo web). */
export async function getSignedUrl(agentId: string): Promise<string> {
  const body = await elevenlabs<{ signed_url: string }>(
    `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
  );
  return body.signed_url;
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
