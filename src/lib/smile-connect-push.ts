import "server-only";
import { after } from "next/server";
import { syncPendingCalendar } from "./calendar/sync";
import { queueAppointmentNotice, sendPendingNotices } from "./clinic-notices";
import { json, sql, type TransactionSql } from "./db";
import { notifyN8n } from "./n8n";
import { displayPhone } from "./phone";
import {
  fitsFree,
  freeRanges,
  scAppointment,
  scAppointments,
  scAvailability,
  scCancelAppointment,
  scCreateAppointment,
  scCreatePatient,
  smileEmail,
  smileIdNumber,
  scRescheduleAppointment,
  SmileApiError,
  smileErrorText,
  smilePhone,
  splitName,
  type ScAppointment,
  type SmileClient,
} from "./smile-connect-api";
import { clientFor, findSmilePatient, getSmileApiConnection, isLiveSmileMode, SmileBudgetError, SmilePatientReview, writesEnabledOnServer, WRITE_MODES, type SmileApiConnection } from "./smile-connect-link";
import { healthLineOf, healthNoteLine, matchSmileService, smileAppointmentNote, withHealthLine, type SmileNoteHealth } from "./smile-connect-note";
import { humanSlot, localDateKey } from "./time";
import { confirmationBubbles } from "./whatsapp-style";
import type { Appointment, Patient, SmileManagement } from "./types";

// Escritura en Smile Connect de lo que hace Turnia (Sofi o el panel) con los turnos. Es la data
// operativa del consultorio, así que cada cambio:
// - va de a un turno, nunca en masa, y nunca devuelve a Smile Connect lo que vino de ahí;
// - se verifica contra Smile Connect justo antes (el turno sigue como Turnia lo conoce, el horario
//   sigue libre); si algo no coincide, no se toca y queda «para revisar»;
// - queda registrado con cómo estaba antes (smile_connect_changes), para poder deshacerlo a mano;
// - no se duplica aunque se reintente (Idempotency-Key por turno);
// - se frena solo si hay demasiados cambios en una hora.
// En modo «sombra», o sin SMILE_CONNECT_WRITES=on en el servidor, solo se registra lo que se haría.

const MAX_ATTEMPTS = 5;
const DEFERRED_ATTEMPTS = 3;
const SMILE_RATE_LIMIT_WAIT_SECONDS = 60;
const MAX_INLINE_RETRY_MS = 65_000;
/** Más que esto en una hora no es normal en un consultorio: se frena la escritura y se avisa. */
const MAX_WRITES_PER_HOUR = 15;
const ACTIVE = ["confirmado", "pendiente"];

type Row = {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_type_id: string;
  coverage: string | null;
  professional_id: string;
  second_professional_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  notes: string | null;
  title: string | null;
  external_id: string | null;
  external_status: string | null;
  replaced_by: string | null;
  smile_attempts: number;
  smile_deferred: boolean;
  smile_reply_phone: string | null;
  smile_management: SmileManagement | null;
  type_name: string;
  /** La prestación tal cual (type_name es el nombre propio del turno, si tiene). */
  base_type_name: string;
  patient_coverage: string | null;
  coverage_plan: string | null;
  member_number: string | null;
  smile_notes_refresh: boolean;
  smile_professional_id: number | null;
  smile_box_id: number | null;
  professional: string;
  timezone: string;
  agent_name: string;
  address: string | null;
  instructions: string | null;
};

type ManagedEffect = { before: Appointment; after: Appointment; request: SmileManagement };
type Outcome = { status: "ok" | "revisar" | "error" | "sombra" | "nada"; message?: string; confirmed?: Row; managed?: ManagedEffect };
type RateLimited = { status: "espera"; retryAt: string };

const scIdOf = (external: string | null) => {
  const m = /^sc:(\d+)$/.exec(external ?? "");
  return m ? Number(m[1]) : null;
};
const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

class Review extends Error {}
class SlotUnavailable extends Review {}
class VerificationPending extends Error {}

async function logChange(
  tx: TransactionSql,
  row: Pick<Row, "clinic_id" | "id">,
  action: "crear_paciente" | "crear" | "mover" | "cancelar" | "notas",
  status: "hecho" | "sombra" | "error" | "revisar",
  data: { request?: unknown; before?: unknown; result?: unknown; error?: string },
) {
  await tx`
    insert into smile_connect_changes (clinic_id, appointment_id, action, status, request, before, result, error)
    values (${row.clinic_id}, ${row.id}, ${action}, ${status}, ${data.request === undefined ? null : json(data.request)},
      ${data.before === undefined ? null : json(data.before)}, ${data.result === undefined ? null : json(data.result)}, ${data.error ?? null})`;
}

/** La ficha de salud más reciente del paciente, para la nota del turno. */
async function latestHealth(tx: TransactionSql, patientId: string): Promise<SmileNoteHealth | null> {
  const [form] = await tx<Array<{ data: SmileNoteHealth["data"] | null; completed_at: string | null }>>`
    select data, completed_at from patient_health_forms where patient_id = ${patientId} order by created_at desc limit 1`;
  return form?.data ? { data: form.data, completed: Boolean(form.completed_at) } : null;
}

/**
 * Lo que va con el turno nuevo, si la API lo acepta: la nota (prestación, obra social, plan y
 * afiliado, motivo y ficha de salud) y la prestación de Smile Connect que se llama igual.
 */
async function noteFields(tx: TransactionSql, row: Row, conn: SmileApiConnection): Promise<{ notes?: string; service_id?: number }> {
  const serviceId = matchSmileService(conn.api_services, [row.title, row.base_type_name]);
  const service = serviceId ? { service_id: serviceId } : {};
  if (!conn.api_supports_notes) return service;
  const notes = smileAppointmentNote({
    prestacion: row.type_name,
    source: row.source,
    agentName: row.agent_name,
    coverage: row.coverage,
    patient: { coverage: row.patient_coverage, coverage_plan: row.coverage_plan, member_number: row.member_number },
    motivo: row.notes,
    health: await latestHealth(tx, row.patient_id),
  });
  return { notes, ...service };
}

/**
 * Crea el turno en Smile Connect. Si rechaza la prestación, lo crea sin ella (igual va escrita en la
 * nota): la prestación nunca deja a un paciente sin turno. Devuelve también lo que se mandó.
 */
async function createInSmile(client: SmileClient, request: Parameters<typeof scCreateAppointment>[1], key: string) {
  try {
    return { result: await scCreateAppointment(client, request, key), sent: request };
  } catch (e) {
    if (request.service_id == null || !(e instanceof SmileApiError) || ![400, 422].includes(e.status)) throw e;
    const sent = { ...request };
    delete sent.service_id;
    return { result: await scCreateAppointment(client, sent, `${key}-sin-prestacion`), sent };
  }
}

/** Paciente de Smile Connect para este paciente de Turnia: vinculado, buscado por DNI o celular, o nuevo. */
async function smilePatientId(tx: TransactionSql, client: SmileClient, row: Row, real: boolean): Promise<number | null> {
  const [linked] = await tx<Array<{ external_id: string }>>`
    select external_id from patient_external_ids
    where clinic_id = ${row.clinic_id} and patient_id = ${row.patient_id} and external_id ~ '^sc:[0-9]+$'
    order by created_at desc limit 1`;
  if (linked) return scIdOf(linked.external_id);
  const [p] = await tx<Array<{ full_name: string | null; phone: string | null; dni: string | null; email: string | null }>>`
    select full_name, phone, dni, email from patients where id = ${row.patient_id}`;
  let found;
  try {
    found = await findSmilePatient(client, { dni: p?.dni ?? null, phone: p?.phone ?? null, name: p?.full_name ?? null });
  } catch (e) {
    if (e instanceof SmilePatientReview) throw new Review(e.message);
    throw e;
  }
  if (found) {
    await tx`
      insert into patient_external_ids (clinic_id, external_id, patient_id) values (${row.clinic_id}, ${`sc:${found.patient_id}`}, ${row.patient_id})
      on conflict (clinic_id, external_id) do nothing`;
    return found.patient_id;
  }
  const phone = smilePhone(p?.phone);
  const body = {
    ...splitName(p?.full_name),
    // Lo que Smile Connect no acepta se deja afuera: si no, rechaza el alta y el turno no se escribe.
    ...(smileIdNumber(p?.dni) && { id_number: smileIdNumber(p?.dni) }),
    ...(smileEmail(p?.email) && { email: smileEmail(p?.email) }),
    ...(phone ?? {}),
    ...(row.smile_professional_id && { professional_ids: [row.smile_professional_id] }),
  };
  if (!real) {
    await logChange(tx, row, "crear_paciente", "sombra", { request: body });
    return null;
  }
  const created = await scCreatePatient(client, body, `turnia-paciente-${row.patient_id}`);
  await tx`
    insert into patient_external_ids (clinic_id, external_id, patient_id) values (${row.clinic_id}, ${`sc:${created.patient_id}`}, ${row.patient_id})
    on conflict (clinic_id, external_id) do nothing`;
  await logChange(tx, row, "crear_paciente", "hecho", { request: body, result: created });
  return created.patient_id;
}

/** ¿Ese turno de Smile Connect es de este paciente? (Por los vínculos de la ficha.) */
async function belongsToPatient(tx: TransactionSql, row: Row, sc: ScAppointment): Promise<boolean> {
  const [hit] = await tx`
    select 1 from patient_external_ids
    where clinic_id = ${row.clinic_id} and patient_id = ${row.patient_id} and external_id = ${`sc:${sc.patient_id}`}`;
  return Boolean(hit);
}

/** Verificación antes de tocar un turno que ya está en Smile Connect: que siga como Turnia lo conoce. */
async function precheck(tx: TransactionSql, client: SmileClient, row: Row, scId: number, known: { starts_at: string; ends_at: string }) {
  let sc: ScAppointment;
  try {
    sc = await scAppointment(client, scId);
  } catch (e) {
    if (e instanceof SmileApiError && e.status === 404) throw new Review("Ese turno ya no está en Smile Connect.");
    throw e;
  }
  if (!(await belongsToPatient(tx, row, sc))) throw new Review("En Smile Connect ese turno figura a nombre de otro paciente. No se tocó.");
  if (!sc.cancelled && (!sameInstant(sc.start_date, known.starts_at) || !sameInstant(sc.end_date, known.ends_at))) {
    throw new Review("En Smile Connect ese turno cambió de horario mientras tanto. No se tocó.");
  }
  if (sc.professional_ids.length > 1) {
    throw new Review("En Smile Connect ese turno tiene dos profesionales: moverlo por la API le sacaría uno. Hacelo a mano.");
  }
  return sc;
}

/** ¿Sigue libre en Smile Connect? Al mover, el lugar que ocupa hoy el mismo turno cuenta como libre. */
async function assertFreeInSmile(client: SmileClient, row: Row, own?: ScAppointment) {
  const day = localDateKey(new Date(row.starts_at), row.timezone);
  const duration = (Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000;
  const slots = await scAvailability(client, day, duration, row.smile_professional_id!, row.smile_box_id ?? undefined);
  // Unir celdas de 5 min no demuestra que el proveedor acepte ese inicio para un turno de 30 min.
  if (slots.some((s) => s.professionalId === row.smile_professional_id
    && sameInstant(s.start, row.starts_at) && sameInstant(s.end, row.ends_at))) return;
  // La consulta de disponibilidad incluye el propio turno como ocupado. Se conserva la posibilidad
  // de mover dentro de ese mismo tramo, pero nunca se inventan inicios en otro hueco del día.
  const overlapsOwn = own && !own.cancelled && own.professional_ids[0] === row.smile_professional_id
    && Date.parse(row.starts_at) < Date.parse(own.end_date) && Date.parse(row.ends_at) > Date.parse(own.start_date);
  if (!overlapsOwn) throw new SlotUnavailable("Smile Connect no admite ese horario de inicio para la duración del turno. El turno original se conserva.");
  if (own && !own.cancelled && own.professional_ids[0] === row.smile_professional_id) {
    slots.push({ start: own.start_date, end: own.end_date, professionalId: row.smile_professional_id! });
  }
  const free = freeRanges(slots).get(row.smile_professional_id!) ?? [];
  if (!fitsFree(free, Date.parse(row.starts_at), Date.parse(row.ends_at))) {
    throw new SlotUnavailable("En Smile Connect ese horario ya está ocupado o bloqueado: el turno quedó solo en Turnia. Revisalo con el paciente.");
  }
}

function describe(row: Pick<Row, "starts_at" | "professional" | "timezone">): string {
  const d = new Date(row.starts_at);
  const day = new Intl.DateTimeFormat("es-AR", { timeZone: row.timezone, weekday: "long", day: "numeric", month: "numeric" }).format(d);
  const hour = new Intl.DateTimeFormat("es-AR", { timeZone: row.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day} ${hour} con ${row.professional}`;
}

async function processRow(tx: TransactionSql, conn: SmileApiConnection, client: SmileClient, row: Row, verifyCreation = false): Promise<Outcome> {
  const real = writesEnabledOnServer() && conn.api_mode !== "sombra";
  const scId = scIdOf(row.external_id);
  const times = (r: Row) => ({
    professional_id: r.smile_professional_id!,
    box_id: r.smile_box_id!,
    start_date: new Date(r.starts_at).toISOString(),
    end_date: new Date(r.ends_at).toISOString(),
  });

  // Turno movido: el viejo lo resuelve el nuevo (que mueve el de Smile Connect).
  if (row.status === "reprogramado" && row.replaced_by) {
    const [next] = await tx`select 1 from appointments where id = ${row.replaced_by}`;
    if (next) return { status: "nada" };
  }

  // Cancelado (o movido sin turno nuevo): se cancela en Smile Connect.
  if (row.status === "cancelado" || row.status === "reprogramado") {
    if (!scId) return { status: "nada" };
    if (conn.api_mode === "crear") throw new Review(`Cancelalo a mano en Smile Connect: ${describe(row)}.`);
    const before = await precheck(tx, client, row, scId, row);
    if (before.cancelled) return { status: "ok" };
    if (!real) {
      await logChange(tx, row, "cancelar", "sombra", { request: { appointment_id: scId }, before });
      return { status: "sombra" };
    }
    const result = await scCancelAppointment(client, scId);
    await logChange(tx, row, "cancelar", "hecho", { request: { appointment_id: scId }, before, result });
    return { status: "ok" };
  }

  // Atendido o ausente: la API no los registra.
  if (!ACTIVE.includes(row.status)) return { status: "ok" };
  if (Date.parse(row.ends_at) <= Date.now()) return { status: "nada" };
  if (!row.smile_professional_id || !row.smile_box_id) {
    throw new Review(`${row.professional} no está vinculado con un profesional y un consultorio de Smile Connect. Cargá el turno a mano: ${describe(row)}.`);
  }
  if (row.second_professional_id) {
    throw new Review(`El turno tiene dos profesionales y Smile Connect acepta uno por la API. Cargalo a mano: ${describe(row)}.`);
  }

  if (row.smile_deferred && row.status === "pendiente") {
    if (!real) throw new Review("La escritura en Smile Connect está deshabilitada.");
    await processDeferredBooking(tx, client, conn, row, scId);
    return { status: "ok" };
  }

  // ¿Es el turno nuevo de uno que se movió? Entonces se mueve el de Smile Connect.
  const [previous] = scId ? [] : await tx<Row[]>`
    select a.*, '' as type_name from appointments a
    where a.replaced_by = ${row.id} and a.clinic_id = ${row.clinic_id} and a.external_id ~ '^sc:[0-9]+$'`;
  const moving = scId ?? scIdOf(previous?.external_id ?? null);
  if (moving) {
    if (conn.api_mode === "crear") {
      throw new Review(`Movelo a mano en Smile Connect: ${previous ? `de ${describe({ ...row, starts_at: previous.starts_at })} ` : ""}a ${describe(row)}.`);
    }
    const before = await precheck(tx, client, row, moving, previous ? { starts_at: previous.starts_at, ends_at: previous.ends_at } : row);
    if (before.cancelled) throw new Review("En Smile Connect ese turno ya estaba cancelado. No se movió: revisalo.");
    const sameTimes = sameInstant(before.start_date, row.starts_at) && sameInstant(before.end_date, row.ends_at) && before.professional_ids[0] === row.smile_professional_id;
    if (!sameTimes) {
      await assertFreeInSmile(client, row, before);
      // Mover no reescribe la nota: puede tener lo que sumó recepción.
      const request = times(row);
      if (!real) {
        await logChange(tx, row, "mover", "sombra", { request: { appointment_id: moving, ...request }, before });
        return { status: "sombra" };
      }
      const result = await scRescheduleAppointment(client, moving, request);
      await logChange(tx, row, "mover", "hecho", { request: { appointment_id: moving, ...request }, before, result });
    }
    if (previous) {
      // El turno de Smile Connect ahora es este: se pasa el vínculo del viejo al nuevo.
      await tx`update appointments set external_id = null, smile_sync = 'ok', smile_error = null where id = ${previous.id}`;
      await tx`update appointments set external_id = ${previous.external_id}, external_status = ${previous.external_status} where id = ${row.id}`;
    }
    return { status: "ok" };
  }

  // Turno nuevo.
  const patientId = await smilePatientId(tx, client, row, real);
  await assertFreeInSmile(client, row);
  const request = { patient_id: patientId ?? 0, ...times(row), ...(await noteFields(tx, row, conn)) };
  if (!real || !patientId) {
    await logChange(tx, row, "crear", "sombra", { request });
    return { status: "sombra" };
  }
  const { result, sent } = await createInSmile(client, { ...request, patient_id: patientId }, `turnia-turno-${row.id}`);
  if (!Number.isSafeInteger(result?.appointment_id) || result.appointment_id <= 0) {
    throw new Review("Smile Connect no devolvió un número de turno válido.");
  }
  await tx`update appointments set external_id = ${`sc:${result.appointment_id}`} where id = ${row.id}`;
  await logChange(tx, row, "crear", "hecho", { request: sent, result });
  if (verifyCreation) await verifyNewAppointment(tx, client, row, result.appointment_id, patientId);
  return { status: "ok" };
}

function matchesNewAppointment(appointment: ScAppointment, row: Row, patientId: number) {
  return appointment.patient_id === patientId && appointment.professional_ids.length === 1
    && appointment.professional_ids[0] === row.smile_professional_id && appointment.box_id === row.smile_box_id
    && sameInstant(appointment.start_date, row.starts_at) && sameInstant(appointment.end_date, row.ends_at);
}

async function liveAppointmentsNear(client: SmileClient, row: Row) {
  const start = Date.parse(row.starts_at);
  const end = Date.parse(row.ends_at);
  return (await scAppointments(client, new Date(start - 86400_000), new Date(end), 25))
    .filter((a) => !a.cancelled && a.attendance !== "Canceled with Notice");
}

async function processDeferredBooking(tx: TransactionSql, client: SmileClient, conn: SmileApiConnection, row: Row, knownId: number | null) {
  if (Date.parse(row.starts_at) <= Date.now()) throw new Review("El horario pedido ya pasó.");
  const patientId = await smilePatientId(tx, client, row, true);
  if (!patientId) throw new Review("No pude identificar al paciente en Smile Connect.");
  let id = knownId;
  let createdByTurnia = false;
  if (id) {
    const [record] = await tx`
      select 1 from smile_connect_changes where appointment_id = ${row.id} and action = 'crear' and status = 'hecho'
        and result->>'appointment_id' = ${String(id)} limit 1`;
    createdByTurnia = Boolean(record);
  }
  if (!id) {
    try {
      await assertFreeInSmile(client, row);
    } catch (e) {
      if (!(e instanceof SlotUnavailable)) throw e;
      // Un POST anterior pudo haberse aplicado aunque Turnia haya perdido la respuesta.
      const matches = (await liveAppointmentsNear(client, row)).filter((a) => matchesNewAppointment(a, row, patientId));
      if (matches.length > 1) throw new Review("Hay más de un turno del paciente en el horario pedido. Recepción debe comprobarlo.");
      if (!matches.length) throw e;
      id = matches[0].appointment_id;
    }
    if (!id) {
      const request = {
        patient_id: patientId, professional_id: row.smile_professional_id!, box_id: row.smile_box_id!,
        start_date: new Date(row.starts_at).toISOString(), end_date: new Date(row.ends_at).toISOString(), ...(await noteFields(tx, row, conn)),
      };
      const { result, sent } = await createInSmile(client, request, `turnia-turno-${row.id}`);
      if (!Number.isSafeInteger(result?.appointment_id) || result.appointment_id <= 0) {
        throw new Review("Smile Connect no devolvió un número de turno válido.");
      }
      id = result.appointment_id;
      createdByTurnia = true;
      await logChange(tx, row, "crear", "hecho", { request: sent, result });
      await tx`update appointments set external_id = ${`sc:${id}`} where id = ${row.id}`;
    }
  }
  await verifyNewAppointment(tx, client, row, id, patientId, createdByTurnia);
  if (!knownId && !createdByTurnia) await tx`update appointments set external_id = ${`sc:${id}`} where id = ${row.id}`;
}

async function verifyNewAppointment(tx: TransactionSql, client: SmileClient, row: Row, id: number, patientId: number, canUndo = true) {
  const start = Date.parse(row.starts_at);
  const end = Date.parse(row.ends_at);
  const appointments = await liveAppointmentsNear(client, row);
  const own = appointments.find((a) => a.appointment_id === id);
  if ((row.smile_deferred && !own) || (row.smile_management && (!own || !matchesNewAppointment(own, row, patientId)))) {
    throw new VerificationPending("Todavía no se pudo verificar el turno actualizado en Smile Connect.");
  }
  if (!own || !matchesNewAppointment(own, row, patientId)) {
    throw new Review("Hay un alta en Smile Connect que recepción tiene que comprobar antes de confirmar.");
  }
  const overlap = appointments.some((a) => a.appointment_id !== id && a.professional_ids.includes(own.professional_ids[0])
    && Date.parse(a.start_date) < end && Date.parse(a.end_date) > start);
  if (!overlap) return;
  if (!canUndo) throw new Review("El turno recuperado se superpone con otro. Recepción tiene que revisar la agenda.");
  // Si recepción tomó el horario mientras se creaba, se revierte solo el alta que acabamos de verificar.
  const undone = await scCancelAppointment(client, id);
  if (undone?.appointment_id !== id) throw new Review("Hay un turno superpuesto que recepción tiene que revisar en Smile Connect.");
  await logChange(tx, row, "cancelar", "hecho", { request: { appointment_id: id }, before: own, result: undone });
  await tx`update appointments set status = 'cancelado', cancelled_at = now() where id = ${row.id}`;
  throw new SlotUnavailable("Otro turno ocupó ese horario en Smile Connect. Se revirtió el alta de Turnia.");
}

/** Aviso al consultorio (si cargó celulares) cuando algo quedó para hacer a mano. */
async function noticeReview(tx: TransactionSql, row: Row, message: string) {
  const phones = await tx<Array<{ phone: string }>>`select phone from clinic_notice_phones where clinic_id = ${row.clinic_id}`;
  if (!phones.length) return;
  const [p] = await tx<Array<{ full_name: string | null; phone: string | null }>>`select full_name, phone from patients where id = ${row.patient_id}`;
  const body = [
    "⚠️ *Revisar en Smile Connect*",
    message,
    `Paciente: ${[p?.full_name ?? "sin nombre", p?.phone ? displayPhone(p.phone) : null].filter(Boolean).join(" · ")}`,
    "",
    "_Aviso automático de Turnia._",
  ].join("\n");
  await tx`insert into clinic_notices ${tx(phones.map((x) => ({ clinic_id: row.clinic_id, phone: x.phone, kind: "smile", appointment_id: row.id, body })))}`;
}

async function pendingRow(tx: TransactionSql, id: string, skipLocked = false, notesRefresh = false) {
  const [row] = await tx<Row[]>`
    select a.id, a.clinic_id, a.patient_id, a.appointment_type_id, a.coverage, a.professional_id, a.second_professional_id, a.starts_at, a.ends_at, a.status, a.source,
           a.notes, a.title, a.external_id, a.external_status, a.replaced_by, a.smile_attempts,
           a.smile_deferred, a.smile_reply_phone, a.smile_management, coalesce(a.title, t.name) as type_name, t.instructions,
           t.name as base_type_name, pt.coverage as patient_coverage, pt.coverage_plan, pt.member_number, a.smile_notes_refresh,
           p.smile_professional_id, p.smile_box_id, p.full_name as professional, c.timezone, c.agent_name, c.address
    from appointments a
      join appointment_types t on t.id = a.appointment_type_id
      join professionals p on p.id = a.professional_id
      join clinics c on c.id = a.clinic_id
      left join patients pt on pt.id = a.patient_id
    where a.id = ${id} and ${notesRefresh ? tx`a.smile_notes_refresh and a.smile_sync = 'ok'` : tx`a.smile_sync in ('pendiente', 'error')`}
    for update of a ${skipLocked ? tx`skip locked` : tx``}`;
  return row;
}

/** Confirma una sola alta dentro de la transacción que reservó el horario en Turnia. */
export async function confirmNewSmileAppointment(tx: TransactionSql, clinicId: string, id: string): Promise<string | null> {
  await tx`select set_config('turnia.smile_quiet', 'on', true)`;
  const row = await pendingRow(tx, id);
  try {
    const conn = await getSmileApiConnection(clinicId, tx);
    if (!row || row.clinic_id !== clinicId || row.status !== "pendiente" || !conn?.api_key_encrypted
        || !writesEnabledOnServer() || !isLiveSmileMode(conn.api_mode) || conn.api_writes_paused) {
      throw new Review("La escritura en Smile Connect no está disponible.");
    }
    const [{ n }] = await tx<Array<{ n: number }>>`
      select count(*)::int as n from smile_connect_changes
      where clinic_id = ${clinicId} and status = 'hecho' and created_at > now() - interval '1 hour'`;
    if (n >= MAX_WRITES_PER_HOUR) {
      const reason = "Se frenó la escritura en Smile Connect por el límite de cambios por hora.";
      await tx`update smile_connect_connections set api_writes_paused = ${reason} where clinic_id = ${clinicId}`;
      throw new Review(reason);
    }
    const deadline = Date.now() + 8_000;
    const client: SmileClient = {
      request: (path, req) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Review("Venció el plazo para confirmar el turno en Smile Connect.");
        return clientFor(conn, Math.min(remaining, 3_000), tx, { forWrites: true }).request(path, req);
      },
    };
    const result = await processRow(tx, conn, client, row, true);
    if (result.status !== "ok") throw new Review("Smile Connect no confirmó el turno.");
    await tx`update appointments set status = 'confirmado', smile_sync = 'ok', smile_error = null where id = ${id}`;
    return null;
  } catch (e) {
    const message = smileErrorText(e).slice(0, 300);
    await tx`update appointments set smile_sync = 'revisar', smile_error = ${message} where id = ${id}`;
    if (row) {
      await logChange(tx, row, "crear", "revisar", { error: message });
      await noticeReview(tx, row, message);
    }
    return message;
  }
}

/**
 * Escribe en Smile Connect lo pendiente de una clínica (de a un turno, con su verificación).
 * Corre después de los cambios y con la automatización de cada 10 minutos.
 */
async function finishDeferredBooking(tx: TransactionSql, row: Row, resolution: "confirmed" | "occupied" | "review", reason?: string) {
  const when = humanSlot(new Date(row.starts_at), row.timezone);
  const confirmed = resolution === "confirmed";
  if (confirmed) {
    await tx`update appointments set status = 'confirmado', smile_sync = 'ok', smile_error = null where id = ${row.id}`;
    await tx`
      update waitlist set status = 'resuelta' where patient_id = ${row.patient_id}
        and appointment_type_id = (select appointment_type_id from appointments where id = ${row.id})
        and appointment_id is null and status in ('activa', 'ofrecida')`;
  } else if (resolution === "occupied") {
    await tx`
      update appointments set status = 'cancelado', cancelled_at = coalesce(cancelled_at, now()), smile_sync = null, smile_error = null
      where id = ${row.id}`;
  } else {
    await tx`
      insert into tasks (clinic_id, patient_id, type, title, details)
      values (${row.clinic_id}, ${row.patient_id}, 'derivacion_humana', 'Revisar turno en Smile Connect',
        ${`Pedido ${row.id} para ${when} con ${row.professional}. ${reason ?? ""}`})`;
  }
  if (!row.smile_reply_phone) return;
  // Cada párrafo llega en su burbuja (ver clinic-notices.ts): la confirmación, la dirección, las indicaciones y el cierre.
  const body = confirmed
    ? confirmationBubbles({
        startsAt: new Date(row.starts_at), timeZone: row.timezone, professional: row.professional, typeName: row.type_name,
        address: row.address, instructions: row.instructions,
      }).join("\n\n")
    : resolution === "occupied"
      ? `El horario del ${when} con ${row.professional} ya no está disponible. Si querés, respondé este mensaje y te busco otro horario.`
      : `Tu pedido para ${when} con ${row.professional} sigue pendiente. Lo dejamos a recepción para que pueda revisarlo.`;
  await tx`
    insert into clinic_notices (clinic_id, phone, kind, appointment_id, body)
    values (${row.clinic_id}, ${row.smile_reply_phone}, ${confirmed ? "smile_confirmado" : "smile_paciente"}, ${row.id}, ${body})`;
}

async function deferredConfirmationEffects(row: Row) {
  const [appointment] = await sql<Appointment[]>`select * from appointments where id = ${row.id} and status = 'confirmado'`;
  if (!appointment) return;
  const [patient] = await sql<Patient[]>`select * from patients where id = ${row.patient_id}`;
  if (patient) await notifyN8n("turno.reservado", {
    clinic_id: row.clinic_id, appointment, patient, professional: row.professional, type: row.type_name,
  });
  if (row.smile_reply_phone) await queueAppointmentNotice(row.clinic_id, "nuevo", { ids: [row.id] });
}

async function finishManagementNotice(tx: TransactionSql, row: Row, request: SmileManagement, body: string,
  kind: "smile_paciente" | "smile_confirmado" | "smile_cancelado", appointmentId = row.id) {
  if (!request.replyPhone) return;
  await tx`
    insert into clinic_notices (clinic_id, phone, kind, appointment_id, body)
    values (${row.clinic_id}, ${request.replyPhone}, ${kind}, ${appointmentId}, ${body})`;
}

const cancelledInSmile = (a: ScAppointment) => a.cancelled || a.attendance === "Canceled with Notice";

async function processSmileManagement(tx: TransactionSql, client: SmileClient, row: Row, request: SmileManagement): Promise<ManagedEffect> {
  const id = scIdOf(row.external_id);
  if (!id || !ACTIVE.includes(row.status) || Date.parse(row.ends_at) <= Date.now()) {
    throw new Review("El turno original ya no está vigente o perdió su vínculo con Smile Connect.");
  }
  const [before] = await tx<Appointment[]>`select * from appointments where id = ${row.id}`;
  const remote = await scAppointment(client, id);
  if (!(await belongsToPatient(tx, row, remote)) || remote.professional_ids.length !== 1) {
    throw new Review("Smile Connect cambió el paciente o los profesionales del turno. Recepción debe revisarlo.");
  }
  const stillOriginal = remote.professional_ids[0] === row.smile_professional_id
    && sameInstant(remote.start_date, row.starts_at) && sameInstant(remote.end_date, row.ends_at);

  if (request.operation === "cancelar") {
    // La baja de la API libera la agenda. Una marca de asistencia sola puede seguir ocupando el horario.
    if (!remote.cancelled) {
      if (!stillOriginal) throw new Review("Smile Connect muestra el turno en otro horario. Recepción debe revisarlo.");
      await scCancelAppointment(client, id);
      if (!(await scAppointment(client, id)).cancelled) throw new VerificationPending("Smile Connect todavía no muestra el turno cancelado.");
    }
    const notes = [row.notes, request.reason && `Cancelado: ${request.reason}`].filter(Boolean).join(" | ");
    const [after] = await tx<Appointment[]>`
      update appointments set status = 'cancelado', cancelled_at = now(), cancelled_via = ${request.via}, notes = ${notes || null},
        smile_management = null, smile_sync = 'ok', smile_error = null, external_status = 'Canceled with Notice'
      where id = ${row.id} returning *`;
    await tx`update waitlist set status = 'cancelada' where appointment_id = ${row.id} and status in ('activa', 'ofrecida')`;
    await logChange(tx, row, "cancelar", "hecho", { request: { appointment_id: id }, before: remote });
    await finishManagementNotice(tx, row, request,
      `Cancelación confirmada. El turno del ${describe(row)} quedó cancelado.`, "smile_cancelado");
    return { before, after, request };
  }

  if (cancelledInSmile(remote)) throw new Review("El turno original aparece cancelado en Smile Connect.");
  const [professional] = await tx<Array<{ full_name: string; smile_professional_id: number | null; smile_box_id: number | null }>>`
    select full_name, smile_professional_id, smile_box_id from professionals
    where id = ${request.professionalId} and clinic_id = ${row.clinic_id} and active`;
  if (!professional?.smile_professional_id || !professional.smile_box_id || Date.parse(request.startsAt) <= Date.now()) {
    throw new Review("El nuevo horario o su profesional ya no está disponible para reprogramar.");
  }
  for (const professionalId of [...new Set([row.professional_id, request.professionalId])].sort()) {
    await tx`select pg_advisory_xact_lock(hashtextextended(${professionalId}::text, 0))`;
  }
  const [overlap] = await tx`
    select 1 from appointments where clinic_id = ${row.clinic_id} and id <> ${row.id} and status = any(${ACTIVE}::text[])
      and starts_at < ${request.endsAt} and ends_at > ${request.startsAt}
      and (patient_id = ${row.patient_id} or professional_id = ${request.professionalId} or second_professional_id = ${request.professionalId}) limit 1`;
  const target = { ...row, starts_at: request.startsAt, ends_at: request.endsAt, professional: professional.full_name,
    smile_professional_id: professional.smile_professional_id, smile_box_id: professional.smile_box_id,
  };
  if (overlap) {
    if (stillOriginal) throw new SlotUnavailable("Otro turno ocupó el horario pedido.");
    throw new Review("El horario pedido se superpone en Turnia y Smile Connect ya muestra un cambio. Recepción debe revisarlo.");
  }
  const payload = { professional_id: professional.smile_professional_id, box_id: professional.smile_box_id, start_date: request.startsAt, end_date: request.endsAt };
  if (!matchesNewAppointment(remote, target, remote.patient_id)) {
    if (!stillOriginal) throw new Review("Smile Connect muestra un cambio distinto del pedido. Recepción debe revisarlo.");
    await assertFreeInSmile(client, target, remote);
    try {
      await scRescheduleAppointment(client, id, payload);
    } catch (e) {
      // Otro turno puede ocupar el hueco entre la lectura y la escritura. Solo se ofrece buscar
      // otra opción si una nueva lectura comprueba que el turno original sigue intacto.
      if (e instanceof SmileApiError && e.status === 409 && e.code === "slot_unavailable") {
        const latest = await scAppointment(client, id);
        if (!cancelledInSmile(latest) && latest.patient_id === remote.patient_id
          && latest.box_id === remote.box_id && latest.professional_ids.length === 1
          && latest.professional_ids[0] === remote.professional_ids[0]
          && sameInstant(latest.start_date, remote.start_date) && sameInstant(latest.end_date, remote.end_date)) {
          throw new SlotUnavailable(smileErrorText(e));
        }
      }
      throw e;
    }
  }
  await verifyNewAppointment(tx, client, target, id, remote.patient_id, false);
  await tx`
    update appointments set status = 'reprogramado', cancelled_at = now(), cancelled_via = ${request.via},
      external_id = null, smile_management = null, smile_sync = 'ok', smile_error = null where id = ${row.id}`;
  const [after] = await tx<Appointment[]>`
    insert into appointments (clinic_id, patient_id, appointment_type_id, professional_id, starts_at, ends_at, status,
      source, notes, title, coverage, external_id, external_status, smile_sync, smile_reply_phone)
    values (${row.clinic_id}, ${row.patient_id}, ${row.appointment_type_id}, ${request.professionalId}, ${request.startsAt}, ${request.endsAt},
      'confirmado', ${request.replyPhone ? request.via : row.source}, ${row.notes}, ${row.title}, ${request.coverage},
      ${row.external_id}, ${row.external_status}, 'ok', ${request.replyPhone}) returning *`;
  await tx`update appointments set replaced_by = ${after.id} where id = ${row.id}`;
  await tx`update waitlist set appointment_id = ${after.id} where appointment_id = ${row.id} and status in ('activa', 'ofrecida')`;
  await logChange(tx, row, "mover", "hecho", { request: { appointment_id: id, ...payload }, before: remote });
  await finishManagementNotice(tx, row, request,
    `Reprogramación confirmada. Tu turno quedó para el ${describe(target)}.`, "smile_confirmado", after.id);
  return { before, after, request };
}

async function managedConfirmationEffects({ before, after, request }: ManagedEffect) {
  const [patient] = await sql<Patient[]>`select * from patients where id = ${before.patient_id}`;
  if (!patient) return;
  if (request.operation === "mover") {
    await notifyN8n("turno.reprogramado", { clinic_id: before.clinic_id, before, after, patient });
    if (request.replyPhone) await queueAppointmentNotice(before.clinic_id, "movido", { ids: [after.id], beforeId: before.id });
  } else {
    await notifyN8n("turno.cancelado", { clinic_id: before.clinic_id, appointment: before, patient, motivo: request.reason, cancelado_por: request.via === "panel" ? "clinica" : "paciente" });
    if (request.replyPhone) await queueAppointmentNotice(before.clinic_id, "cancelado", { ids: [before.id], reason: request.reason });
  }
  // Los pedidos de los pacientes ofrecen el horario liberado por el flujo habitual de lista de espera.
  if (request.via !== "panel") {
    const [{ offerFreedSlot }, { getClinic }] = await Promise.all([import("./agent/service"), import("./clinic")]);
    await offerFreedSlot(await getClinic(before.clinic_id), before);
  }
}

export async function pushPendingSmile(clinicId: string, appointmentId?: string): Promise<Record<string, number | string>> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || !WRITE_MODES.includes(conn.api_mode)) return { omitido: "La escritura está apagada." };
  if (conn.api_retry_at && Date.parse(conn.api_retry_at) > Date.now()) return { reintentar_en: conn.api_retry_at };
  const pending = await sql<Array<{ id: string }>>`
    select id from appointments
    where clinic_id = ${clinicId} and smile_sync in ('pendiente', 'error') and smile_attempts < ${MAX_ATTEMPTS}
      ${appointmentId ? sql`and id = ${appointmentId} and (smile_deferred or smile_management is not null)` : sql``}
      ${conn.api_writes_paused ? sql`and ((smile_deferred and status = 'pendiente') or smile_management is not null)` : sql``}
    order by ((smile_deferred and status = 'pendiente') or smile_management is not null) desc, created_at limit 20`;
  const result: { ok: number; sombra: number; revisar: number; error: number; frenado?: string } = { ok: 0, sombra: 0, revisar: 0, error: 0 };
  let pauseReason = conn.api_writes_paused;
  for (const { id } of pending) {
    const outcome = await sql.begin(async (tx): Promise<Outcome | RateLimited | null> => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`smile-connect:${clinicId}`}, 0))`;
      const current = await getSmileApiConnection(clinicId, tx);
      if (current?.api_mode !== conn.api_mode || current.api_key_encrypted !== conn.api_key_encrypted) return null;
      if (current.api_retry_at && Date.parse(current.api_retry_at) > Date.now()) {
        return { status: "espera", retryAt: current.api_retry_at };
      }
      pauseReason = current.api_writes_paused;
      if (!pauseReason) {
        const [{ n }] = await tx<Array<{ n: number }>>`
          select count(*)::int as n from smile_connect_changes
          where clinic_id = ${clinicId} and status = 'hecho' and created_at > now() - interval '1 hour'`;
        if (n >= MAX_WRITES_PER_HOUR) {
          pauseReason = `Se frenó la escritura en Smile Connect: hubo ${n} cambios en la última hora. Revisá el registro y reanudala.`;
          await tx`update smile_connect_connections set api_writes_paused = ${pauseReason} where clinic_id = ${clinicId}`;
        }
      }
      await tx`select set_config('turnia.smile_quiet', 'on', true)`;
      const row = await pendingRow(tx, id, true);
      if (!row) return null;
      const deferred = row.smile_deferred && row.status === "pendiente";
      const management = row.smile_management;
      if (pauseReason && !deferred && !management) return null;
      try {
        if (pauseReason) throw new Review(pauseReason);
        const client = clientFor(current, undefined, tx, { forWrites: true });
        if (management) {
          if (!writesEnabledOnServer() || current.api_mode !== "completa") throw new Review("La gestión en Smile Connect está deshabilitada.");
          return { status: "ok", managed: await processSmileManagement(tx, client, row, management) } as Outcome;
        }
        const out = await processRow(tx, current, client, row);
        if (deferred) {
          if (out.status !== "ok") throw new Review("El horario pedido ya pasó o Smile Connect no lo confirmó.");
          await finishDeferredBooking(tx, row, "confirmed");
          return { ...out, confirmed: row };
        }
        await tx`
          update appointments set smile_sync = ${out.status === "nada" ? null : "ok"}, smile_error = null
          where id = ${row.id}`;
        return out;
      } catch (e) {
        // El proveedor pudo aplicar el cambio antes de limitar la lectura de verificación.
        // La espera es de la clínica y no consume un intento de la operación.
        if ((e instanceof SmileApiError && e.status === 429) || e instanceof SmileBudgetError) {
          const retryAt = new Date();
          if (e instanceof SmileBudgetError) {
            retryAt.setUTCHours(24, 0, 0, 0);
          } else {
            const seconds = Math.max(1, e.retryAfter ?? SMILE_RATE_LIMIT_WAIT_SECONDS);
            retryAt.setTime(retryAt.getTime() + seconds * 1_000);
          }
          const until = retryAt.toISOString();
          await tx`update smile_connect_connections set api_retry_at = ${until} where clinic_id = ${clinicId}`;
          await tx`update appointments set smile_sync = 'pendiente', smile_error = ${smileErrorText(e)} where id = ${row.id}`;
          return { status: "espera", retryAt: until };
        }
        const review = e instanceof Review || (e instanceof SmileApiError && !e.transient)
          || ((deferred || management) && row.smile_attempts + 1 >= DEFERRED_ATTEMPTS);
        const message = (e instanceof Review ? e.message : smileErrorText(e)).slice(0, 300);
        await tx`
          update appointments set smile_sync = ${review ? "revisar" : "error"}, smile_error = ${message}, smile_attempts = smile_attempts + 1
          where id = ${row.id}`;
        if (review) {
          await logChange(tx, row, management?.operation ?? (row.status === "cancelado" ? "cancelar" : row.external_id ? "mover" : "crear"),
            "revisar", { error: message, ...(management && { request: management }) });
          if (management) {
            await tx`update appointments set smile_management = null where id = ${row.id}`;
            if (e instanceof SlotUnavailable) {
              await tx`update appointments set smile_sync = 'ok', smile_error = null where id = ${row.id}`;
              await finishManagementNotice(tx, row, management,
                "Ese horario ya no está disponible. El turno original sigue reservado. Respondé este mensaje si querés buscar otro horario.", "smile_paciente");
            } else {
              const detail = management.operation === "mover" ? `Horario solicitado: ${humanSlot(new Date(management.startsAt), row.timezone)}. ` : "";
              await tx`
                insert into tasks (clinic_id, patient_id, type, title, details)
                values (${row.clinic_id}, ${row.patient_id}, 'derivacion_humana', 'Revisar cambio de turno en Smile Connect',
                  ${`Pedido de ${management.operation} el turno ${row.id}. ${detail}${message}`})`;
              await finishManagementNotice(tx, row, management, "Recepción ya tiene tu pedido para revisarlo. Te avisarán cuando quede resuelto.", "smile_paciente");
              if (management.via !== "panel") await noticeReview(tx, row, message);
            }
          } else if (deferred) {
            await finishDeferredBooking(tx, row, e instanceof SlotUnavailable ? "occupied" : "review", message);
            if (row.source !== "panel" && !(e instanceof SlotUnavailable)) await noticeReview(tx, row, message);
          } else await noticeReview(tx, row, message);
        }
        return { status: review ? "revisar" : "error", message } as Outcome;
      }
    });
    if (!outcome) continue;
    if (outcome.status === "espera") return { ...result, reintentar_en: outcome.retryAt };
    if (outcome.confirmed) await deferredConfirmationEffects(outcome.confirmed).catch((e) =>
      console.error("Avisar sobre el turno confirmado en Smile Connect", e));
    if (outcome.managed) await managedConfirmationEffects(outcome.managed).catch((e) =>
      console.error("Avisar sobre el cambio confirmado en Smile Connect", e));
    if (outcome.status === "ok") result.ok++;
    if (outcome.status === "sombra") result.sombra++;
    if (outcome.status === "revisar") result.revisar++;
    if (outcome.status === "error") result.error++;
  }
  if (pauseReason) result.frenado = pauseReason;
  else if (!appointmentId) {
    const waiting = await refreshHealthNotes(clinicId, result);
    if (waiting) return { ...result, reintentar_en: waiting.retryAt };
  }
  return result;
}

/** La línea de la ficha de salud que Turnia mandó por última vez en la nota de ese turno. */
async function lastSentHealthLine(tx: TransactionSql, appointmentId: string): Promise<string | null> {
  const sent = await tx<Array<{ notes: string | null }>>`
    select request->>'notes' as notes from smile_connect_changes
    where appointment_id = ${appointmentId} and action in ('crear', 'notas') and status = 'hecho' and request ? 'notes'
    order by created_at desc limit 5`;
  for (const { notes } of sent) {
    const line = healthLineOf(notes);
    if (line) return line;
  }
  return null;
}

/**
 * La ficha de salud se completa casi siempre después de dar el turno (Sofi la ofrece al confirmarlo).
 * En los próximos turnos que dio Turnia y ya están en Smile Connect, se suma esa línea a la nota:
 * de a uno, verificando antes que el turno siga igual, y sin borrar nada de lo que escribió recepción.
 */
async function refreshHealthNotes(
  clinicId: string,
  result: { ok: number; sombra: number; revisar: number; error: number },
): Promise<RateLimited | null> {
  const pending = await sql<Array<{ id: string }>>`
    select id from appointments
    where clinic_id = ${clinicId} and smile_notes_refresh and smile_sync = 'ok' and source <> 'smile_connect'
      and external_id ~ '^sc:[0-9]+$' and status in ('confirmado', 'pendiente') and starts_at > now()
    order by starts_at limit 10`;
  for (const { id } of pending) {
    const outcome = await sql.begin(async (tx): Promise<Outcome | RateLimited | null> => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`smile-connect:${clinicId}`}, 0))`;
      const conn = await getSmileApiConnection(clinicId, tx);
      // Sumar a la nota es cambiar un turno: solo en el modo que mueve y cancela, y con notas en la API.
      if (!conn?.api_key_encrypted || conn.api_mode !== "completa" || !conn.api_supports_notes || conn.api_writes_paused) return null;
      if (conn.api_retry_at && Date.parse(conn.api_retry_at) > Date.now()) return { status: "espera", retryAt: conn.api_retry_at };
      const [{ n }] = await tx<Array<{ n: number }>>`
        select count(*)::int as n from smile_connect_changes
        where clinic_id = ${clinicId} and status = 'hecho' and created_at > now() - interval '1 hour'`;
      if (n >= MAX_WRITES_PER_HOUR) return null;
      await tx`select set_config('turnia.smile_quiet', 'on', true)`;
      const row = await pendingRow(tx, id, true, true);
      if (!row) return null;
      const done = () => tx`update appointments set smile_notes_refresh = false where id = ${row.id}`;
      const scId = scIdOf(row.external_id);
      const line = healthNoteLine(await latestHealth(tx, row.patient_id));
      if (!scId || !line) {
        await done();
        return { status: "nada" };
      }
      const client = clientFor(conn, undefined, tx, { forWrites: true });
      try {
        let sc: ScAppointment;
        try {
          sc = await scAppointment(client, scId);
        } catch (e) {
          if (e instanceof SmileApiError && e.status === 404) {
            await done();
            return { status: "nada" };
          }
          throw e;
        }
        if (cancelledInSmile(sc)) {
          await done();
          return { status: "nada" };
        }
        // Si recepción lo movió, se espera a que la sincronización lo traiga a Turnia.
        if (!sameInstant(sc.start_date, row.starts_at) || !sameInstant(sc.end_date, row.ends_at)) return null;
        if (!(await belongsToPatient(tx, row, sc))) throw new Review("En Smile Connect ese turno figura a nombre de otro paciente. No se tocó.");
        if (sc.professional_ids.length !== 1) throw new Review("En Smile Connect ese turno tiene dos profesionales: la nota no se tocó.");
        const boxId = sc.box_id ?? row.smile_box_id;
        if (!boxId) throw new Review("El turno no tiene consultorio en Smile Connect: la nota no se tocó.");
        if ((sc.notes ?? "").split("\n").some((l) => l.trim() === line)) {
          await done();
          return { status: "nada" };
        }
        const notes = withHealthLine(sc.notes ?? null, line, await lastSentHealthLine(tx, row.id));
        if (notes === null) throw new Review("La nota del turno en Smile Connect no tiene lugar para la ficha de salud.");
        const body = {
          professional_id: sc.professional_ids[0], box_id: boxId, start_date: sc.start_date, end_date: sc.end_date, notes,
          ...(sc.service_id != null && { service_id: sc.service_id }),
        };
        const request = { appointment_id: scId, ...body };
        if (!writesEnabledOnServer()) {
          await logChange(tx, row, "notas", "sombra", { request, before: sc });
          await done();
          return { status: "sombra" };
        }
        const changed = await scRescheduleAppointment(client, scId, body);
        await logChange(tx, row, "notas", "hecho", { request, before: sc, result: changed });
        await done();
        return { status: "ok" };
      } catch (e) {
        if ((e instanceof SmileApiError && e.status === 429) || e instanceof SmileBudgetError) {
          const retryAt = new Date();
          if (e instanceof SmileBudgetError) retryAt.setUTCHours(24, 0, 0, 0);
          else retryAt.setTime(retryAt.getTime() + Math.max(1, e.retryAfter ?? SMILE_RATE_LIMIT_WAIT_SECONDS) * 1_000);
          const until = retryAt.toISOString();
          await tx`update smile_connect_connections set api_retry_at = ${until} where clinic_id = ${clinicId}`;
          return { status: "espera", retryAt: until };
        }
        // Una falla pasajera se reintenta en la próxima vuelta; lo demás queda para recepción.
        if (!(e instanceof Review) && !(e instanceof SmileApiError && !e.transient)) return { status: "error", message: smileErrorText(e) };
        const message = (e instanceof Review ? e.message : smileErrorText(e)).slice(0, 300);
        await logChange(tx, row, "notas", "revisar", { error: message });
        await done();
        await noticeReview(tx, row, `No se pudo sumar la ficha de salud al turno del ${describe(row)}. ${message}\nSumala a mano: ${line}`);
        return { status: "revisar", message };
      }
    });
    if (!outcome) continue;
    if (outcome.status === "espera") return outcome;
    if (outcome.status === "ok") result.ok++;
    if (outcome.status === "sombra") result.sombra++;
    if (outcome.status === "revisar") result.revisar++;
    if (outcome.status === "error") result.error++;
  }
  return null;
}

/** El pedido ya está en Postgres. Si la ejecución se corta, lo recoge el próximo cron. */
/** Escribe en Smile Connect un pedido recién hecho, con un reintento corto si el proveedor pide esperar. */
async function pushBooking(clinicId: string, appointmentId: string): Promise<Record<string, number | string>> {
  let outcome = await pushPendingSmile(clinicId, appointmentId);
  const retryIn = typeof outcome.reintentar_en === "string"
    ? Date.parse(outcome.reintentar_en) - Date.now()
    : outcome.error ? 3_000 : null;
  if (retryIn !== null && retryIn <= MAX_INLINE_RETRY_MS) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, retryIn)));
    outcome = await pushPendingSmile(clinicId, appointmentId);
  }
  return outcome;
}

async function afterBooking(clinicId: string, outcome: Record<string, number | string>) {
  await Promise.allSettled([sendPendingNotices(clinicId), ...(outcome.ok ? [syncPendingCalendar(clinicId)] : [])]);
}

export function processSmileBookingLater(clinicId: string, appointmentId: string): void {
  try {
    after(async () => afterBooking(clinicId, await pushBooking(clinicId, appointmentId)));
  } catch {
    // Fuera de una petición, se procesa con la automatización de calendario.
  }
}

/**
 * Por chat: escribe el pedido ya y espera hasta `waitMs` el resultado, para que Sofi lo conteste en el
 * mismo mensaje. Si no llega a tiempo, sigue solo. Los avisos salen después de responder, así Sofi
 * alcanza a marcar los que ya le dijo al paciente (`noticesToldInChat`). Devuelve si terminó a tiempo.
 */
export async function settleSmileBooking(clinicId: string, appointmentId: string, waitMs: number): Promise<boolean> {
  const work = pushBooking(clinicId, appointmentId).catch((e): Record<string, number | string> => {
    console.error("Smile Connect: no se pudo escribir el pedido", e instanceof Error ? e.message : e);
    return { error: 1 };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inTime = await Promise.race([
    work.then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), waitMs); }),
  ]);
  clearTimeout(timer);
  try {
    after(async () => afterBooking(clinicId, await work));
  } catch {
    // Fuera de una petición, los avisos los manda la automatización de calendario.
  }
  return inTime;
}

/** Después de guardar la ficha de salud: la suma a las notas en Smile Connect sin esperar la automatización. */
export function processSmileNotesLater(clinicId: string): void {
  try {
    after(async () => {
      await pushPendingSmile(clinicId);
      await sendPendingNotices(clinicId);
    });
  } catch {
    // Fuera de una petición, lo hace la automatización de cada 10 minutos.
  }
}

/** Reanuda la escritura frenada (desde el panel, después de revisar el registro). */
export async function resumeSmileWrites(clinicId: string): Promise<void> {
  await sql`update smile_connect_connections set api_writes_paused = null where clinic_id = ${clinicId}`;
}

export type SmileChange = {
  id: string;
  appointment_id: string | null;
  action: string;
  status: string;
  request: unknown;
  before: unknown;
  error: string | null;
  created_at: string;
};

export async function recentSmileChanges(clinicId: string, limit = 15): Promise<SmileChange[]> {
  return [...(await sql<SmileChange[]>`
    select id, appointment_id, action, status, request, before, error, created_at
    from smile_connect_changes where clinic_id = ${clinicId} order by created_at desc limit ${limit}`)];
}

export async function smileReviewList(clinicId: string) {
  return [...(await sql<Array<{ id: string; starts_at: string; smile_error: string | null; patient: string | null; status: string }>>`
    select a.id, a.starts_at, a.smile_error, p.full_name as patient, a.status
    from appointments a join patients p on p.id = a.patient_id
    where a.clinic_id = ${clinicId} and a.smile_sync in ('revisar', 'error')
    order by a.starts_at limit 30`)];
}

/** Ya se resolvió a mano en Smile Connect: sale de la lista. */
export async function dismissSmileReview(clinicId: string, appointmentId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('turnia.smile_quiet', 'on', true)`;
    await tx`update appointments set smile_sync = null, smile_error = null where id = ${appointmentId}
      and clinic_id = ${clinicId} and status <> 'pendiente'`;
  });
}
