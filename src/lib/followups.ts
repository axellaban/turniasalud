import "server-only";
import { isWhatsappChatId } from "./phone";
import { sql } from "./db";
import { findPatientByPhone, getClinic } from "./clinic";
import { checkAvailability, ToolError } from "./agent/service";
import { scAppointments, scSearchPatients, SmileApiError } from "./smile-connect-api";
import { clientFor, getSmileApiConnection, SmileBudgetError } from "./smile-connect-link";
import { recapTranscript, registerOutbound, type ChannelConversation } from "./channel";
import { chatIsActive, requireActiveWhatsapp } from "./messaging-settings";
import { addDaysKey, zonedParts, zonedTimeToUtc } from "./time";
import { wahaSendText } from "./waha";
import { wahaConnectionForClinic, withWahaConnection } from "./waha-connections";
import { whatsappReadiness } from "./whatsapp";
import { withArticle } from "./whatsapp-style";

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

/** «Limpieza dental» se nombra; «Consulta de implantes, blanqueamiento, funda/corona» suena a sistema. */
const plainName = (name: string) => name.length <= 40 && !/[,/]/.test(name);

/**
 * El mensaje de seguimiento, como lo escribiría recepción: sin «¿», con el profesional de cada horario
 * y el día una sola vez si los dos son el mismo día. Sirve igual para las clínicas que tutean y las que
 * tratan de usted («Reservamos alguno?»). Puro.
 */
export function followupText(input: { name: string | null; typeName: string; slots: FollowupSlot[]; attempt: number }): string {
  const first = input.name?.trim().split(/\s+/)[0];
  const hello = first ? `Hola ${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()}` : "Hola";
  const subject = plainName(input.typeName) ? `el turno de ${lowerFirst(input.typeName)}` : "el turno que estábamos viendo";
  const opening = input.attempt > 1 ? `${hello}, retomo lo ${subject.replace(/^el /, "del ")}` : `${hello}, sobre ${subject}`;
  const who = (s: FollowupSlot) => (s.profesional ? ` con ${withArticle(s.profesional)}` : "");
  const [a, b] = input.slots;
  if (!a) return `${opening}: los horarios que vimos ya se ocuparon. Buscamos otros días?`;
  if (!b) return `${opening}: todavía hay lugar el ${a.cuando}${who(a)}. Lo reservamos?`;
  const [dayA, timeA] = a.cuando.split(" a las ");
  const [dayB, timeB] = b.cuando.split(" a las ");
  const both = dayA === dayB && timeB && (a.profesional ?? "") === (b.profesional ?? "")
    ? `el ${dayA} a las ${timeA} o a las ${timeB}${who(a)}`
    : `el ${a.cuando}${who(a)} o el ${b.cuando}${who(b)}`;
  return `${opening}: todavía hay lugar ${both}. Reservamos alguno?`;
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
  if (!original || !isWhatsappChatId(original.chat_id)) return closed(offer);
  // Contestó algo después de que le ofrecieron los horarios (sí, no, otro día): ya no es un silencio.
  const offeredAt = new Date(offer.created_at).getTime();
  if (convs.some((c) => c.transcript.some((l) => l.role === "user" && new Date(l.at).getTime() > offeredAt))) return closed(offer);
  // Sacó turno por otro lado (llamó, o se lo dio recepción): en Turnia, o en Smile Connect aunque
  // todavía no haya llegado a Turnia.
  const person = await personOf(clinic.id, offer.patient_phone);
  const [booked] = await sql`
    select 1 from appointments
    where clinic_id = ${clinic.id} and patient_id = any(${person.patientIds}::uuid[]) and created_at > ${offer.created_at}
    limit 1`;
  if (booked) return closed(offer);
  const inSmile = await bookedInSmile(clinic, offer, person, now);
  if (inSmile === "esperar") return "esperar";
  if (inSmile) return closed(offer);

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
  // Siempre con el profesional: si cambió desde la charla, el paciente tiene que saberlo.
  const slots = availability.turnos.slice(0, 2).map((t) => ({ cuando: t.cuando, ...(t.profesional && { profesional: t.profesional }) }));
  const attempt = offer.followups_sent + 1;
  const text = followupText({ name: patient?.full_name ?? null, typeName: offer.type_name, slots, attempt });

  // Se cuenta antes de mandar: si dos corridas se cruzan, escribe una sola.
  const claimed = await sql`
    update agent_offers set followups_sent = followups_sent + 1, last_followup_at = ${now}
    where id = ${offer.id} and followups_sent = ${offer.followups_sent} and closed_at is null
    returning id`;
  if (!claimed.length) return "esperar";

  const send = async () => {
    await requireActiveWhatsapp();
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

type Person = { patientIds: string[]; dnis: string[]; smileIds: number[] };

/**
 * Las fichas de esta persona: las de su celular y las que tienen su DNI (recepción pudo cargarla con
 * otro teléfono), con sus vínculos de Smile Connect.
 */
async function personOf(clinicId: string, phone: string): Promise<Person> {
  const rows = await sql<Array<{ id: string; dni: string | null; ext: string[] }>>`
    with own as (select id, dni from patients where clinic_id = ${clinicId} and phone = ${phone})
    select p.id, p.dni,
      coalesce((select array_agg(e.external_id) from patient_external_ids e where e.patient_id = p.id and e.external_id ~ '^sc:[0-9]+$'), '{}') as ext
    from patients p
    where p.clinic_id = ${clinicId}
      and (p.id in (select id from own) or (p.dni is not null and p.dni in (select dni from own where dni is not null)))`;
  return {
    patientIds: rows.map((r) => r.id),
    dnis: [...new Set(rows.map((r) => r.dni).filter((d): d is string => Boolean(d)))],
    smileIds: [...new Set(rows.flatMap((r) => r.ext.map((e) => Number(e.slice(3)))))],
  };
}

/** Lo que Turnia ya lee de Smile Connect cada media hora: hoy y los próximos días. */
const NEAR_DAYS = 4;
/** Las fechas que se miran en vivo: las que se habían buscado, o las dos semanas siguientes. */
const DEFAULT_WINDOW_DAYS = 14;

/**
 * ¿Recepción le dio un turno en Smile Connect después de la oferta? Turnia trae los turnos lejanos solo
 * cada 8 horas, así que antes de escribirle se miran en vivo las fechas que se habían buscado (si los
 * días cercanos ya se leyeron después de la oferta, alcanza con Turnia). Si Smile Connect no responde o
 * no queda cupo de lecturas, se espera: mejor tarde que escribirle a quien ya tiene turno.
 */
async function bookedInSmile(clinic: { id: string; timezone: string }, offer: OpenOffer, person: Person, now: Date): Promise<boolean | "esperar"> {
  const clinicId = clinic.id;
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || conn.api_mode === "apagada") return false;
  if (conn.api_retry_at && Date.parse(conn.api_retry_at) > now.getTime()) return "esperar";
  const query = offer.query as { desde?: string; hasta?: string };
  // Medianoche de un día (AAAA-MM-DD) en la zona del consultorio.
  const midnight = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return zonedTimeToUtc(y, m, d, 0, 0, clinic.timezone).getTime();
  };
  const dateKey = /^\d{4}-\d{2}-\d{2}$/;
  const from = new Date(Math.max(now.getTime(), query.desde && dateKey.test(query.desde) ? midnight(query.desde) : 0));
  const until = query.hasta && dateKey.test(query.hasta) ? midnight(addDaysKey(query.hasta, 1)) : now.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000;
  const to = new Date(Math.min(until, from.getTime() + 31 * 86_400_000));
  if (to <= from) return false;
  const nearFresh = conn.api_near_pull_at && Date.parse(conn.api_near_pull_at) > Date.parse(offer.created_at);
  if (nearFresh && to.getTime() <= now.getTime() + NEAR_DAYS * 86_400_000) return false;
  try {
    const client = clientFor(conn);
    const ids = new Set(person.smileIds);
    const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
    // Otra ficha de Smile Connect con su DNI o su celular (aunque no esté vinculada en Turnia).
    for (const dni of person.dnis) {
      for (const p of await scSearchPatients(client, digits(dni))) if (digits(p.id_number) === digits(dni)) ids.add(p.patient_id);
    }
    const phone = digits(offer.patient_phone);
    const national = /^549\d{10}$/.test(phone) ? phone.slice(3) : null;
    if (national) {
      for (const p of await scSearchPatients(client, national)) if (digits(p.phone_number).endsWith(national.slice(-8))) ids.add(p.patient_id);
    }
    if (!ids.size) return false;
    const known = new Set((await sql<Array<{ external_id: string }>>`
      select external_id from appointments where clinic_id = ${clinicId} and external_id ~ '^sc:[0-9]+$'
        and created_at <= ${offer.created_at} and starts_at >= ${from} and starts_at < ${to}`)
      .map((r) => Number(r.external_id.slice(3))));
    return (await scAppointments(client, from, to)).some((a) =>
      ids.has(a.patient_id) && !a.cancelled && a.attendance !== "Canceled with Notice" && !known.has(a.appointment_id)
      && Date.parse(a.start_date) > now.getTime());
  } catch (e) {
    if (e instanceof SmileBudgetError || e instanceof SmileApiError) {
      console.error("Seguimiento: no se pudo revisar Smile Connect, se espera", e.message);
      return "esperar";
    }
    throw e;
  }
}

async function closed(offer: OpenOffer): Promise<"cerrado"> {
  await close(offer.id);
  return "cerrado";
}
