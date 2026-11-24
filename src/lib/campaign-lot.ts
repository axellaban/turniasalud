import "server-only";
import { sql } from "./db";
import { contactedCount, manualMessage, whatsappLinks } from "./campaigns";
import { followupMessage } from "./campaign-sequences";
import { LOT_SIZE } from "./campaign-limits";
import { withOptOutFooter, templateKeyFor } from "./whatsapp";
import { formatTime } from "./time";
import type { Campaign, Clinic } from "./types";

// Revisar lote (Turnia Activa): los próximos 5 de la campaña, para mandar con Sofi o desde el
// WhatsApp de la clínica de a uno, y lo enviado hoy a mano para marcar qué contestaron.

export type LotItem = {
  id: string;
  name: string;
  /** Por qué le escribimos (la prestación, el control, el turno al que faltó…). */
  reason: string;
  phoneMasked: string;
  /** 1 = primer mensaje; 2 o más = seguimiento. */
  step: number;
  message: string;
  links: { web: string; app: string } | null;
};

export type SentItem = { id: string; name: string; at: string; step: number; outcome: "respondio" | "no_interesa" | "baja" | null; status: string };

export type Lot = {
  items: LotItem[];
  sent: SentItem[];
  pilot: { size: number; contacted: number; done: boolean } | null;
  pending: number;
};

const mask = (phone: string | null) => (phone ? `+${phone.slice(0, 2)} ${phone.slice(2, 3)} ${phone.slice(3, 5)} ···· ${phone.slice(-4)}` : "sin celular");

export async function campaignLot(clinic: Pick<Clinic, "id" | "name" | "timezone">, campaign: Campaign, now = new Date()): Promise<Lot> {
  const contacted = await contactedCount(campaign.id);
  const pilot = campaign.pilot_size ? { size: campaign.pilot_size, contacted, done: contacted >= campaign.pilot_size } : null;
  const firstLeft = pilot ? Math.max(0, pilot.size - contacted) : LOT_SIZE;

  const [followups, firsts, [{ pending }], sentToday, steps] = await Promise.all([
    // Seguimientos de lo que se mandó a mano (Sofi hace los suyos sola).
    sql<Array<{ id: string; full_name: string | null; phone: string | null; detail: string | null; messages_sent: number; last_message_at: string }>>`
      select r.id, p.full_name, p.phone, r.detail, r.messages_sent, r.last_message_at
      from campaign_recipients r join patients p on p.id = r.patient_id
      where r.campaign_id = ${campaign.id} and r.manual and r.status = 'enviado' and r.next_step_at <= ${now}
        and r.messages_sent < ${campaign.max_messages} and not p.contact_opt_out
      order by r.next_step_at, r.id limit ${LOT_SIZE}`,
    sql<Array<{ id: string; full_name: string | null; phone: string | null; detail: string | null }>>`
      select r.id, p.full_name, p.phone, r.detail
      from campaign_recipients r join patients p on p.id = r.patient_id
      where r.campaign_id = ${campaign.id} and r.status in ('pendiente', 'error')
      order by r.created_at, r.id limit ${Math.min(LOT_SIZE, firstLeft)}`,
    sql<Array<{ pending: number }>>`select count(*)::int as pending from campaign_recipients where campaign_id = ${campaign.id} and status in ('pendiente', 'error')`,
    sql<Array<{ id: string; full_name: string | null; last_message_at: string; messages_sent: number; outcome: SentItem["outcome"]; status: string }>>`
      select r.id, p.full_name, r.last_message_at, r.messages_sent, r.outcome, r.status
      from campaign_recipients r join patients p on p.id = r.patient_id
      where r.campaign_id = ${campaign.id} and r.manual and r.last_message_at >= ${new Date(now.getTime() - 24 * 3600_000)}
      order by r.last_message_at desc limit 20`,
    sql<Array<{ position: number; message: string | null }>>`select position, message from campaign_steps where campaign_id = ${campaign.id}`,
  ]);
  const key = templateKeyFor(campaign.type);
  const item = (r: { id: string; full_name: string | null; phone: string | null; detail: string | null }, step: number): LotItem => {
    const detail = r.detail ?? clinic.name;
    const message =
      step === 1
        ? manualMessage(campaign, r.full_name, detail)
        : withOptOutFooter(key, followupMessage(steps.find((s) => s.position === step)?.message ?? null, r.full_name, detail));
    return {
      id: r.id,
      name: r.full_name || "Sin nombre",
      reason: detail ? detail[0].toUpperCase() + detail.slice(1) : "",
      phoneMasked: mask(r.phone),
      step,
      message,
      links: r.phone ? whatsappLinks(r.phone, message) : null,
    };
  };
  const items = [...followups.map((r) => item(r, r.messages_sent + 1)), ...firsts.map((r) => item(r, 1))].slice(0, LOT_SIZE);
  return {
    items,
    sent: sentToday.map((r) => ({ id: r.id, name: r.full_name || "Sin nombre", at: formatTime(r.last_message_at, clinic.timezone), step: r.messages_sent, outcome: r.outcome, status: r.status })),
    pilot,
    pending,
  };
}
