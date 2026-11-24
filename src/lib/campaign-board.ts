import "server-only";
import { sql } from "./db";
import { NOT_REACHABLE } from "./campaigns";
import { SEND_WINDOW, inSendWindow } from "./campaign-limits";
import { formatDate, humanSlot, zonedParts, zonedTimeToUtc } from "./time";
import { ATTRIBUTION_DAYS, type Campaign, type CampaignRecipient, type Clinic } from "./types";

// Datos de la pantalla de Campañas (Turnia Activa): resultados en 4 etapas, la cola con quién recibe
// el próximo mensaje y quién quedó afuera (con el motivo y cómo resolverlo) y el resumen de cada campaña.

export type Period = "30" | "mes" | "todo";
export const PERIODS: Array<[Period, string]> = [
  ["30", "Últimos 30 días"],
  ["mes", "Este mes"],
  ["todo", "Desde que empezó"],
];

function periodStart(period: Period, clinic: Pick<Clinic, "timezone">, now = new Date()): Date | null {
  if (period === "todo") return null;
  if (period === "30") return new Date(now.getTime() - 30 * 86400_000);
  const p = zonedParts(now, clinic.timezone);
  return zonedTimeToUtc(p.year, p.month, 1, 0, 0, clinic.timezone);
}

/**
 * Las 4 etapas, contadas sobre los pacientes contactados en el período (mensajes que efectivamente
 * salieron, por Sofi o desde el WhatsApp de la clínica). Un turno cuenta si se sacó dentro de los
 * 14 días del mensaje, por cualquier canal; el valor es el de los turnos atendidos.
 */
export type CampaignResults = { contacted: number; replied: number; booked: number; attended: number; attendedValue: number };

export async function campaignResults(clinic: Pick<Clinic, "id" | "timezone">, campaignId: string, period: Period = "30"): Promise<CampaignResults> {
  const since = periodStart(period, clinic);
  const [row] = await sql<CampaignResults[]>`
    select count(*)::int as contacted,
      count(*) filter (where r.status in ('respondio', 'agendo') or b.status is not null)::int as replied,
      count(*) filter (where r.status = 'agendo' or b.status is not null)::int as booked,
      count(*) filter (where b.status = 'atendido')::int as attended,
      coalesce(sum(t.price) filter (where b.status = 'atendido'), 0)::float8 as "attendedValue"
    from campaign_recipients r
    join campaigns c on c.id = r.campaign_id
    left join lateral (
      select a.status, a.appointment_type_id from appointments a
      where a.patient_id = r.patient_id and a.status <> 'cancelado'
        and a.created_at >= r.sent_at and a.created_at < r.sent_at + make_interval(days => ${ATTRIBUTION_DAYS})
      order by a.created_at
      limit 1
    ) b on true
    left join appointment_types t on t.id = b.appointment_type_id
    where c.clinic_id = ${clinic.id} and r.campaign_id = ${campaignId} and r.sent_at is not null
      and r.status in ('enviado', 'respondio', 'agendo') ${since ? sql`and r.sent_at >= ${since}` : sql``}`;
  return row;
}

/** Porcentaje de paso entre una etapa y la anterior (null si la anterior es 0). */
export const stepRate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Cuándo sale lo que está en la cola: ahora si es horario de envío o el próximo día hábil a las 9. */
export function nextSendLabel(clinic: Pick<Clinic, "timezone">, now = new Date()): string {
  if (inSendWindow(clinic, now)) return "Hoy";
  const p = zonedParts(now, clinic.timezone);
  let day = p.weekday;
  let add = p.hour < SEND_WINDOW.from && (SEND_WINDOW.weekdays as readonly number[]).includes(day) ? 0 : 1;
  day = (day + add) % 7;
  while (!(SEND_WINDOW.weekdays as readonly number[]).includes(day)) {
    day = (day + 1) % 7;
    add++;
  }
  return `${add === 0 ? "Hoy" : add === 1 ? "Mañana" : WEEKDAY[day]} ${SEND_WINDOW.from}:00`;
}

export type QueueKind = "cola" | "sofi" | "fuera" | "hecho";
export type QueueRow = {
  id: string;
  patient_id: string;
  name: string;
  /** Por qué está en la campaña o por qué quedó afuera. */
  reason: string;
  /** Primer mensaje, Seguimiento 2 de 2, Lo atiende Sofi, Fuera de la cola… */
  step: string;
  when: string;
  kind: QueueKind;
  action: { label: string; href?: string; include?: boolean } | null;
};

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

export type QueueFilter = "hoy" | "fuera" | "todos";

/** La cola de una campaña: quién recibe el próximo mensaje y quién quedó afuera y por qué. */
export async function campaignQueue(
  clinic: Pick<Clinic, "id" | "timezone" | "sequences_enabled">,
  campaign: Pick<Campaign, "id" | "max_messages">,
  filter: QueueFilter = "hoy",
  now = new Date(),
): Promise<{ rows: QueueRow[]; counts: Record<QueueKind, number> }> {
  const recipients = await sql<Array<CampaignRecipient & { name: string | null; booked_at: string | null }>>`
    select r.*, p.full_name as name,
      (select min(a.created_at) from appointments a where a.patient_id = r.patient_id and a.status <> 'cancelado'
         and a.created_at >= coalesce(r.sent_at, r.created_at)) as booked_at
    from campaign_recipients r join patients p on p.id = r.patient_id
    where r.campaign_id = ${campaign.id}
    order by r.next_step_at nulls last, r.created_at, r.id`;
  const next = nextSendLabel(clinic, now);
  const rows: QueueRow[] = recipients.map((r) => {
    const base = { id: r.id, patient_id: r.patient_id, name: r.name || "Sin nombre" };
    const detail = capitalize(r.detail ?? "");
    if (r.status === "pendiente" || r.status === "error") {
      return {
        ...base,
        reason: r.status === "error" ? `No salió: ${r.error ?? "error"}` : detail,
        step: "Primer mensaje",
        when: next,
        kind: "cola",
        action: { label: "Quitar", include: false },
      };
    }
    if (r.status === "excluido") {
      if (r.error === NOT_REACHABLE) {
        return { ...base, reason: "Sin un celular que sirva para WhatsApp", step: "Fuera de la cola", when: "", kind: "fuera", action: { label: "Completar celular", href: `/panel/pacientes/${r.patient_id}` } };
      }
      if (r.error) {
        const booked = r.booked_at ? `Sacó turno el ${formatDate(r.booked_at, clinic.timezone)}` : r.error;
        return { ...base, reason: booked, step: "Ya no corresponde", when: r.booked_at ? "Se cuenta en resultados" : "", kind: "fuera", action: null };
      }
      return { ...base, reason: "Lo sacó el equipo de la lista", step: "Fuera de la cola", when: "", kind: "fuera", action: { label: "Volver a sumar", include: true } };
    }
    if (r.status === "respondio" || r.status === "agendo") {
      return {
        ...base,
        reason: r.status === "agendo" ? "Sacó turno" : "Respondió",
        step: r.manual ? "Respondió en tu WhatsApp" : "Lo atiende Sofi",
        when: "",
        kind: "sofi",
        action: { label: "Ver ficha", href: `/panel/pacientes/${r.patient_id}` },
      };
    }
    // Enviado: con un seguimiento por delante o ya terminado.
    const sentOn = r.last_message_at ?? r.sent_at;
    const sentLabel = sentOn ? `no contestó el ${formatDate(sentOn, clinic.timezone)}` : "enviado";
    if (r.next_step_at) {
      const step = `Seguimiento ${r.messages_sent + 1} de ${campaign.max_messages}`;
      const due = new Date(r.next_step_at);
      const when = !clinic.sequences_enabled ? "Seguimiento apagado" : due <= now ? next : humanSlot(due, clinic.timezone);
      return { ...base, reason: `${detail || "Mensaje"}: ${sentLabel}`, step, when, kind: due <= now ? "cola" : "hecho", action: null };
    }
    return {
      ...base,
      reason: `${detail || "Mensaje"}: ${sentLabel}`,
      step: r.manual ? "Enviado desde tu WhatsApp" : "Enviado",
      when: r.sequence_stopped ?? (r.messages_sent >= campaign.max_messages ? "Terminó la secuencia" : ""),
      kind: "hecho",
      action: null,
    };
  });
  const counts: Record<QueueKind, number> = { cola: 0, sofi: 0, fuera: 0, hecho: 0 };
  for (const r of rows) counts[r.kind]++;
  const visible = filter === "todos" ? rows : rows.filter((r) => (filter === "fuera" ? r.kind === "fuera" : r.kind === "cola" || r.kind === "sofi"));
  return { rows: visible, counts };
}

export type CampaignSummary = Campaign & { queued: number; listed: number; steps: number; next_followup: string | null };

/** Campañas en curso y borradores, con lo que tienen en cola y sus pasos. */
export async function activeCampaigns(clinicId: string): Promise<CampaignSummary[]> {
  return sql<CampaignSummary[]>`
    select c.*,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id
         and (r.status in ('pendiente', 'error') or (r.next_step_at is not null and r.next_step_at <= now()))) as queued,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status <> 'excluido') as listed,
      1 + (select count(*)::int from campaign_steps s where s.campaign_id = c.id and s.position <= c.max_messages) as steps,
      (select min(r.next_step_at) from campaign_recipients r where r.campaign_id = c.id and r.next_step_at > now()) as next_followup
    from campaigns c
    where c.clinic_id = ${clinicId} and (c.status in ('borrador', 'enviando')
      or exists (select 1 from campaign_recipients r where r.campaign_id = c.id and r.next_step_at is not null))
    order by (c.status = 'enviando') desc, c.created_at desc
    limit 12`;
}
