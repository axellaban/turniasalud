import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { requireActiveChannel } from "./messaging-settings";

export const TELEGRAM_BOT_USERNAME = "TurnIA_salud_bot";
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.AGENT_TOOLS_SECRET && process.env.ELEVENLABS_CHANNEL_URL && process.env.ELEVENLABS_CHANNEL_SECRET && process.env.ELEVENLABS_CHANNEL_SIGNING_SECRET);
}

/** Se deriva un secreto exclusivo: el secreto de herramientas nunca sale a Telegram. */
export function telegramWebhookSecret(): string {
  return createHmac("sha256", env.agentToolsSecret()).update("turnia-telegram-webhook-v1").digest("hex");
}

export function verifyTelegramSecret(value: string | null): boolean {
  if (!value || !telegramConfigured()) return false;
  const expected = Buffer.from(telegramWebhookSecret());
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function telegram<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
  // Telegram exige el token en su ruta. Nunca incluir URL, token ni respuesta cruda en errores/logs.
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken()}/${method}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(25000),
      ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch { throw new Error(`Telegram ${method}: no se pudo conectar.`); }
  const data = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; error_code?: number };
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method}: error ${data.error_code ?? response.status}.`);
  return data.result as T;
}

export async function connectTelegram(): Promise<void> {
  const me = await telegram<{ username?: string }>("getMe", {});
  if (me.username?.toLowerCase() !== TELEGRAM_BOT_USERNAME.toLowerCase()) throw new Error(`El token no pertenece a @${TELEGRAM_BOT_USERNAME}.`);
  const url = `${env.appUrl().replace(/\/$/, "")}/api/telegram/webhook`;
  if (!url.startsWith("https://")) throw new Error("Telegram requiere APP_URL con HTTPS.");
  const previous = await telegram<{ url: string }>("getWebhookInfo", {});
  if (previous.url && previous.url !== url) throw new Error("Este bot ya tiene otro webhook. No se cambió: primero confirmá que el bot esté dedicado a Turnia.");
  await telegram("setWebhook", { url, secret_token: telegramWebhookSecret(), allowed_updates: ["message"] });
  const saved = await telegram<{ url: string }>("getWebhookInfo", {});
  if (saved.url !== url) throw new Error("Telegram no confirmó el webhook de Turnia.");
}

function numericChat(chatId: string): string {
  if (!/^telegram:[1-9]\d{0,15}$/.test(chatId)) throw new Error("Chat privado de Telegram inválido.");
  return chatId.slice("telegram:".length);
}

export async function telegramSendText(chatId: string, text: string): Promise<void> {
  // Sin parse_mode: ni el texto de la clínica ni el del agente se interpreta como HTML.
  for (let at = 0; at < text.length; at += 4000) {
    await requireActiveChannel("telegram");
    await telegram("sendMessage", { chat_id: numericChat(chatId), text: text.slice(at, at + 4000).replace(/\*([^*\n]+)\*/g, "$1") });
  }
}

export async function telegramSendVoice(chatId: string, audio: Buffer): Promise<void> {
  await requireActiveChannel("telegram");
  const form = new FormData();
  form.set("chat_id", numericChat(chatId));
  form.set("voice", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), "respuesta.ogg");
  await telegram("sendVoice", form);
}

export async function telegramDownloadAudio(fileId: string): Promise<Blob> {
  return telegramDownloadFile(fileId, MAX_AUDIO_BYTES, "audio/ogg");
}

/** Baja un archivo que mandó el usuario (audio, foto o PDF), con tope de tamaño. */
export async function telegramDownloadFile(fileId: string, maxBytes: number, type: string): Promise<Blob> {
  await requireActiveChannel("telegram");
  const file = await telegram<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!file.file_path || !/^[a-zA-Z0-9_./-]+$/.test(file.file_path) || file.file_path.includes("..") || (file.file_size ?? 0) > maxBytes) throw new Error("Archivo de Telegram inválido o demasiado grande.");
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/file/bot${env.telegramBotToken()}/${file.file_path}`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25000) });
  } catch { throw new Error("No se pudo descargar el archivo de Telegram."); }
  if (!response.ok || Number(response.headers.get("content-length")) > maxBytes || !response.body) throw new Error("No se pudo descargar el archivo de Telegram.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("El archivo es demasiado grande.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new Blob(chunks.map((chunk) => new Uint8Array(chunk)), { type });
}
