import "server-only";
import { sql } from "./db";
import { localDateKey, zonedParts, zonedTimeToUtc } from "./time";
import { wahaConnectionForClinic } from "./waha-connections";
import type { Clinic } from "./types";

// Límites de envío de Turnia Activa (valores confirmados el 24/11/2026). Son de la línea de WhatsApp,
// no de la campaña: el número del consultorio es uno solo y WhatsApp bloquea al que manda de más.

/** Mensajes de campaña por día y por línea WAHA (Sofi y los que manda el equipo desde la clínica). */
export const DAILY_LINE_CAP = 60;
/** Horario de envío de lo que sale solo (secuencias y automáticas para volver): lunes a viernes, de 9 a 20. */
export const SEND_WINDOW = { weekdays: [1, 2, 3, 4, 5], from: 9, to: 20 } as const;
/** Seguimiento sugerido: a los 5 días sin respuesta, hasta 2 mensajes por paciente. */
export const DEFAULT_FOLLOWUP_DAYS = 5;
export const DEFAULT_MAX_MESSAGES = 2;

export function inSendWindow(clinic: Pick<Clinic, "timezone">, now = new Date()): boolean {
  const p = zonedParts(now, clinic.timezone);
  return (SEND_WINDOW.weekdays as readonly number[]).includes(p.weekday) && p.hour >= SEND_WINDOW.from && p.hour < SEND_WINDOW.to;
}

/** La línea por la que sale lo de la clínica: su WAHA propio, el WAHA general o el WhatsApp oficial (sin tope). */
export function campaignLine(clinic: Pick<Clinic, "id" | "whatsapp_provider">): { id: string; capped: boolean } {
  const own = wahaConnectionForClinic(clinic.id);
  if (own) return { id: own.id, capped: true };
  if (clinic.whatsapp_provider === "waha") return { id: "general", capped: true };
  return { id: "meta", capped: false };
}

function startOfLocalDay(clinic: Pick<Clinic, "timezone">, now: Date): Date {
  const [y, m, d] = localDateKey(now, clinic.timezone).split("-").map(Number);
  return zonedTimeToUtc(y, m, d, 0, 0, clinic.timezone);
}

export type LineUsage = { line: string; capped: boolean; sent: number; cap: number; left: number };

/** Cuántos mensajes de campaña salieron hoy por la línea de la clínica y cuántos quedan. */
export async function lineUsage(clinic: Pick<Clinic, "id" | "whatsapp_provider" | "timezone">, now = new Date()): Promise<LineUsage> {
  const line = campaignLine(clinic);
  const [{ sent }] = await sql<Array<{ sent: number }>>`
    select count(*)::int as sent from campaign_messages where line = ${line.id} and sent_at >= ${startOfLocalDay(clinic, now)} and sent_at <= ${now}`;
  return { line: line.id, capped: line.capped, sent, cap: DAILY_LINE_CAP, left: line.capped ? Math.max(0, DAILY_LINE_CAP - sent) : Infinity };
}

/** Anota un mensaje de campaña que salió (para el tope y la cuenta del día). */
export async function recordCampaignMessage(
  clinic: Pick<Clinic, "id" | "whatsapp_provider">,
  msg: { campaignId: string; recipientId: string; step: number; manual?: boolean; at?: Date },
): Promise<void> {
  await sql`
    insert into campaign_messages ${sql({
      clinic_id: clinic.id,
      campaign_id: msg.campaignId,
      recipient_id: msg.recipientId,
      step: msg.step,
      line: campaignLine(clinic).id,
      manual: msg.manual ?? false,
      sent_at: msg.at ?? new Date(),
    })}`;
}
