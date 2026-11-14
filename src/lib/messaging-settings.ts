import "server-only";
import { sql } from "./db";
import { isWhatsappChatId } from "./phone";
import { currentWahaConnection } from "./waha-connections";

export type MessagingChannel = "pausado" | "whatsapp";
export type MessagingSettings = {
  active_channel: MessagingChannel; revision: number;
  /** Demos nuevas por persona por día; null = sin límite. */
  demo_daily_limit: number | null;
};

/** Sin caché: cada entrada y cada envío consulta el selector. Un fallo cierra el canal. */
export async function messagingSettings(): Promise<MessagingSettings> {
  const [row] = await sql<MessagingSettings[]>`select active_channel, revision, demo_daily_limit from messaging_settings where id`;
  return row ?? { active_channel: "pausado", revision: 0, demo_daily_limit: null };
}

export class ChannelPausedError extends Error {
  constructor() { super("Este canal está pausado en Configuración."); }
}

export async function requireActiveWhatsapp(): Promise<MessagingSettings> {
  const own = currentWahaConnection();
  if (own) {
    if (!own.enabled) throw new ChannelPausedError();
    return { active_channel: "whatsapp", revision: own.revision, demo_daily_limit: null };
  }
  const settings = await messagingSettings();
  if (settings.active_channel !== "whatsapp") throw new ChannelPausedError();
  return settings;
}

export async function chatIsActive(chatId: string, revision?: number): Promise<boolean> {
  if (!isWhatsappChatId(chatId)) return false;
  const own = currentWahaConnection();
  if (own) return own.enabled && (revision === undefined || revision === own.revision);
  const settings = await messagingSettings();
  return settings.active_channel === "whatsapp" && (revision === undefined || revision === settings.revision);
}

/** Cambiar de canal termina las demos previas y descarta sus respuestas pendientes. */
export async function selectMessagingChannel(channel: MessagingChannel): Promise<void> {
  await sql.begin(async (tx) => {
    const [previous] = await tx<MessagingSettings[]>`select * from messaging_settings where id for update`;
    if (previous?.active_channel === channel) return;
    await tx`update messaging_settings set active_channel = ${channel}, revision = revision + 1, updated_at = now() where id`;
    await tx`update channel_conversations set closed_at = now() where closed_at is null and waha_connection_id is null`;
    // Las demos del navegador no dependen del canal de mensajería.
    await tx`update demo_sessions set status = 'terminada', updated_at = now() where status not in ('terminada', 'error') and chat_id not like 'web:%'`;
  });
}

/** Límite de demos por persona por día: null o 0 lo quita. */
export async function setDemoDailyLimit(limit: number | null): Promise<void> {
  await sql`update messaging_settings set demo_daily_limit = ${limit && limit > 0 ? Math.min(1000, Math.round(limit)) : null}, updated_at = now() where id`;
}
