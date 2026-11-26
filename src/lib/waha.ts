import "server-only";
import { isWhatsappChatId } from "./phone";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { requireActiveWhatsapp } from "./messaging-settings";
import { currentWahaConnection } from "./waha-connections";
import { noteOutgoingId, noteOutgoingText, noteOutgoingVoice, type OwnMessage } from "./waha-sent";
import { typingMs } from "./whatsapp-style";

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
  timestamp?: number;
  me?: { id?: string };
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
  /** En los mensajes propios, versiones nuevas de WAHA dicen si salió por la API («api») o desde el celular («app»). */
  source?: string | null;
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
      /** `seconds`: la duración, si el motor de WAHA la informa (si no, se mide el archivo). */
      audio: { url: string | null; mimetype: string; seconds: number | null } | null;
      /** Imagen, documento, video o sticker. Las fotos y los PDF se leen con Claude; lo demás, el agente no lo ve. */
      otherMedia: boolean;
      /** El archivo de otherMedia (sin url si WAHA no lo descargó). */
      media: { url: string | null; mimetype: string } | null;
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

/** Duración de una nota de voz según el motor de WAHA (WEBJS: duration; NOWEB/GOWS: audioMessage.seconds). */
function audioSecondsFromEngineData(data: Record<string, unknown> | undefined): number | null {
  if (!data) return null;
  const message = (data.message ?? data.Message ?? {}) as Record<string, unknown>;
  const audio = (message.audioMessage ?? {}) as Record<string, unknown>;
  for (const candidate of [data.duration, audio.seconds]) {
    const n = typeof candidate === "string" ? Number(candidate) : candidate;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
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
  if (!isWhatsappChatId(from)) {
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
    audio: isAudio ? { url: p.media?.url ?? null, mimetype, seconds: audioSecondsFromEngineData(p._data) } : null,
    otherMedia,
    media: otherMedia ? { url: p.media?.url ?? null, mimetype } : null,
  };
}

/**
 * Un mensaje propio de la línea (fromMe), avisado por WAHA con `message.any`: puede ser de Turnia o
 * del equipo desde el celular. Solo chats de personas. Puro. Ver waha-own.ts.
 */
export function parseOwnMessage(event: WahaEvent): OwnMessage | null {
  if (event.event !== "message.any" && event.event !== "message") return null;
  const p = event.payload;
  if (!p?.id || !p.fromMe) return null;
  const to = p.to ?? "";
  if (!to || to.endsWith("@g.us") || to.endsWith("@broadcast") || to.endsWith("@newsletter") || !isWhatsappChatId(to)) return null;
  const chatId = to.endsWith("@s.whatsapp.net") ? to.replace("@s.whatsapp.net", "@c.us") : to;
  return {
    id: p.id,
    chatId,
    text: (p.body ?? "").trim(),
    hasMedia: Boolean(p.hasMedia),
    source: p.source === "api" || p.source === "app" ? p.source : null,
  };
}

/** chatId de WAHA para un teléfono guardado en Turnia (549…). */
export const chatIdForPhone = (phone: string) => `${phone}@c.us`;

async function waha(path: string, init: RequestInit = {}): Promise<Response> {
  const connection = currentWahaConnection();
  const res = await fetch(`${connection?.url.replace(/\/$/, "") ?? env.wahaUrl()}${path}`, {
    ...init,
    headers: { "X-Api-Key": connection?.apiKey ?? env.wahaApiKey(), Accept: "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`WAHA ${init.method ?? "GET"} ${path} → ${res.status}${text ? `: ${text}` : ""}`);
  }
  return res;
}

export async function wahaSendText(chatId: string, text: string, opts: { internal?: boolean } = {}): Promise<{ id?: string }> {
  if (!isWhatsappChatId(chatId)) throw new Error("El destinatario no es un chat de WhatsApp.");
  // Un aviso interno a Axel desde la línea de Turnia sale aunque la demo pública esté pausada: ese selector
  // apaga la demo, no los avisos del equipo. La línea de una clínica pausada no manda nada.
  if (!opts.internal || currentWahaConnection()) await requireActiveWhatsapp();
  // Se anota antes de mandar: WAHA puede avisar el mensaje propio antes de que vuelva esta respuesta.
  await noteOutgoingText(chatId, text);
  const res = await waha("/api/sendText", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: currentWahaConnection()?.session ?? env.wahaSession(), chatId, text }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string | { _serialized?: string } };
  const id = typeof body.id === "string" ? body.id : body.id?._serialized;
  await noteOutgoingId(id);
  return { id };
}

/** «Escribiendo…» en el chat del paciente. Es solo cortesía: si falla, no frena nada. */
export async function wahaTyping(chatId: string): Promise<void> {
  if (!isWhatsappChatId(chatId)) return;
  try {
    await waha("/api/startTyping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: currentWahaConnection()?.session ?? env.wahaSession(), chatId }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Sin «escribiendo…» el mensaje llega igual.
  }
}

/**
 * Un mensaje en burbujas, como lo manda una persona: entre una y otra, «escribiendo…» y una pausa
 * según el largo de la que sigue. En las pruebas no hay pausa.
 */
export async function wahaSendBubbles(chatId: string, bubbles: string[], { continuing = false }: { continuing?: boolean } = {}): Promise<void> {
  for (const [i, bubble] of bubbles.entries()) {
    // continuing: la primera burbuja ya salió, así que todas llevan su pausa.
    if (i > 0 || continuing) {
      await wahaTyping(chatId);
      if (!process.env.VITEST) await new Promise((resolve) => setTimeout(resolve, typingMs(bubble)));
    }
    await wahaSendText(chatId, bubble);
  }
}

/** Busca el teléfono de un chat @lid (WhatsApp oculta el número en algunos chats). */
export async function wahaPhoneForLid(lid: string): Promise<string | null> {
  try {
    const res = await waha(`/api/${encodeURIComponent(currentWahaConnection()?.session ?? env.wahaSession())}/lids/${encodeURIComponent(lid)}`);
    const body = (await res.json()) as { pn?: string | null };
    return phoneFromJid(body.pn);
  } catch (e) {
    console.error("WAHA: no se pudo resolver el @lid", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Baja el archivo de un mensaje (audios, fotos, PDF). WAHA Core puede no descargar media:
 * en ese caso media.url llega vacío y devolvemos null.
 */
export async function wahaDownloadMedia(url: string | null): Promise<Blob | null> {
  if (!url) return null;
  try {
    // La URL apunta al mismo WAHA; si viene con localhost la pasamos a la URL pública.
    const media = new URL(url);
    const base = new URL(currentWahaConnection()?.url ?? env.wahaUrl());
    if (media.host !== base.host) {
      media.protocol = base.protocol;
      media.host = base.host;
    }
    const res = await waha(media.pathname + media.search);
    return await res.blob();
  } catch (e) {
    console.error("WAHA: no se pudo bajar el archivo", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Nota de voz. Un archivo Ogg Opus listo se puede enviar sin conversión en WAHA Core. */
export async function wahaSendVoice(chatId: string, audio: Buffer, { convert = true }: { convert?: boolean } = {}): Promise<void> {
  if (!isWhatsappChatId(chatId)) throw new Error("El destinatario no es un chat de WhatsApp.");
  await requireActiveWhatsapp();
  await noteOutgoingVoice(chatId);
  await waha("/api/sendVoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session: currentWahaConnection()?.session ?? env.wahaSession(),
      chatId,
      file: { mimetype: "audio/ogg; codecs=opus", filename: "respuesta.ogg", data: audio.toString("base64") },
      convert,
    }),
  });
}

const ownNumbers = new Map<string, { value: string | null; at: number }>();

/**
 * Número del chip conectado a la sesión de WAHA (solo dígitos, ej. 5491122223333).
 * Se guarda 10 minutos; si WAHA no responde, se reintenta al minuto.
 */
export async function wahaOwnNumber(): Promise<string | null> {
  const connection = currentWahaConnection();
  const key = connection ? `${connection.id}:${connection.revision}` : "general";
  const ownNumber = ownNumbers.get(key);
  const ttl = ownNumber?.value ? 10 * 60_000 : 60_000;
  if (ownNumber && Date.now() - ownNumber.at < ttl) return ownNumber.value;
  let value: string | null = null;
  try {
    const res = await waha(`/api/sessions/${encodeURIComponent(connection?.session ?? env.wahaSession())}`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { status?: string; me?: { id?: string } | null };
    value = body.status === "WORKING" || body.status === undefined ? phoneFromJid(body.me?.id) : null;
  } catch (e) {
    console.error("WAHA: no se pudo leer el número de la sesión", e instanceof Error ? e.message : e);
  }
  ownNumbers.set(key, { value, at: Date.now() });
  return value;
}
