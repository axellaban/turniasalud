import "server-only";
import { sql, type Sql, type TransactionSql } from "./db";
import { env } from "./env";
import { findPatientByPhone } from "./clinic";
import { notifyN8n } from "./n8n";
import { AXEL_WHATSAPP } from "./sales/contacto-axel";
import { formatDateTime } from "./time";
import type { Clinic } from "./types";
import { chatIdForPhone, wahaSendText } from "./waha";
import { withGeneralWaha } from "./waha-connections";
import {
  BOT_DETAIL, CHAT_LIMITS, CLINIC_FUSE, PAUSE_REPLY, botSignal, clipIncoming, type ChatLine,
} from "./chat-limits";

// Límites de Sofi por chat (los valores y las reglas están en chat-limits.ts). Todo se cuenta por
// clínica y número: un bot que se pone a charlar con una clínica no afecta a las demás.

type Db = Sql | TransactionSql;
export type MuteReason = "bot" | "vendedor" | "exceso";
export type ChatMute = { phone: string; until: string; reason: MuteReason; detail: string | null; created_at: string };

/** El número está en silencio: Sofi no le contesta (ni se transcriben sus audios ni se leen sus fotos). */
export async function isMuted(clinicId: string, phone: string, db: Db = sql): Promise<boolean> {
  const [row] = await db`select 1 from chat_mutes where clinic_id = ${clinicId} and phone = ${phone} and until > now()`;
  return Boolean(row);
}

export async function muteNumber(clinicId: string, phone: string, reason: MuteReason, detail: string, hours: number, db: Db = sql): Promise<void> {
  await db`
    insert into chat_mutes (clinic_id, phone, until, reason, detail)
    values (${clinicId}, ${phone}, now() + make_interval(hours => ${hours}), ${reason}, ${detail})
    on conflict (clinic_id, phone) do update set
      until = greatest(chat_mutes.until, excluded.until), reason = excluded.reason, detail = excluded.detail, created_at = now()`;
}

/** Panel → «Reactivar»: Sofi le vuelve a contestar ya. */
export async function unmuteNumber(clinicId: string, phone: string): Promise<void> {
  await sql`delete from chat_mutes where clinic_id = ${clinicId} and phone = ${phone}`;
}

export async function activeMutes(clinicId: string): Promise<ChatMute[]> {
  return sql<ChatMute[]>`
    select phone, until, reason, detail, created_at from chat_mutes
    where clinic_id = ${clinicId} and until > now() order by created_at desc limit 50`;
}

/** Anota un mensaje o un archivo del número. De paso, cada tanto borra lo que ya no cuenta para ningún tope. */
async function recordUsage(db: Db, clinicId: string, phone: string, kind: "mensaje" | "documento"): Promise<void> {
  await db`insert into chat_usage (clinic_id, phone, kind) values (${clinicId}, ${phone}, ${kind})`;
  if (Math.random() < 0.01) await db`delete from chat_usage where created_at < now() - interval '3 days'`;
}

/** ¿Puede Sofi leer otra foto o PDF de este número hoy? Si puede, la cuenta. */
export async function claimDocumentRead(clinicId: string, phone: string): Promise<boolean> {
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from chat_usage
    where clinic_id = ${clinicId} and phone = ${phone} and kind = 'documento' and created_at > now() - interval '24 hours'`;
  if (count >= CHAT_LIMITS.dailyDocuments) return false;
  await recordUsage(sql, clinicId, phone, "documento");
  return true;
}

export type GuardResult =
  | { ok: true; text: string }
  /** silenciado: ya estaba en silencio; bot: se acaba de detectar; exceso: se pasó de mensajes (se pausa y se avisa). */
  | { ok: false; reason: "silenciado" | "bot" | "exceso" };

/**
 * Antes de pasarle un mensaje a Sofi. Va dentro de la transacción de forwardToAgent (con el
 * candado del número), así dos mensajes seguidos no se saltean los topes. El equipo del
 * consultorio no tiene topes: solo se cuenta su mensaje para el fusible de la clínica.
 */
export async function guardIncoming(
  db: Db,
  clinic: Pick<Clinic, "id">,
  input: { phone: string; text: string },
  lines: ChatLine[],
  opts: { staff: boolean },
): Promise<GuardResult> {
  if (!opts.staff) {
    if (await isMuted(clinic.id, input.phone, db)) return { ok: false, reason: "silenciado" };
    const signal = botSignal(lines, input.text);
    if (signal) {
      await muteNumber(clinic.id, input.phone, "bot", BOT_DETAIL[signal], CHAT_LIMITS.muteDays * 24, db);
      logLimit("bot", clinic.id, { senal: signal });
      return { ok: false, reason: "bot" };
    }
  }
  await recordUsage(db, clinic.id, input.phone, "mensaje");
  if (!opts.staff) {
    const [counts] = await db<{ burst: number; daily: number }[]>`
      select count(*) filter (where created_at > now() - make_interval(mins => ${CHAT_LIMITS.burst.minutes}))::int as burst,
             count(*)::int as daily
      from chat_usage
      where clinic_id = ${clinic.id} and phone = ${input.phone} and kind = 'mensaje' and created_at > now() - interval '24 hours'`;
    if (counts.burst > CHAT_LIMITS.burst.messages || counts.daily > CHAT_LIMITS.daily) {
      const detail = counts.burst > CHAT_LIMITS.burst.messages
        ? `Escribió más de ${CHAT_LIMITS.burst.messages} mensajes en ${CHAT_LIMITS.burst.minutes} minutos.`
        : `Escribió más de ${CHAT_LIMITS.daily} mensajes en el día.`;
      await muteNumber(clinic.id, input.phone, "exceso", detail, CHAT_LIMITS.pauseHours, db);
      logLimit("exceso", clinic.id, counts);
      return { ok: false, reason: "exceso" };
    }
  }
  return { ok: true, text: clipIncoming(input.text) };
}

/**
 * Sofi se pausó con un número por exceso de mensajes: se lo dice una sola vez (texto fijo, sin
 * gastar en el agente) y le deja una tarea a recepción para que lo siga una persona.
 */
export async function announcePause(clinic: Clinic, phone: string, chatId: string, send: (chatId: string, text: string) => Promise<unknown>): Promise<void> {
  await send(chatId, PAUSE_REPLY).catch((e) => console.error("Límites: no se pudo avisar la pausa", e instanceof Error ? e.message : e));
  const patient = await findPatientByPhone(clinic.id, phone).catch(() => null);
  const until = new Date(Date.now() + CHAT_LIMITS.pauseHours * 3600_000);
  const who = patient?.full_name ?? `+${phone}`;
  const [task] = await sql`
    insert into tasks ${sql({
      clinic_id: clinic.id,
      patient_id: patient?.id ?? null,
      type: "derivacion_humana",
      priority: "normal",
      title: `Seguir el chat con ${who}: ${clinic.agent_name || "Sofi"} se pausó por exceso de mensajes`,
      details:
        `Escribió más de ${CHAT_LIMITS.burst.messages} mensajes en ${CHAT_LIMITS.burst.minutes} minutos (o más de ${CHAT_LIMITS.daily} en el día). ` +
        `${clinic.agent_name || "Sofi"} no le contesta hasta el ${formatDateTime(until, clinic.timezone)}. Si es un paciente, escribile o llamalo. ` +
        "Para que vuelva a contestarle antes, tocá «Reactivar» en Conversaciones → Números en pausa.",
    })}
    returning *`;
  await notifyN8n("tarea.creada", { clinic_id: clinic.id, task, panel_url: `${env.appUrl().replace(/\/$/, "")}/panel/tareas` });
}

function logLimit(tipo: string, clinicId: string, extra: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ evento: "limite_chat", tipo, clinica: clinicId, ...extra }));
}

// ---------------------------------------------------------------------------
// Fusible por clínica: un día con mucho más uso que lo normal le llega a Axel por WhatsApp.
// No corta a nadie: avisa una sola vez por día y por tipo.
// ---------------------------------------------------------------------------

/** Le escribe a Axel desde la línea de Turnia (nunca desde la línea de una clínica). */
export async function notifyAxel(text: string): Promise<boolean> {
  try {
    await withGeneralWaha(() => wahaSendText(chatIdForPhone(AXEL_WHATSAPP), text));
    return true;
  } catch (e) {
    console.error("No se pudo avisar a Axel por WhatsApp", e instanceof Error ? e.message : e);
    return false;
  }
}

const dayStart = (timezone: string) => sql`(date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone})`;

async function blowFuse(clinic: Clinic, kind: "chat" | "llamadas", amount: number): Promise<void> {
  const [claimed] = await sql`
    insert into channel_events (key)
    values (${`fusible:${kind}:${clinic.id}:${new Date().toLocaleDateString("en-CA", { timeZone: clinic.timezone })}`})
    on conflict do nothing returning key`;
  if (!claimed) return;
  const what = kind === "chat"
    ? `${amount} mensajes de chat (el aviso es a partir de ${CLINIC_FUSE.chatMessages})`
    : `${amount} minutos de llamadas (el aviso es a partir de ${CLINIC_FUSE.callMinutes})`;
  console.warn(JSON.stringify({ evento: "fusible_clinica", tipo: kind, clinica: clinic.id, cantidad: amount }));
  await notifyN8n("clinica.fusible", { clinic_id: clinic.id, tipo: kind, cantidad: amount });
  await notifyAxel(
    `⚠️ Turnia: ${clinic.name} lleva hoy ${what}. ${clinic.agent_name || "Sofi"} sigue atendiendo; ` +
      `revisá Conversaciones por si hay un bot o alguien abusando: ${env.appUrl().replace(/\/$/, "")}/panel/conversaciones`,
  );
}

/** Después de cada mensaje que pasa a Sofi. */
export async function checkChatFuse(clinic: Clinic): Promise<void> {
  if (clinic.is_demo) return;
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from chat_usage
    where clinic_id = ${clinic.id} and kind = 'mensaje' and created_at >= ${dayStart(clinic.timezone)}`;
  if (count >= CLINIC_FUSE.chatMessages) await blowFuse(clinic, "chat", count);
}

/** Después de guardar cada llamada. */
export async function checkCallFuse(clinic: Clinic): Promise<void> {
  if (clinic.is_demo) return;
  const [{ secs }] = await sql<{ secs: number }[]>`
    select coalesce(sum(duration_secs), 0)::int as secs from conversations
    where clinic_id = ${clinic.id} and channel = 'telefono' and started_at >= ${dayStart(clinic.timezone)}`;
  const minutes = Math.round(secs / 60);
  if (minutes >= CLINIC_FUSE.callMinutes) await blowFuse(clinic, "llamadas", minutes);
}
