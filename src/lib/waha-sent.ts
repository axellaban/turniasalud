import "server-only";
import { createHash } from "node:crypto";
import { sql } from "./db";

// Marcas de lo que manda Turnia por WAHA, para reconocerlo cuando WAHA lo avisa como mensaje propio
// (ver waha-own.ts). Solo depende de la base: lo usa waha.ts al mandar.

export type OwnMessage = { id: string; chatId: string; text: string; hasMedia: boolean; source: "api" | "app" | null };

const textKey = (chatId: string, text: string) => `wa-out-txt:${chatId}:${createHash("sha256").update(text.trim()).digest("hex").slice(0, 32)}`;

async function note(key: string): Promise<void> {
  try {
    await sql`insert into channel_events (key) values (${key}) on conflict do nothing`;
    // De vez en cuando se borran las marcas viejas: solo sirven para los minutos siguientes al envío.
    if (Math.random() < 0.01) await sql`delete from channel_events where key like 'wa-out%' and created_at < now() - interval '14 days'`;
  } catch (e) {
    // Una marca que no se guardó nunca frena un envío: a lo sumo, una pausa automática de más.
    console.error("WAHA: no se pudo anotar un envío de Turnia", e instanceof Error ? e.message : e);
  }
}

/** Antes de mandar un texto: así, cuando WAHA lo avise como propio, se sabe que lo mandó Turnia. */
export const noteOutgoingText = (chatId: string, text: string) => (text.trim() ? note(textKey(chatId, text)) : Promise.resolve());
/** Después de mandar: el id que devolvió WAHA (sirve si el texto cambió en el camino). */
export const noteOutgoingId = (id: string | undefined) => (id ? note(`wa-out:${id}`) : Promise.resolve());
/** Antes de mandar una nota de voz (no tiene texto para comparar). */
export const noteOutgoingVoice = (chatId: string) => note(`wa-out-voice:${chatId}:${Date.now()}`);

/** ¿Este mensaje propio lo mandó Turnia? */
export async function isTurniaSend(msg: OwnMessage): Promise<boolean> {
  const keys = [`wa-out:${msg.id}`, ...(msg.text ? [textKey(msg.chatId, msg.text)] : [])];
  const [hit] = await sql`select 1 from channel_events where key = any(${keys}) limit 1`;
  if (hit) return true;
  if (msg.hasMedia && !msg.text) {
    const [voice] = await sql`
      select 1 from channel_events where key like ${`wa-out-voice:${msg.chatId}:%`} and created_at > now() - interval '3 minutes' limit 1`;
    if (voice) return true;
  }
  return false;
}

