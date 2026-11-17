import "server-only";
import { after } from "next/server";
import { getClinic } from "./clinic";
import { sql } from "./db";
import { displayPhone, normalizePhone } from "./phone";
import type { Clinic } from "./types";
import { chatIdForPhone, wahaSendText } from "./waha";
import { wahaConnectionForClinic, withWahaConnection } from "./waha-connections";
import { whatsappReadiness } from "./whatsapp";

// Avisos al consultorio por WhatsApp: cuando Sofi da, mueve o cancela un turno, les llega un mensaje
// con el detalle (prestación, motivo, paciente) a los celulares que el consultorio carga en
// Configuración. Salen por la línea de WhatsApp del consultorio (o la general de Turnia, si la usa).
// Quedan en una cola: si WhatsApp falla, se reintentan con la automatización de cada 10 minutos.

export const NOTICE_KINDS = ["nuevo", "movido", "cancelado"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_LABEL: Record<NoticeKind, string> = { nuevo: "Turnos nuevos", movido: "Turnos movidos", cancelado: "Turnos cancelados" };

/** Después de cinco intentos, o de un día, el aviso ya no se manda. */
const MAX_ATTEMPTS = 5;
const FOOTER = "_Aviso automático de Turnia. No hace falta responder._";

export type NoticePhone = { id: string; clinic_id: string; phone: string; name: string; events: NoticeKind[]; created_at: string };
export type NoticeRow = {
  id: string;
  clinic_id: string;
  phone: string;
  kind: NoticeKind | "prueba" | "smile" | "smile_paciente" | "smile_confirmado";
  body: string;
  status: "pendiente" | "enviando" | "enviado" | "error" | "vencido";
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
};

export async function listNoticePhones(clinicId: string): Promise<NoticePhone[]> {
  return [...(await sql<NoticePhone[]>`select * from clinic_notice_phones where clinic_id = ${clinicId} order by created_at`)];
}

export async function recentNotices(clinicId: string, limit = 8): Promise<NoticeRow[]> {
  return [...(await sql<NoticeRow[]>`select * from clinic_notices where clinic_id = ${clinicId} order by created_at desc limit ${limit}`)];
}

// ── Texto ────────────────────────────────────────────────────────────────────

export type NoticePart = {
  startsAt: string;
  endsAt: string;
  professional: string;
  typeName: string;
  title: string | null;
  notes: string | null;
};

export type NoticeInput = {
  kind: NoticeKind;
  agentName: string;
  /** Por dónde lo pidió el paciente (`source` del turno). */
  source: string;
  timeZone: string;
  patient: { name: string | null; phone: string | null; dni: string | null };
  coverage: string | null;
  parts: NoticePart[];
  /** Turno movido: dónde estaba. */
  before?: { startsAt: string; professional: string } | null;
  /** Turno cancelado: el motivo que dio el paciente. */
  reason?: string | null;
};

const VIA: Record<string, string> = { whatsapp: " por WhatsApp", telefono: " por teléfono", web: " en la web" };

const oneLine = (s: string | null | undefined, max = 300) => {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** «martes 18/11» en la zona horaria del consultorio. */
function dayLabel(date: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("es-AR", { timeZone, weekday: "long" }).format(date);
  const dayMonth = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "numeric" }).format(date);
  return `${weekday} ${dayMonth}`;
}
const clock = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);

/** El aviso, listo para WhatsApp (negritas con asteriscos). Pura: se prueba sin base. */
export function noticeText(input: NoticeInput): string {
  const tz = input.timeZone;
  const parts = [...input.parts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const first = parts[0];
  const last = parts[parts.length - 1];
  const start = new Date(first.startsAt);
  const end = new Date(last.endsAt);
  const via = VIA[input.source] ?? "";
  const pros = [...new Set(parts.map((p) => p.professional))].join(" y ");
  const when = `${dayLabel(start, tz)}, ${clock(start, tz)} a ${clock(end, tz)}`;
  const heading = {
    nuevo: `📅 *Turno nuevo* · lo dio ${input.agentName}${via}`,
    movido: `🔁 *Turno movido* · lo movió ${input.agentName}${via}`,
    cancelado: `❌ *Turno cancelado* · lo canceló ${input.agentName}${via}`,
  }[input.kind];

  const lines = [heading];
  if (input.kind === "movido" && input.before) {
    const before = new Date(input.before.startsAt);
    lines.push(`Antes: ${dayLabel(before, tz)}, ${clock(before, tz)} · ${input.before.professional}`);
    lines.push(`*Ahora: ${when}* · ${pros}`);
  } else {
    lines.push(`*${when}* · ${pros}`);
  }

  const who = [oneLine(input.patient.name, 120) || "Paciente sin nombre", input.patient.phone ? displayPhone(input.patient.phone) : null, input.patient.dni ? `DNI ${input.patient.dni}` : null];
  lines.push(`Paciente: ${who.filter(Boolean).join(" · ")}`);

  const services = parts.map((p) => {
    const title = oneLine(p.title, 80);
    return title && title.toLowerCase() !== p.typeName.toLowerCase() ? `${p.typeName} (${title})` : p.typeName;
  });
  lines.push(`${parts.length > 1 ? "Prestaciones" : "Prestación"}: ${services.join(" y, a continuación, ")}`);
  if (input.coverage) lines.push(`Cobertura: ${oneLine(input.coverage, 80)}`);
  // El motivo que contó el paciente (las notas del turno). Al cancelar, el que dio para cancelar.
  const notes = parts.map((p) => oneLine(p.notes)).filter(Boolean);
  if (input.kind === "cancelado") {
    if (input.reason) lines.push(`Motivo de la cancelación: ${oneLine(input.reason)}`);
  } else if (notes.length) {
    lines.push(`Motivo: ${notes.join(" | ")}`);
  }
  lines.push("", FOOTER);
  return lines.join("\n");
}

export function testNoticeText(clinicName: string, agentName: string): string {
  return [
    `✅ *Aviso de prueba* de ${agentName} (${clinicName})`,
    "Este número va a recibir los avisos de los turnos que dé, mueva o cancele.",
    "",
    FOOTER,
  ].join("\n");
}

// ── Cola ─────────────────────────────────────────────────────────────────────

type ApptDetail = {
  id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  coverage: string | null;
  notes: string | null;
  title: string | null;
  created_at: string;
  type_name: string;
  professional: string;
  second_professional: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_dni: string | null;
};

async function details(clinicId: string, ids: string[]): Promise<ApptDetail[]> {
  if (!ids.length) return [];
  return [
    ...(await sql<ApptDetail[]>`
      select a.id, a.patient_id, a.starts_at, a.ends_at, a.status, a.source, a.coverage, a.notes, a.title, a.created_at,
             t.name as type_name, pr.full_name as professional, sp.full_name as second_professional,
             p.full_name as patient_name, p.phone as patient_phone, p.dni as patient_dni
      from appointments a
        join appointment_types t on t.id = a.appointment_type_id
        join professionals pr on pr.id = a.professional_id
        left join professionals sp on sp.id = a.second_professional_id
        join patients p on p.id = a.patient_id
      where a.clinic_id = ${clinicId} and a.id = any(${ids}::uuid[])
      order by a.starts_at`),
  ];
}

const partOf = (a: ApptDetail): NoticePart => ({
  startsAt: a.starts_at,
  endsAt: a.ends_at,
  professional: a.second_professional ? `${a.professional} y ${a.second_professional}` : a.professional,
  typeName: a.type_name,
  title: a.title,
  notes: a.notes,
});

/**
 * Deja en la cola el aviso de un cambio de agenda que hizo Sofi, uno por cada celular que lo quiere
 * recibir. `ids`: los turnos (nuevo o movido: los de ahora; cancelado: el cancelado). `beforeId`: el
 * turno de antes, si se movió. Devuelve cuántos avisos quedaron en la cola.
 */
export async function queueAppointmentNotice(
  clinicId: string,
  kind: NoticeKind,
  opts: { ids: string[]; beforeId?: string | null; reason?: string | null },
): Promise<number> {
  const phones = (await listNoticePhones(clinicId)).filter((p) => p.events.includes(kind));
  if (!phones.length) return 0;
  const ids = [...new Set(opts.ids.filter(Boolean))];
  let rows = await details(clinicId, ids);
  if (!rows.length) return 0;
  // «Se sumó una práctica a continuación de su turno»: el turno que ya tenía no es nuevo.
  if (kind === "nuevo" && rows.length > 1) {
    const fresh = rows.filter((r) => Date.now() - Date.parse(r.created_at) < 10 * 60_000);
    if (fresh.length) rows = fresh;
  }
  const [before] = opts.beforeId ? await details(clinicId, [opts.beforeId]) : [];
  const clinic = await getClinic(clinicId);
  const head = rows[0];
  const body = noticeText({
    kind,
    agentName: clinic.agent_name || "Sofi",
    source: head.source,
    timeZone: clinic.timezone,
    patient: { name: head.patient_name, phone: head.patient_phone, dni: head.patient_dni },
    coverage: head.coverage,
    parts: rows.map(partOf),
    before: before ? { startsAt: before.starts_at, professional: partOf(before).professional } : null,
    reason: opts.reason ?? null,
  });
  await sql`
    insert into clinic_notices ${sql(phones.map((p) => ({ clinic_id: clinicId, phone: p.phone, kind, appointment_id: head.id, body })))}`;
  return phones.length;
}

/** Línea por la que salen los avisos de la clínica, o por qué no pueden salir. */
export function noticeLine(clinic: Clinic): { phone: string | null; problem: string | null } {
  const own = wahaConnectionForClinic(clinic.id);
  if (!own && clinic.whatsapp_provider !== "waha") {
    return { phone: null, problem: "Este consultorio no tiene una línea de WhatsApp conectada a Turnia: los avisos quedan en espera hasta conectarla." };
  }
  return { phone: own?.phone ?? null, problem: whatsappReadiness(clinic) };
}

const isSmilePatientNotice = (kind: NoticeRow["kind"]) => kind === "smile_paciente" || kind === "smile_confirmado";

async function reviewSmileDelivery(noticeId: string, reason: string) {
  await sql`
    with failed as (
      update clinic_notices set status = 'vencido', error = ${reason} where id = ${noticeId} and status = 'enviando'
      returning clinic_id, appointment_id, body
    )
    insert into tasks (clinic_id, patient_id, type, title, details)
    select f.clinic_id, a.patient_id, 'derivacion_humana', 'Verificar entrega del aviso del turno',
      'Revisá el chat antes de reenviarlo. ' || f.body
    from failed f join appointments a on a.id = f.appointment_id`;
}

async function sendOne(clinic: Clinic, row: NoticeRow): Promise<"enviado" | "error" | "omitido"> {
  const patientNotice = isSmilePatientNotice(row.kind);
  const own = wahaConnectionForClinic(clinic.id);
  if (patientNotice && !own) return "omitido";
  // Se cuenta el intento antes de mandar: si dos corridas se cruzan, manda una sola.
  const claimed = await sql`
    update clinic_notices set attempts = attempts + 1, attempted_at = now(),
      status = case when ${patientNotice} then 'enviando' else status end
    where id = ${row.id} and status in ('pendiente', 'error') and attempts = ${row.attempts}
    returning id`;
  if (!claimed.length) return "omitido";
  try {
    if (patientNotice) {
      const [current] = await sql`
        select 1 from appointments a join clinic_notices n on n.appointment_id = a.id
        where n.id = ${row.id} and a.smile_reply_phone = n.phone
          and (n.kind <> 'smile_confirmado' or (a.status = 'confirmado' and a.smile_sync = 'ok' and a.starts_at > now()))`;
      if (!current) {
        await sql`update clinic_notices set status = 'vencido' where id = ${row.id}`;
        return "omitido";
      }
    }
    if (own && normalizePhone(own.phone) === row.phone) throw new Error("Es el mismo número de la línea de WhatsApp: cargá otro celular.");
    const send = () => wahaSendText(chatIdForPhone(row.phone), row.body);
    await (own ? withWahaConnection(own, send) : send());
    await sql`update clinic_notices set status = 'enviado', sent_at = now(), error = null where id = ${row.id}`;
    return "enviado";
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    if (patientNotice) {
      // WAHA no da una clave de idempotencia. Recepción verifica si el mensaje salió.
      await reviewSmileDelivery(row.id, message);
      return "error";
    }
    await sql`update clinic_notices set status = 'error', error = ${message} where id = ${row.id}`;
    console.error("Aviso al consultorio: no se pudo mandar", row.id, message);
    return "error";
  }
}

/**
 * Manda los avisos pendientes (de una clínica o de todas). Corre después de cada herramienta de Sofi
 * que cambia la agenda y con la automatización de cada 10 minutos (/api/automations/calendario).
 */
export async function sendPendingNotices(clinicId?: string): Promise<{ enviados: number; errores: number; vencidos: number }> {
  const uncertain = await sql<{ id: string }[]>`
    select id from clinic_notices where status = 'enviando' and attempted_at < now() - interval '1 minute'
      ${clinicId ? sql`and clinic_id = ${clinicId}` : sql``}`;
  for (const row of uncertain) await reviewSmileDelivery(row.id, "No hay confirmación de entrega de WhatsApp.");
  const expired = await sql`
    update clinic_notices set status = 'vencido'
    where status in ('pendiente', 'error') and (created_at < now() - interval '1 day' or attempts >= ${MAX_ATTEMPTS})
      ${clinicId ? sql`and clinic_id = ${clinicId}` : sql``}
    returning id`;
  const pending = await sql<NoticeRow[]>`
    select * from clinic_notices
    where status in ('pendiente', 'error') and attempts < ${MAX_ATTEMPTS}
      ${clinicId ? sql`and clinic_id = ${clinicId}` : sql``}
    order by created_at limit 50`;
  const result = { enviados: 0, errores: 0, vencidos: expired.length + uncertain.length };
  const clinics = new Map<string, Clinic | null>();
  for (const row of pending) {
    if (!clinics.has(row.clinic_id)) {
      const clinic = await getClinic(row.clinic_id).catch(() => null);
      // Sin línea o con el WhatsApp pausado se espera, sin gastar intentos.
      clinics.set(row.clinic_id, clinic && !noticeLine(clinic).problem ? clinic : null);
    }
    const clinic = clinics.get(row.clinic_id);
    if (!clinic) continue;
    const outcome = await sendOne(clinic, row);
    if (outcome === "enviado") result.enviados++;
    if (outcome === "error") result.errores++;
  }
  return result;
}

/** Manda los avisos después de responder; fuera de un pedido, quedan para la automatización. */
export function sendNoticesLater(clinicId: string): void {
  try {
    after(() => sendPendingNotices(clinicId).catch((e) => console.error("Avisos al consultorio", e instanceof Error ? e.message : e)));
  } catch {
    // Sin contexto de pedido: lo toma /api/automations/calendario.
  }
}

/** Panel: aviso de prueba a un celular, ahora mismo. Devuelve el error, si hubo. */
export async function sendTestNotice(clinicId: string, phoneId: string): Promise<{ ok: boolean; message: string }> {
  const clinic = await getClinic(clinicId);
  const [phone] = await sql<NoticePhone[]>`select * from clinic_notice_phones where id = ${phoneId} and clinic_id = ${clinicId}`;
  if (!phone) return { ok: false, message: "No encontré ese celular." };
  const line = noticeLine(clinic);
  if (line.problem) return { ok: false, message: line.problem };
  const [row] = await sql<NoticeRow[]>`
    insert into clinic_notices (clinic_id, phone, kind, body)
    values (${clinicId}, ${phone.phone}, 'prueba', ${testNoticeText(clinic.name, clinic.agent_name || "Sofi")})
    returning *`;
  const outcome = await sendOne(clinic, row);
  if (outcome === "enviado") return { ok: true, message: `Listo: le mandamos un aviso de prueba a ${phone.name}. Fijate que le haya llegado.` };
  const [saved] = await sql<NoticeRow[]>`select * from clinic_notices where id = ${row.id}`;
  return { ok: false, message: `No se pudo mandar: ${saved?.error ?? "error desconocido"}` };
}
