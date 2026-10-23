import "server-only";
import { sql } from "./db";

export type MessagingChannel = "pausado" | "telegram" | "whatsapp";
export type MessagingSettings = {
  active_channel: MessagingChannel; revision: number; telegram_ready: boolean;
  /** Demos nuevas por persona por día; null = sin límite. */
  demo_daily_limit: number | null;
};

/** Sin caché: cada entrada y cada envío consulta el selector. Un fallo cierra el canal. */
export async function messagingSettings(): Promise<MessagingSettings> {
  const [row] = await sql<MessagingSettings[]>`select active_channel, revision, telegram_ready, demo_daily_limit from messaging_settings where id`;
  return row ?? { active_channel: "pausado", revision: 0, telegram_ready: false, demo_daily_limit: null };
}

export class ChannelPausedError extends Error {
  constructor() { super("Este canal está pausado en Configuración."); }
}

export function channelForChat(chatId: string): "telegram" | "whatsapp" {
  return chatId.startsWith("telegram:") ? "telegram" : "whatsapp";
}

export async function requireActiveChannel(channel: "telegram" | "whatsapp"): Promise<MessagingSettings> {
  const settings = await messagingSettings();
  if (settings.active_channel !== channel) throw new ChannelPausedError();
  return settings;
}

export async function chatIsActive(chatId: string, revision?: number): Promise<boolean> {
  const settings = await messagingSettings();
  return settings.active_channel === channelForChat(chatId) && (revision === undefined || revision === settings.revision);
}

/** Cambiar de canal termina las demos previas y descarta sus respuestas pendientes. */
export async function selectMessagingChannel(channel: MessagingChannel): Promise<void> {
  await sql.begin(async (tx) => {
    const [previous] = await tx<MessagingSettings[]>`select * from messaging_settings where id for update`;
    if (previous?.active_channel === channel) return;
    await tx`update messaging_settings set active_channel = ${channel}, revision = revision + 1, updated_at = now() where id`;
    await tx`update channel_conversations set closed_at = now() where closed_at is null`;
    await tx`update demo_sessions set status = 'terminada', updated_at = now() where status not in ('terminada', 'error')`;
  });
}

/** Límite de demos por persona por día: null o 0 lo quita. */
export async function setDemoDailyLimit(limit: number | null): Promise<void> {
  await sql`update messaging_settings set demo_daily_limit = ${limit && limit > 0 ? Math.min(1000, Math.round(limit)) : null}, updated_at = now() where id`;
}
