import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { requireActiveChannel } from "./messaging-settings";

// WAHA (WhatsApp HTTP API): WhatsApp Web con un chip común, en el VPS del
// dueño. Es una API no oficial: el número puede quedar bloqueado si se mandan
// mensajes masivos. Docs: https://waha.devlike.pro/docs/how-to/events/

const HMAC_ALGORITHMS = new Set(["sha512", "sha256"]);

/**
 * Verifica el webhook firmado de WAHA. Headers:
 * X-Webhook-Hmac = hex(HMAC(clave, cuerpo crudo)) y X-Webhook-Hmac-Algorithm = sha512.
 */
export function verifyWahaHmac(rawBody: string, signature: string | null, algorithm: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const alg = (algorithm || "sha512").toLowerCase();
  if (!HMAC_ALGORITHMS.has(alg)) return false;
  const expected = createHmac(alg, secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature.trim().toLowerCase());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WahaEvent = {
  event?: string;
  session?: string;
  payload?: WahaMessagePayload;
};

export type WahaMessagePayload = {
  id?: string;
  from?: string;
  to?: string;
  fromMe?: boolean;
  body?: string | null;
  hasMedia?: boolean;
  media?: { url?: string | null; mimetype?: string | null; filename?: string | null } | null;
  participant?: string | null;
  _data?: Record<string, unknown>;
};

export type ParsedMessage =
  | { kind: "ignore"; reason: string }
  | {
      kind: "message";
      id: string;
      /** Chat al que hay que responder (549…@c.us o …@lid). */
      chatId: string;
      /** Teléfono si ya se conoce por el chat; null si el chat es un @lid sin teléfono a la vista. */
      phone: string | null;
      text: string;
      audio: { url: string | null; mimetype: string } | null;
      /** Imagen, documento, video o sticker: por este canal el agente no los puede ver. */
      otherMedia: boolean;
    };

/** Teléfono (solo dígitos) de un ID de WhatsApp "549…@c.us" o "549…@s.whatsapp.net". */
export function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== "string") return null;
  const m = /^(\d{6,15})(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(jid.trim());
  return m ? m[1] : null;
}

/** Algunos motores mandan el teléfono real junto al @lid en sus datos internos. */
function phoneFromEngineData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const key = (data.key ?? {}) as Record<string, unknown>;
  const info = (data.Info ?? {}) as Record<string, unknown>;
  for (const candidate of [key.remoteJidAlt, key.senderPn, info.SenderAlt, info.RecipientAlt, data.senderPn]) {
    const phone = phoneFromJid(candidate);
    if (phone) return phone;
  }
  return null;
}

/** Decide qué hacer con un evento de WAHA. Puro: no llama a nadie. */
export function parseWahaEvent(event: WahaEvent, expectedSession?: string): ParsedMessage {
  if (event.event !== "message") return { kind: "ignore", reason: `evento ${event.event ?? "desconocido"}` };
  if (expectedSession && event.session && event.session !== expectedSession) return { kind: "ignore", reason: "otra sesión" };
  const p = event.payload;
  if (!p?.id || !p.from) return { kind: "ignore", reason: "sin id o remitente" };
  if (p.fromMe) return { kind: "ignore", reason: "mensaje propio" };
  const from = p.from;
  if (from === "status@broadcast" || from.endsWith("@broadcast")) return { kind: "ignore", reason: "estado" };
  if (from.endsWith("@g.us")) return { kind: "ignore", reason: "grupo" };
  if (from.endsWith("@newsletter")) return { kind: "ignore", reason: "canal" };
  if (!from.endsWith("@c.us") && !from.endsWith("@lid") && !from.endsWith("@s.whatsapp.net")) {
    return { kind: "ignore", reason: "chat desconocido" };
  }

  const mimetype = p.media?.mimetype ?? "";
  const isAudio = Boolean(p.hasMedia) && /^audio\//.test(mimetype);
  const text = (p.body ?? "").trim();
  const otherMedia = Boolean(p.hasMedia) && !isAudio;
  if (!text && !isAudio && !otherMedia) return { kind: "ignore", reason: "mensaje vacío" };

  const chatId = from.endsWith("@s.whatsapp.net") ? from.replace("@s.whatsapp.net", "@c.us") : from;
  return {
    kind: "message",
    id: p.id,
    chatId,
    phone: phoneFromJid(from) ?? phoneFromEngineData(p._data),
    text,
    audio: isAudio ? { url: p.media?.url ?? null, mimetype } : null,
    otherMedia,
  };
}

/** chatId de WAHA para un teléfono guardado en Turnia (549…). */
export const chatIdForPhone = (phone: string) => `${phone}@c.us`;

async function waha(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${env.wahaUrl()}${path}`, {
    ...init,
    headers: { "X-Api-Key": env.wahaApiKey(), Accept: "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`WAHA ${init.method ?? "GET"} ${path} → ${res.status}${text ? `: ${text}` : ""}`);
  }
  return res;
}

export async function wahaSendText(chatId: string, text: string): Promise<{ id?: string }> {
  await requireActiveChannel("whatsapp");
  const res = await waha("/api/sendText", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: env.wahaSession(), chatId, text }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string | { _serialized?: string } };
  return { id: typeof body.id === "string" ? body.id : body.id?._serialized };
}

/** Busca el teléfono de un chat @lid (WhatsApp oculta el número en algunos chats). */
export async function wahaPhoneForLid(lid: string): Promise<string | null> {
  try {
    const res = await waha(`/api/${encodeURIComponent(env.wahaSession())}/lids/${encodeURIComponent(lid)}`);
    const body = (await res.json()) as { pn?: string | null };
    return phoneFromJid(body.pn);
  } catch (e) {
    console.error("WAHA: no se pudo resolver el @lid", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Baja el archivo de un mensaje (audios). WAHA Core puede no descargar media:
 * en ese caso media.url llega vacío y devolvemos null.
 */
export async function wahaDownloadMedia(url: string | null): Promise<Blob | null> {
  if (!url) return null;
  try {
    // La URL apunta al mismo WAHA; si viene con localhost la pasamos a la URL pública.
    const media = new URL(url);
    const base = new URL(env.wahaUrl());
    if (media.host !== base.host) {
      media.protocol = base.protocol;
      media.host = base.host;
    }
    const res = await waha(media.pathname + media.search);
    return await res.blob();
  } catch (e) {
    console.error("WAHA: no se pudo bajar el audio", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Nota de voz. Con convert: true WAHA la deja en el formato exacto de WhatsApp (puede requerir WAHA Plus). */
export async function wahaSendVoice(chatId: string, audio: Buffer): Promise<void> {
  await requireActiveChannel("whatsapp");
  await waha("/api/sendVoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session: env.wahaSession(),
      chatId,
      file: { mimetype: "audio/ogg; codecs=opus", filename: "respuesta.ogg", data: audio.toString("base64") },
      convert: true,
    }),
  });
}

let ownNumber: { value: string | null; at: number } | null = null;

/**
 * Número del chip conectado a la sesión de WAHA (solo dígitos, ej. 5491122223333).
 * Se guarda 10 minutos; si WAHA no responde, se reintenta al minuto.
 */
export async function wahaOwnNumber(): Promise<string | null> {
  const ttl = ownNumber?.value ? 10 * 60_000 : 60_000;
  if (ownNumber && Date.now() - ownNumber.at < ttl) return ownNumber.value;
  let value: string | null = null;
  try {
    const res = await waha(`/api/sessions/${encodeURIComponent(env.wahaSession())}`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { status?: string; me?: { id?: string } | null };
    value = body.status === "WORKING" || body.status === undefined ? phoneFromJid(body.me?.id) : null;
  } catch (e) {
    console.error("WAHA: no se pudo leer el número de la sesión", e instanceof Error ? e.message : e);
  }
  ownNumber = { value, at: Date.now() };
  return value;
}
