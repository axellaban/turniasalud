import "server-only";
import { sql } from "./db";
import { firstName } from "./campaigns";
import { inSendWindow, lineUsage, recordCampaignMessage } from "./campaign-limits";
import { pauseBetweenSends, sendPatientMessage, templateKeyFor, whatsappReadiness } from "./whatsapp";
import type { CampaignType, Clinic } from "./types";

// Secuencias de Turnia Activa: si el paciente no responde el primer mensaje de una campaña, Sofi le
// vuelve a escribir a los N días (paso 2), hasta el máximo de mensajes de la campaña. La secuencia se
// corta si responde, si saca turno por cualquier canal (Sofi, panel, teléfono o Smile Connect) o si
// pide la baja. Corre en la tarea de cada 10 minutos (/api/automations/calendario), solo en las
// clínicas con `sequences_enabled`, de lunes a viernes de 9 a 20 y dentro del tope diario de la línea.
// La llamada de Sofi como paso es a futuro: necesita autorización y no está implementada.

/** Seguimiento sugerido cuando el paso no tiene texto propio. */
export const DEFAULT_FOLLOWUP_TEXT = "Hola {nombre}, te escribo de nuevo por si se te pasó el mensaje. ¿Querés que te busque un turno?";
/** Seguimientos por clínica en cada corrida (la tarea corre cada 10 minutos y comparte el tiempo con otras). */
const PER_RUN = 10;
/** Un paso que venció hace más de esto (secuencias apagadas, fin de semana largo) ya no se manda. */
const STALE_DAYS = 4;

export function followupMessage(message: string | null, name: string | null | undefined, detail: string | null): string {
  const text = message?.trim() || DEFAULT_FOLLOWUP_TEXT;
  return text.replace(/\{\s*(nombre|detalle)\s*\}/gi, (_, key: string) => (key.toLowerCase() === "nombre" ? firstName(name) : detail ?? ""));
}

type DueRow = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_type: CampaignType;
  goal: string | null;
  template_name: string;
  template_language: string;
  max_messages: number;
  stop_on_reply: boolean;
  stop_on_booking: boolean;
  messages_sent: number;
  sent_at: string;
  last_message_at: string;
  next_step_at: string;
  detail: string | null;
  context: string | null;
  patient_id: string;
  full_name: string | null;
  phone: string | null;
  contact_opt_out: boolean;
  step_message: string | null;
  replied: boolean;
  booked: boolean;
  next_delay: number | null;
};

/** Por qué no se le escribe de nuevo (null = toca el seguimiento). */
export function stopReason(
  row: Pick<DueRow, "contact_opt_out" | "replied" | "booked" | "messages_sent" | "max_messages" | "phone"> & Partial<Pick<DueRow, "stop_on_reply" | "stop_on_booking">>,
): string | null {
  // La baja corta siempre; responder y sacar turno, salvo que la campaña diga lo contrario.
  if (row.contact_opt_out) return "Pidió la baja";
  if (row.replied && row.stop_on_reply !== false) return "Respondió";
  if (row.booked && row.stop_on_booking !== false) return "Sacó turno";
  if (row.messages_sent >= row.max_messages) return "Llegó al máximo de mensajes";
  if (!row.phone) return "No tiene un celular que sirva para WhatsApp";
  return null;
}

export type SequenceRun = { clinic_id: string; clinic: string; sent: number; stopped: number; failed: number; waiting: number; skipped?: string };

async function runClinicSequences(clinic: Clinic, now: Date): Promise<SequenceRun> {
  const run: SequenceRun = { clinic_id: clinic.id, clinic: clinic.name, sent: 0, stopped: 0, failed: 0, waiting: 0 };
  const stop = async (id: string, reason: string) => {
    await sql`update campaign_recipients set next_step_at = null, sequence_stopped = ${reason} where id = ${id}`;
    run.stopped++;
  };

  // Lo que venció hace demasiado (por ejemplo, mientras estaban apagadas) se cierra sin mandar.
  const stale = await sql`
    update campaign_recipients r set next_step_at = null, sequence_stopped = 'Venció sin enviarse'
    from campaigns c
    where c.id = r.campaign_id and c.clinic_id = ${clinic.id} and r.next_step_at < ${new Date(now.getTime() - STALE_DAYS * 86400_000)}
    returning r.id`;
  run.stopped += stale.length;

  if (!inSendWindow(clinic, now)) return { ...run, skipped: "Fuera del horario de envío (lunes a viernes, de 9 a 20)." };
  const problem = whatsappReadiness(clinic);
  if (problem) return { ...run, skipped: problem };
  const usage = await lineUsage(clinic, now);
  if (!usage.capped) return { ...run, skipped: "Los seguimientos salen solo por WAHA: por el WhatsApp oficial hace falta un template aprobado." };

  const due = await sql<DueRow[]>`
    select r.id, r.campaign_id, c.name as campaign_name, c.type as campaign_type, c.goal, c.template_name, c.template_language, c.max_messages, c.stop_on_reply, c.stop_on_booking,
      r.messages_sent, r.sent_at, r.last_message_at, r.next_step_at, r.detail, r.context,
      p.id as patient_id, p.full_name, p.phone, p.contact_opt_out,
      s.message as step_message, nx.delay_days as next_delay,
      (r.status in ('respondio', 'agendo') or exists (
        select 1 from channel_conversations cc
        where cc.clinic_id = c.clinic_id and cc.phone = p.phone and cc.last_activity_at >= r.last_message_at
          and cc.transcript @> '[{"role": "user"}]'::jsonb)) as replied,
      exists (
        select 1 from appointments a where a.patient_id = p.id and a.status <> 'cancelado'
          and (a.created_at >= r.sent_at or (a.starts_at >= ${now} and a.status in ('confirmado', 'pendiente')))) as booked
    from campaign_recipients r
    join campaigns c on c.id = r.campaign_id
    join patients p on p.id = r.patient_id
    left join campaign_steps s on s.campaign_id = c.id and s.position = r.messages_sent + 1
    left join campaign_steps nx on nx.campaign_id = c.id and nx.position = r.messages_sent + 2
    where c.clinic_id = ${clinic.id} and r.next_step_at is not null and r.next_step_at <= ${now}
      and r.status in ('enviado', 'respondio', 'agendo') and not r.manual
    order by r.next_step_at, r.id
    limit 200`;

  let attempts = 0;
  for (const row of due) {
    const reason = stopReason(row);
    if (reason) {
      await stop(row.id, reason);
      continue;
    }
    if (attempts >= Math.min(PER_RUN, usage.left)) {
      run.waiting++;
      continue;
    }
    if (attempts++ > 0) await pauseBetweenSends(clinic);
    const step = row.messages_sent + 1;
    try {
      await sendPatientMessage(clinic, {
        phone: row.phone!,
        templateKey: templateKeyFor(row.campaign_type),
        templateName: row.template_name,
        language: row.template_language,
        params: [firstName(row.full_name), row.detail ?? ""],
        context: `${row.context ?? ""} Es el seguimiento (mensaje ${step} de ${row.max_messages}): no respondió el mensaje anterior. Objetivo de la campaña "${row.campaign_name}": ${row.goal ?? ""}`.trim(),
        campaignId: row.campaign_id,
        text: followupMessage(row.step_message, row.full_name, row.detail),
        patientId: row.patient_id,
      });
      const more = row.next_delay !== null && step < row.max_messages;
      await sql`
        update campaign_recipients set messages_sent = ${step}, last_message_at = ${now}, error = null,
          next_step_at = ${more ? new Date(now.getTime() + row.next_delay! * 86400_000) : null},
          sequence_stopped = ${more ? null : "Terminó la secuencia"}
        where id = ${row.id}`;
      await recordCampaignMessage(clinic, { campaignId: row.campaign_id, recipientId: row.id, step, at: now });
      run.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await sql`update campaign_recipients set next_step_at = null, sequence_stopped = ${`No salió: ${message.slice(0, 200)}`} where id = ${row.id}`;
      run.failed++;
    }
  }
  return run;
}

/** Manda los seguimientos que vencieron, en las clínicas con las secuencias prendidas. */
export async function runSequences(now = new Date()): Promise<SequenceRun[]> {
  const clinics = await sql<Clinic[]>`select * from clinics where sequences_enabled and not is_demo order by created_at`;
  const runs: SequenceRun[] = [];
  for (const clinic of clinics) {
    try {
      runs.push(await runClinicSequences(clinic, now));
    } catch (e) {
      console.error("Secuencias de campañas fallaron", clinic.id, e);
      runs.push({ clinic_id: clinic.id, clinic: clinic.name, sent: 0, stopped: 0, failed: 1, waiting: 0, skipped: e instanceof Error ? e.message : String(e) });
    }
  }
  return runs;
}
