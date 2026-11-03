import "server-only";
import { sql } from "./db";
import { findPatientByPhone, getClinic } from "./clinic";
import { checkAvailability, ToolError } from "./agent/service";
import { recapTranscript, registerOutbound, type ChannelConversation } from "./channel";
import { channelForChat, chatIsActive, requireActiveChannel } from "./messaging-settings";
import { zonedParts } from "./time";
import { wahaSendText } from "./waha";
import { wahaConnectionForClinic, withWahaConnection } from "./waha-connections";
import { whatsappReadiness } from "./whatsapp";

// Seguimiento de turnos ofrecidos (pedido del Dr. Mininni, 03/11): el agente le pasó horarios al
// paciente por WhatsApp y no contestó. Se le vuelve a escribir una o dos veces (lo elige la clínica)
// con los horarios que siguen libres en ese momento, porque los de ayer pueden haberse ocupado.
// Si contesta, sigue el agente con el contexto de lo que se habló. Corre con la automatización de
// cada 10 minutos (POST /api/automations/calendario o /api/automations/seguimientos).

/** Solo se escribe en este horario de la clínica: de 9 a 20. */
export const FOLLOWUP_HOURS = { from: 9, to: 20 } as const;
/** Entre el primer seguimiento y el segundo pasa casi un día. */
export const SECOND_FOLLOWUP_AFTER_HOURS = 20;
/** Un ofrecimiento sin respuesta deja de seguirse a los 3 días. */
const OFFER_MAX_DAYS = 3;

type OpenOffer = {
  id: string;
  clinic_id: string;
  conversation_id: string;
  patient_phone: string;
  query: Parameters<typeof checkAvailability>[1];
  type_name: string;
  followups_sent: number;
  last_followup_at: string | null;
  created_at: string;
};

export type FollowupSlot = { cuando: string; profesional?: string };

/** «Limpieza dental» → «limpieza dental»; «PAMI» queda igual. */
const lowerFirst = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * El mensaje de seguimiento. Sirve igual para las clínicas que tutean y las que tratan de usted
 * («¿Reservamos alguno?»). Puro.
 */
export function followupText(input: { name: string | null; typeName: string; slots: FollowupSlot[]; attempt: number }): string {
  const first = input.name?.trim().split(/\s+/)[0];
  const hello = first ? `Hola ${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()}` : "Hola";
  const opening = input.attempt > 1 ? `${hello}, retomo lo del turno de ${lowerFirst(input.typeName)}` : `${hello}, sobre el turno de ${lowerFirst(input.typeName)}`;
  const slot = (s: FollowupSlot) => `el ${s.cuando}${s.profesional ? ` con ${s.profesional}` : ""}`;
  const [a, b] = input.slots;
  if (!a) return `${opening}: los horarios que vimos ya se ocuparon. ¿Buscamos otros días?`;
  if (!b) return `${opening}: todavía hay lugar ${slot(a)}. ¿Lo reservamos?`;
  return `${opening}: todavía hay lugar ${slot(a)} o ${slot(b)}. ¿Reservamos alguno?`;
}

/** ¿Ya toca escribirle? Puro. */
export function followupDue(
  offer: Pick<OpenOffer, "followups_sent" | "last_followup_at" | "created_at">,
  clinic: { followup_attempts: number; followup_delay_hours: number; timezone: string },
  now: Date,
): "ahora" | "esperar" | "terminado" {
  if (offer.followups_sent >= clinic.followup_attempts) return "terminado";
  const due =
    offer.followups_sent === 0 || !offer.last_followup_at
      ? new Date(offer.created_at).getTime() + clinic.followup_delay_hours * 3600_000
      : new Date(offer.last_followup_at).getTime() + SECOND_FOLLOWUP_AFTER_HOURS * 3600_000;
  if (now.getTime() < due) return "esperar";
  const { hour } = zonedParts(now, clinic.timezone);
  return hour >= FOLLOWUP_HOURS.from && hour < FOLLOWUP_HOURS.to ? "ahora" : "esperar";
}

const close = (id: string) => sql`update agent_offers set closed_at = now() where id = ${id} and closed_at is null`;

/** Le escribe a quien no contestó los horarios que le ofreció el agente. */
export async function sendOfferFollowups(now = new Date()): Promise<{ enviados: number; cerrados: number; errores: number }> {
  await sql`update agent_offers set closed_at = now() where closed_at is null and created_at < now() - make_interval(days => ${OFFER_MAX_DAYS})`;
  const offers = await sql<OpenOffer[]>`select * from agent_offers where closed_at is null order by created_at limit 200`;
  const result = { enviados: 0, cerrados: 0, errores: 0 };
  for (const offer of offers) {
    try {
      const outcome = await followUp(offer, now);
      if (outcome === "enviado") result.enviados++;
      if (outcome === "cerrado") result.cerrados++;
    } catch (e) {
      result.errores++;
      console.error("Seguimiento de turno ofrecido: no se pudo escribir", offer.id, e instanceof Error ? e.message : e);
    }
  }
  if (result.enviados || result.errores) console.log(JSON.stringify({ evento: "seguimiento_turnos", ...result }));
  return result;
}

async function followUp(offer: OpenOffer, now: Date): Promise<"enviado" | "cerrado" | "esperar"> {
  const clinic = await getClinic(offer.clinic_id);
  if (clinic.is_demo) return closed(offer);
  const due = followupDue(offer, clinic, now);
  if (due === "terminado") return closed(offer);
  if (due === "esperar") return "esperar";

  // La charla en la que se ofrecieron los horarios y lo que pasó después con este paciente.
  const convs = await sql<ChannelConversation[]>`
    select * from channel_conversations
    where clinic_id = ${clinic.id} and phone = ${offer.patient_phone}
      and (elevenlabs_conversation_id = ${offer.conversation_id} or created_at >= ${offer.created_at})
    order by created_at`;
  const original = convs.find((c) => c.elevenlabs_conversation_id === offer.conversation_id);
  // Una llamada o la demo web: no hay chat al que volver a escribir.
  if (!original || channelForChat(original.chat_id) !== "whatsapp") return closed(offer);
  // Contestó algo después de que le ofrecieron los horarios (sí, no, otro día): ya no es un silencio.
  const offeredAt = new Date(offer.created_at).getTime();
  if (convs.some((c) => c.transcript.some((l) => l.role === "user" && new Date(l.at).getTime() > offeredAt))) return closed(offer);
  // Sacó turno por otro lado (llamó, o se lo dio recepción).
  const [booked] = await sql`
    select 1 from appointments a join patients p on p.id = a.patient_id
    where a.clinic_id = ${clinic.id} and p.phone = ${offer.patient_phone} and a.created_at > ${offer.created_at}
    limit 1`;
  if (booked) return closed(offer);

  // Se escribe desde la misma línea por la que habló: la propia del consultorio o la general.
  const own = wahaConnectionForClinic(clinic.id);
  if ((original.waha_connection_id ?? null) !== (own?.id ?? null)) return closed(offer);
  if (!own && clinic.whatsapp_provider !== "waha") return closed(offer);
  // Con el WhatsApp pausado se espera, sin gastar el intento.
  if (whatsappReadiness(clinic)) return "esperar";

  let availability;
  try {
    availability = await checkAvailability({ clinicId: clinic.id, patientPhone: offer.patient_phone }, offer.query);
  } catch (e) {
    // La prestación ya no existe o ahora la da solo el consultorio: no hay qué ofrecer.
    if (e instanceof ToolError) return closed(offer);
    throw e;
  }
  const patient = await findPatientByPhone(clinic.id, offer.patient_phone);
  if (patient?.contact_opt_out) return closed(offer);
  const pros = new Set(availability.turnos.map((t) => t.profesional));
  const slots = availability.turnos.slice(0, 2).map((t) => ({ cuando: t.cuando, ...(pros.size > 1 && t.profesional && { profesional: t.profesional }) }));
  const attempt = offer.followups_sent + 1;
  const text = followupText({ name: patient?.full_name ?? null, typeName: offer.type_name, slots, attempt });

  // Se cuenta antes de mandar: si dos corridas se cruzan, escribe una sola.
  const claimed = await sql`
    update agent_offers set followups_sent = followups_sent + 1, last_followup_at = ${now}
    where id = ${offer.id} and followups_sent = ${offer.followups_sent} and closed_at is null
    returning id`;
  if (!claimed.length) return "esperar";

  const send = async () => {
    await requireActiveChannel("whatsapp");
    if (!(await chatIsActive(original.chat_id))) throw new Error("El WhatsApp está pausado.");
    await wahaSendText(original.chat_id, text);
    const last = convs[convs.length - 1];
    await registerOutbound(clinic.id, {
      phone: offer.patient_phone,
      chatId: original.chat_id,
      text,
      context:
        `Seguimiento automático: le ofreciste turno para ${offer.type_name} y no respondió, así que le volvimos a escribir. ` +
        `Lo último que se habló: ${recapTranscript(last.transcript)} ` +
        "Si quiere uno de los horarios, volvé a consultar la disponibilidad antes de reservar: pueden haber cambiado. Si no le interesa, no insistas.",
    });
  };
  await (own ? withWahaConnection(own, send) : send());
  return "enviado";
}

async function closed(offer: OpenOffer): Promise<"cerrado"> {
  await close(offer.id);
  return "cerrado";
}
