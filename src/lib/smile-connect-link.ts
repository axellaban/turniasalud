import "server-only";
import { decryptSecret, encryptSecret } from "./calendar/crypto";
import { getClinic } from "./clinic";
import { json, sql, type TransactionSql } from "./db";
import type { BusyInterval } from "./slots";
import { ensureSmileConnectToken, matchProfessional, syncSmileConnect, type SmileConnectSyncSummary } from "./smile-connect";
import {
  busyFromFree,
  freeRanges,
  scAllPatients,
  scAppointment,
  scAppointments,
  scPatientsAfter,
  scAvailability,
  scBoxes,
  scClinic,
  scEvents,
  scPatient,
  scProfessionalHours,
  scProfessionals,
  scServices,
  scSearchPatients,
  scSupportsNotes,
  scSupportsDelta,
  scAppointmentsChangedSince,
  scPatientsChangedSince,
  SmileApiError,
  smileClient,
  smileErrorText,
  hoursToRanges,
  type ScAppointment,
  type ScEvent,
  type ScPatient,
  type ScSlot,
  type SmileClient,
  type SmileRequest,
} from "./smile-connect-api";
import { addDaysKey, localDateKey, weekdayOfKey, zonedParts, zonedTimeToUtc } from "./time";
import { notifyN8n } from "./n8n";
import { env } from "./env";
import { createHash } from "node:crypto";

// Smile Connect por API (sin activar hasta que la API acepte el motivo del turno): la clave de la
// clínica, la sincronización desde Smile Connect (dosificada para el cupo diario de la API), la
// disponibilidad en vivo para Sofi y la copia diaria. Lo que se escribe en Smile Connect está en
// src/lib/smile-connect-push.ts. Nada de esto corre con el modo «apagada» (el de siempre).

export const SMILE_MODES = ["apagada", "lectura", "sombra", "crear", "completa"] as const;
export type SmileMode = (typeof SMILE_MODES)[number];
export const SMILE_MODE_LABEL: Record<SmileMode, { label: string; detail: string }> = {
  apagada: { label: "Apagada", detail: "No lee ni escribe nada. La clave queda guardada." },
  lectura: { label: "Solo lectura", detail: "Trae la agenda de Smile Connect y Sofi ofrece solo lo que está libre ahí (con bloqueos y feriados). No escribe nada." },
  sombra: { label: "Escritura de prueba", detail: "Como «Solo lectura», y además anota qué escribiría en Smile Connect, sin escribirlo. Para revisar antes de activar." },
  crear: { label: "Crear turnos", detail: "Sofi toma el pedido y lo confirma por WhatsApp después de verificarlo en Smile Connect. Recepción coordina los cambios y las cancelaciones." },
  completa: { label: "Crear, mover y cancelar", detail: "Sofi crea, reprograma y cancela turnos simples después de verificarlos en Smile Connect. Aplica las reglas de turnos del consultorio." },
};
export const WRITE_MODES: readonly SmileMode[] = ["sombra", "crear", "completa"];

/** Del cupo diario de 10.000 registros (pacientes y turnos) por clínica, Turnia usa hasta 8.000. */
export const READ_CAP = 8_000;
const AVAILABILITY_TTL_MS = 2 * 60_000;
const AVAILABILITY_STALE_MS = 30 * 60_000;
/** Al verificar para Sofi: hasta cuándo se consultan días (cada uno tarda de 3 a 5 segundos) y cuántos a la vez. */
const VERIFY_DEADLINE_MS = 14_000;
const VERIFY_PARALLEL = 6;
/** Si una sincronización cancelaría muchos turnos de golpe, algo raro pasa: no se aplica. */
const MAX_VANISHED = 5;

export type SmileApiConnection = {
  clinic_id: string;
  api_key_encrypted: string | null;
  api_key_hint: string | null;
  api_clinic_id: number | null;
  api_clinic_name: string | null;
  api_mode: SmileMode;
  api_error: string | null;
  api_error_at: string | null;
  api_checked_at: string | null;
  api_near_pull_at: string | null;
  api_near_count: number | null;
  api_wide_pull_at: string | null;
  api_backup_at: string | null;
  api_reads_day: string | null;
  api_reads: number;
  api_supports_notes: boolean;
  api_writes_paused: string | null;
  api_retry_at: string | null;
  /** Confirmación diferida y cambios verificados en Smile Connect (por defecto). */
  api_deferred: boolean;
  /** Horarios copiados de Smile Connect: cuándo y qué cambió (o qué hay que revisar). */
  api_hours_at: string | null;
  api_hours_note: string | null;
  /** Bloqueos por la API: null sin probar, false si la clave no tiene `events:read`. */
  api_events_ok: boolean | null;
  api_events_checked_at: string | null;
  /** Última vez que la copia diaria se aplicó a Turnia, con su resumen. */
  api_mirror_at: string | null;
  api_mirror_summary: Record<string, unknown> | null;
  /** Última lectura de la lista completa de pacientes y el id más alto leído (los demás días, solo los nuevos). */
  api_patients_full_at: string | null;
  api_patients_last_id: number | null;
  /** Cuándo se cargó la clave actual (se recomienda renovarla cada 6 meses). */
  api_key_saved_at: string | null;
  /** La API permite pedir solo lo que cambió (`updated_since`) y hasta cuándo se trajo. */
  api_supports_delta: boolean;
  api_delta_at: string | null;
};

export class SmileBudgetError extends Error {}

/** La escritura real necesita además SMILE_CONNECT_WRITES=on en el servidor. Si no, es de prueba. */
export const writesEnabledOnServer = () => process.env.SMILE_CONNECT_WRITES === "on";

export async function getSmileApiConnection(clinicId: string, tx?: TransactionSql): Promise<SmileApiConnection | null> {
  const [row] = await (tx ?? sql)<SmileApiConnection[]>`
    select clinic_id, api_key_encrypted, api_key_hint, api_clinic_id, api_clinic_name, api_mode, api_error, api_error_at,
           api_checked_at, api_near_pull_at, api_near_count, api_wide_pull_at, api_backup_at, api_reads_day::text as api_reads_day,
           api_reads, api_supports_notes, api_writes_paused, api_retry_at, api_deferred,
           api_hours_at, api_hours_note, api_events_ok, api_events_checked_at, api_mirror_at, api_mirror_summary,
           api_patients_full_at, api_patients_last_id::int as api_patients_last_id, api_key_saved_at,
           api_supports_delta, api_delta_at
    from smile_connect_connections where clinic_id = ${clinicId}`;
  return row ?? null;
}

/**
 * Cuenta los registros que va a leer y frena antes de pasarse del cupo del día (hora UTC). Solo suma
 * si la lectura entra: una rechazada no gasta cupo. `cap`: hasta dónde puede llegar esta lectura.
 */
async function reserveReads(clinicId: string, n: number, cap: number, tx?: TransactionSql): Promise<void> {
  const [row] = await (tx ?? sql)<Array<{ api_reads: number }>>`
    update smile_connect_connections set
      api_reads = case when api_reads_day = (now() at time zone 'utc')::date then api_reads + ${n} else ${n} end,
      api_reads_day = (now() at time zone 'utc')::date
    where clinic_id = ${clinicId}
      and (case when api_reads_day = (now() at time zone 'utc')::date then api_reads + ${n} else ${n} end) <= ${cap}
    returning api_reads`;
  if (!row) {
    throw new SmileBudgetError(cap < READ_CAP
      ? "Se usó el cupo de lecturas de Smile Connect de hoy para sincronizar. Lo que queda es para confirmar los turnos de Sofi. Sigue mañana."
      : `Se llegó al tope diario de lecturas de Smile Connect (${READ_CAP}). Sigue mañana.`);
  }
}

/**
 * Cliente de la API para una clínica. Las lecturas para sincronizar o copiar dejan libre la reserva
 * del cupo (WRITE_RESERVE); las de escribir y verificar los turnos de Sofi (`forWrites`) pueden usarla.
 */
export function clientFor(conn: Pick<SmileApiConnection, "clinic_id" | "api_key_encrypted">, timeoutMs?: number, tx?: TransactionSql, opts: { forWrites?: boolean } = {}): SmileClient {
  if (!conn.api_key_encrypted) throw new Error("Este consultorio no tiene la clave de la API de Smile Connect.");
  const cap = opts.forWrites ? READ_CAP : READ_CAP - WRITE_RESERVE;
  return smileClient(decryptSecret(conn.api_key_encrypted), { onReserve: (n) => reserveReads(conn.clinic_id, n, cap, tx), timeoutMs });
}

export async function recordSmileError(clinicId: string, e: unknown): Promise<string> {
  const message = e instanceof SmileBudgetError ? e.message : smileErrorText(e);
  await sql`update smile_connect_connections set api_error = ${message.slice(0, 300)}, api_error_at = now() where clinic_id = ${clinicId}`;
  return message;
}

const clearSmileError = (clinicId: string) =>
  sql`update smile_connect_connections set api_error = null, api_error_at = null where clinic_id = ${clinicId} and api_error is not null`;

/** La lectura manual completa comprobó que la API volvió a responder. Conservá cualquier espera nueva. */
export async function clearSmileRetryAfterSync(clinicId: string, retryAt: string | null): Promise<void> {
  if (!retryAt) return;
  await sql`update smile_connect_connections set api_retry_at = null
    where clinic_id = ${clinicId} and api_retry_at = ${retryAt}`;
}

// ── La clave ─────────────────────────────────────────────────────────────────

export type SmileKeyCheck = {
  clinicName: string | null;
  smileClinicId: number;
  supportsNotes: boolean;
  professionals: Array<{ smileId: number; name: string; box: string | null; turnia: string | null }>;
  /** La zona horaria de Smile Connect no es la del consultorio en Turnia: los días se leerían corridos. */
  timezoneWarning: string | null;
};

/** Mapea los profesionales de Smile Connect con los de Turnia (por nombre) y guarda cuál es cuál. */
async function mapProfessionals(clinicId: string, client: SmileClient): Promise<SmileKeyCheck["professionals"]> {
  const [pros, boxes] = await Promise.all([scProfessionals(client), scBoxes(client)]);
  const turnia = [...(await sql<Array<{ id: string; full_name: string; smile_professional_id: number | null }>>`
    select id, full_name, smile_professional_id from professionals where clinic_id = ${clinicId} order by active desc, created_at`)];
  const used = new Set<string>();
  const out: SmileKeyCheck["professionals"] = [];
  for (const p of pros) {
    const name = `${p.name} ${p.surname}`.replace(/\s+/g, " ").trim();
    const free = turnia.filter((t) => !used.has(t.id));
    // El vínculo ya guardado manda; si no hay, por el nombre (entre los que no están vinculados a otro).
    const match = free.find((t) => t.smile_professional_id === p.professional_id)
      ?? matchProfessional(name, free.filter((t) => t.smile_professional_id === null));
    // Sin consultorio por defecto en Smile Connect: si la clínica tiene uno solo, es ese.
    const boxId = p.box_id ?? (boxes.length === 1 ? boxes[0].box_id : null);
    if (match) {
      used.add(match.id);
      await sql`
        update professionals set smile_professional_id = ${p.professional_id}, smile_box_id = ${boxId}
        where id = ${match.id} and clinic_id = ${clinicId}`;
    }
    out.push({ smileId: p.professional_id, name, box: boxes.find((b) => b.box_id === boxId)?.name ?? null, turnia: match?.full_name ?? null });
  }
  return out;
}

/**
 * Guarda la clave de la API (cifrada) después de probarla: la clínica, sus profesionales y que pueda
 * leer turnos y pacientes. No cambia el modo: una clave nueva queda «apagada» hasta elegir otro.
 */
export async function saveSmileApiKey(clinicId: string, rawKey: string): Promise<SmileKeyCheck> {
  const key = rawKey.trim();
  if (!/^sc_[A-Za-z0-9_.-]{20,300}$/.test(key)) throw new Error("Esa no parece una clave de la API de Smile Connect (empieza con «sc_live_»).");
  const client = smileClient(key);
  let clinic;
  try {
    clinic = await scClinic(client);
  } catch (e) {
    throw new Error(smileErrorText(e));
  }
  const previous = await getSmileApiConnection(clinicId);
  if (previous?.api_clinic_id && previous.api_clinic_id !== clinic.clinic_id) {
    throw new Error("Esa clave es de otra clínica de Smile Connect que la que estaba conectada. Si es a propósito, primero quitá la clave anterior.");
  }
  // Que pueda leer turnos y pacientes (un registro de cada uno).
  try {
    const now = new Date();
    await client.request("/appointments", { query: { start: now.toISOString(), end: new Date(now.getTime() + 86_400_000).toISOString(), limit: 1, after: 0 } });
    await client.request("/patients", { query: { limit: 1, after: 0 } });
  } catch (e) {
    throw new Error(e instanceof SmileApiError && e.status === 403
      ? "La clave no tiene permiso para leer turnos y pacientes. En Smile Connect, dale los permisos de lectura (appointments:read y patients:read)."
      : smileErrorText(e));
  }
  const supportsNotes = await scSupportsNotes(client).catch(() => false);
  const supportsDelta = await scSupportsDelta(client).catch(() => false);
  await ensureSmileConnectToken(clinicId);
  await sql`
    update smile_connect_connections set
      api_key_encrypted = ${encryptSecret(key)}, api_key_hint = ${key.slice(-4)},
      api_clinic_id = ${clinic.clinic_id}, api_clinic_name = ${clinic.clinic_name},
      api_checked_at = now(), api_error = null, api_error_at = null, api_retry_at = null,
      api_supports_notes = ${supportsNotes}, updated_at = now(),
      -- Una clave nueva puede traer permisos nuevos: los bloqueos se vuelven a probar en la vuelta siguiente.
      api_key_saved_at = now(), api_events_ok = null, api_events_checked_at = null,
      api_supports_delta = ${supportsDelta}
    where clinic_id = ${clinicId}`;
  const professionals = await mapProfessionals(clinicId, client);
  const turniaTz = (await getClinic(clinicId)).timezone;
  const timezoneWarning = clinic.timezone && clinic.timezone !== turniaTz
    ? `Smile Connect usa la zona horaria ${clinic.timezone} y el consultorio en Turnia ${turniaTz}. Igualalas en Configuración → Consultorio antes de prender la conexión.`
    : null;
  return { clinicName: clinic.clinic_name, smileClinicId: clinic.clinic_id, supportsNotes, professionals, timezoneWarning };
}

/** Los profesionales y consultorios de Smile Connect, para vincularlos a mano en el panel. No gasta cupo. */
export async function smileDirectory(clinicId: string): Promise<{ professionals: Array<{ id: number; name: string; boxId: number | null }>; boxes: Array<{ id: number; name: string }> } | null> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted) return null;
  try {
    const client = clientFor(conn, 4_000);
    const [pros, boxes] = await Promise.all([scProfessionals(client), scBoxes(client)]);
    return {
      professionals: pros.map((p) => ({ id: p.professional_id, name: `${p.name} ${p.surname}`.replace(/\s+/g, " ").trim(), boxId: p.box_id })),
      boxes: boxes.map((b) => ({ id: b.box_id, name: b.name })),
    };
  } catch {
    return null;
  }
}

/**
 * Vincula a mano un profesional de Turnia con uno de Smile Connect y su consultorio (cuando el nombre
 * no coincide y no se vinculó solo). Un profesional de Smile Connect va con uno solo de Turnia.
 */
export async function linkSmileProfessional(clinicId: string, professionalId: string, smileProfessionalId: number | null, smileBoxId: number | null): Promise<void> {
  if (smileProfessionalId !== null) {
    const dir = await smileDirectory(clinicId);
    if (!dir) throw new Error("No se pudo leer la lista de Smile Connect. Probá de nuevo en un momento.");
    if (!dir.professionals.some((p) => p.id === smileProfessionalId)) throw new Error("Ese profesional no está en Smile Connect.");
    if (smileBoxId === null || !dir.boxes.some((b) => b.id === smileBoxId)) throw new Error("Elegí el consultorio de Smile Connect donde atiende.");
  }
  await sql.begin(async (tx) => {
    if (smileProfessionalId !== null) {
      await tx`update professionals set smile_professional_id = null, smile_box_id = null
        where clinic_id = ${clinicId} and smile_professional_id = ${smileProfessionalId} and id <> ${professionalId}`;
    }
    const done = await tx`update professionals set smile_professional_id = ${smileProfessionalId}, smile_box_id = ${smileProfessionalId === null ? null : smileBoxId}
      where id = ${professionalId} and clinic_id = ${clinicId} returning id`;
    if (!done.length) throw new Error("No encontré ese profesional.");
  });
}

export async function setSmileMode(clinicId: string, mode: SmileMode): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`smile-connect:${clinicId}`}, 0))`;
    const conn = await getSmileApiConnection(clinicId, tx);
    if (mode !== "apagada" && !conn?.api_key_encrypted) throw new Error("Primero cargá la clave de la API de Smile Connect.");
    if (isLiveSmileMode(mode) && conn && !isLiveSmileMode(conn.api_mode)) {
      // Al activar el alta real, lo que quedó en la cola de prueba se revisa a mano.
      await tx`update appointments set smile_sync = 'revisar',
        smile_error = 'Este cambio quedó antes de activar la escritura real. Revisalo en Smile Connect.'
        where clinic_id = ${clinicId} and smile_sync in ('pendiente', 'error')`;
    }
    await tx`update smile_connect_connections set api_mode = ${mode}, updated_at = now() where clinic_id = ${clinicId}`;
  });
}

export const isLiveSmileMode = (mode: SmileMode) => mode === "crear" || mode === "completa";

/** Quita la clave y apaga todo. Lo pendiente de escribir en Smile Connect se descarta. */
export async function removeSmileApiKey(clinicId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`smile-connect:${clinicId}`}, 0))`;
    await tx`select set_config('turnia.smile_quiet', 'on', true)`;
    await tx`
      update smile_connect_connections set api_key_encrypted = null, api_key_hint = null, api_mode = 'apagada',
        api_error = null, api_error_at = null, api_retry_at = null, api_writes_paused = null, updated_at = now()
      where clinic_id = ${clinicId}`;
    await tx`update appointments set smile_sync = null, smile_error = null where clinic_id = ${clinicId} and smile_sync in ('pendiente', 'error')`;
  });
}

// ── Desde Smile Connect ──────────────────────────────────────────────────────

const localMidnight = (key: string, timeZone: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, 0, 0, timeZone);
};

/** Ventanas de la sincronización: la cercana (de ayer a 4 días) y la lejana (hasta 60 días). */
export function pullWindows(which: "cerca" | "lejos", now: Date, timeZone: string): Array<[Date, Date]> {
  const today = localDateKey(now, timeZone);
  if (which === "cerca") return [[localMidnight(addDaysKey(today, -1), timeZone), localMidnight(addDaysKey(today, 4), timeZone)]];
  return [
    [localMidnight(addDaysKey(today, 4), timeZone), localMidnight(addDaysKey(today, 34), timeZone)],
    [localMidnight(addDaysKey(today, 34), timeZone), localMidnight(addDaysKey(today, 61), timeZone)],
  ];
}

/**
 * Turno de la API → formato que entiende el sincronizador (el mismo del userscript). Las notas y la
 * prestación de Smile Connect pasan a las notas del turno en Turnia (la prestación, adelante).
 */
export function apiAppointmentPayload(a: ScAppointment, patient: ScPatient | undefined, nowIso: string, services?: Map<number, string>): Record<string, unknown> {
  const own = a.notes?.trim() || null;
  const service = a.service_id != null ? (services?.get(a.service_id) ?? null) : null;
  const notes = service && !(own ?? "").toLowerCase().includes(service.toLowerCase()) ? [service, own].filter(Boolean).join(" · ") : own;
  return {
    appointment_id: a.appointment_id,
    ...(notes && { notes }),
    start_date: a.start_date,
    end_date: a.end_date,
    patient_id: a.patient_id,
    professional_id: a.professional_ids[0],
    professional_ids: a.professional_ids,
    box_id: a.box_id,
    patient_attended: a.attendance,
    // La API marca la baja con `cancelled`; «Canceled with Notice» ya alcanza para cancelarlo.
    deleted_at: a.cancelled && a.attendance !== "Canceled with Notice" ? nowIso : null,
    ...(patient && {
      patient_name: patient.name,
      patient_surname: patient.surname,
      patient_id_number: patient.id_number,
      patient_phone_country_code: patient.phone_country_code,
      patient_phone_number: patient.phone_number,
      patient_email: patient.email,
    }),
  };
}

/** Pacientes nuevos por corrida: de a poco, para no gastar el cupo de golpe. */
const NEW_PATIENTS_PER_RUN = 30;

export type PullResult = SmileConnectSyncSummary & { leidos: number; pendientes: number };

/** Bloqueos de [from, to), de a 31 días (el máximo de la API). */
async function scEventsRange(client: SmileClient, from: Date, to: Date): Promise<ScEvent[]> {
  const out: ScEvent[] = [];
  for (let start = from; start < to; ) {
    const end = new Date(Math.min(start.getTime() + 31 * 86_400_000, to.getTime()));
    out.push(...(await scEvents(client, start, end)));
    start = end;
  }
  return out;
}

/**
 * Los bloqueos de agenda de una ventana, si la clave tiene el permiso `events:read`. null: no se
 * pudieron leer y los de Turnia no se tocan. Sin el permiso no es un error de la clave (no se avisa
 * al consultorio): se anota y se vuelve a probar una vez por día.
 */
async function readEvents(conn: SmileApiConnection, client: SmileClient, from: Date, to: Date): Promise<ScEvent[] | null> {
  if (conn.api_events_ok === false && minutesSince(conn.api_events_checked_at) < 24 * 60) return null;
  try {
    const events = await scEventsRange(client, from, to);
    if (conn.api_events_ok !== true) {
      await sql`update smile_connect_connections set api_events_ok = true, api_events_checked_at = now() where clinic_id = ${conn.clinic_id}`;
      conn.api_events_ok = true;
    }
    return events;
  } catch (e) {
    if (e instanceof SmileApiError && (e.status === 403 || e.status === 404)) {
      await sql`update smile_connect_connections set api_events_ok = false, api_events_checked_at = now() where clinic_id = ${conn.clinic_id}`;
      conn.api_events_ok = false;
      conn.api_events_checked_at = new Date().toISOString();
      return null;
    }
    // Una falla pasajera con los bloqueos no frena la sincronización de los turnos.
    console.error("Smile Connect: no se pudieron leer los bloqueos", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Nombres de las prestaciones, solo si algún turno trae una (son pocas y no gastan cupo). */
async function serviceNames(client: SmileClient, appts: ScAppointment[]): Promise<Map<number, string> | undefined> {
  if (!appts.some((a) => a.service_id != null)) return undefined;
  try {
    return new Map((await scServices(client)).map((x) => [x.service_id, x.name]));
  } catch (e) {
    console.error("Smile Connect: no se pudieron leer las prestaciones", e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** Lo que va a la sincronización como profesionales y consultorios de Smile Connect. */
async function smileMetadata(client: SmileClient) {
  const [pros, boxes] = await Promise.all([scProfessionals(client), scBoxes(client)]);
  return {
    proIds: new Set(pros.map((p) => p.professional_id)),
    metadata: {
      professionals: pros.map((p) => ({
        professional_id: p.professional_id, name: p.name, surname: p.surname, active: true,
        box_id: p.box_id ?? (boxes.length === 1 ? boxes[0].box_id : null),
      })),
      boxes: boxes.map((b) => ({ box_id: b.box_id, name: b.name })),
    },
  };
}

/**
 * Que un turno no aparezca en una ventana no prueba que se borró: recepción pudo moverlo a otro día, fuera
 * de la ventana. Se pregunta por cada uno (son pocos: con más de MAX_VANISHED se frena todo antes) y se
 * devuelven los que siguen en Smile Connect, para actualizarlos en vez de darlos de baja. Si Smile Connect
 * no contesta, se corta la vuelta: no se da de baja nada con una respuesta a medias.
 */
async function stillInSmile(client: SmileClient, externalIds: string[]): Promise<ScAppointment[]> {
  const out: ScAppointment[] = [];
  for (const ext of externalIds) {
    const id = Number(ext.slice(3));
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    try {
      out.push(await scAppointment(client, id));
    } catch (e) {
      if (e instanceof SmileApiError && e.status === 404) continue;
      throw e;
    }
  }
  return out;
}

/**
 * Trae de Smile Connect los turnos de una ventana y los sincroniza, con sus notas y, si la clave tiene
 * el permiso, los bloqueos de agenda. Los pacientes que Turnia no conoce se leen de a uno.
 */
export async function pullSmileConnect(clinicId: string, which: "cerca" | "lejos", now = new Date()): Promise<PullResult> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || conn.api_mode === "apagada") throw new Error("La conexión con Smile Connect está apagada.");
  const clinic = await getClinic(clinicId);
  const client = clientFor(conn);
  const total: PullResult = {
    patientsCreated: 0, patientsUpdated: 0, appointmentsCreated: 0, appointmentsUpdated: 0, appointmentsCancelled: 0,
    blocksCreated: 0, blocksUpdated: 0, blocksDeleted: 0, professionalsCreated: 0, leidos: 0, pendientes: 0,
  };
  const { proIds, metadata } = await smileMetadata(client);
  for (const [from, to] of pullWindows(which, now, clinic.timezone)) {
    const limit = which === "cerca" ? Math.min(100, Math.max(25, (conn.api_near_count ?? 75) + 25)) : 100;
    const appts = await scAppointments(client, from, to, limit);
    total.leidos += appts.length;

    // Pacientes que Turnia todavía no conoce: se leen (de a pocos) antes de sincronizar sus turnos.
    const ids = [...new Set(appts.map((a) => a.patient_id))];
    const known = new Set(
      (await sql<Array<{ external_id: string }>>`
        select external_id from patient_external_ids where clinic_id = ${clinicId} and external_id = any(${ids.map((id) => `sc:${id}`)}::text[])`)
        .map((r) => r.external_id),
    );
    const unknown = ids.filter((id) => !known.has(`sc:${id}`));
    const fetched = new Map<number, ScPatient>();
    for (const id of unknown.slice(0, NEW_PATIENTS_PER_RUN)) fetched.set(id, await scPatient(client, id));
    const usable = appts.filter((a) => known.has(`sc:${a.patient_id}`) || fetched.has(a.patient_id));
    total.pendientes += appts.length - usable.length;

    // Si de golpe «desaparecen» varios turnos que Turnia tiene de Smile Connect, no se aplica nada.
    const seen = new Set(appts.map((a) => `sc:${a.appointment_id}`));
    const vanished = (await sql<Array<{ external_id: string }>>`
      select external_id from appointments
      where clinic_id = ${clinicId} and source = 'smile_connect' and external_id like 'sc:%'
        and status in ('confirmado', 'pendiente') and starts_at >= ${from} and starts_at < ${to}`)
      .filter((r) => !seen.has(r.external_id));
    if (vanished.length > MAX_VANISHED) {
      throw new Error(`Smile Connect dejó de mostrar ${vanished.length} turnos de golpe. No se aplicó la sincronización: revisalo antes de seguir.`);
    }
    const moved = await stillInSmile(client, vanished.map((r) => r.external_id));

    const nowIso = now.toISOString();
    // Con turnos que todavía no se pudieron leer (pacientes nuevos de a poco), la ventana queda
    // incompleta: no se da de baja lo que «falta», que puede ser uno de esos. Se hace en la vuelta siguiente.
    const complete = usable.length === appts.length;
    const services = await serviceNames(client, usable);
    // Sin la ventana completa tampoco se dan de baja bloqueos: se sincronizan en la vuelta siguiente.
    const events = complete ? await readEvents(conn, client, from, to) : null;
    const payload = {
      ...(complete && { from: from.toISOString(), to: to.toISOString() }),
      metadata,
      appointments: [...usable, ...moved].map((a) => apiAppointmentPayload(a, fetched.get(a.patient_id), nowIso, services)),
      // Un bloqueo de un profesional que Smile Connect ya no lista sería de toda la clínica en Turnia: se deja afuera.
      ...(events && { events: events.filter((e) => proIds.has(e.professional_id)) }),
    };
    const { summary } = await syncSmileConnect(clinicId, payload, { mode: "live", actor: "Smile Connect (API)", skipBlocks: !events, now });
    for (const k of Object.keys(summary) as Array<keyof SmileConnectSyncSummary>) total[k] += summary[k];
    if (which === "cerca") {
      await sql`update smile_connect_connections set api_near_pull_at = now(), api_near_count = ${appts.length} where clinic_id = ${clinicId}`;
    }
  }
  if (which === "lejos") await sql`update smile_connect_connections set api_wide_pull_at = now() where clinic_id = ${clinicId}`;
  await clearSmileError(clinicId);
  return total;
}

// ── Sincronización por cambios ───────────────────────────────────────────────

/** Margen hacia atrás en cada pedido de cambios, por si los relojes de Turnia y Smile Connect no coinciden. */
const DELTA_OVERLAP_MS = 2 * 60_000;

/**
 * Trae solo lo que cambió en Smile Connect desde la última vez (cuando la API tenga `updated_since`): turnos
 * nuevos, movidos, cancelados o con asistencia, y pacientes nuevos o modificados. No da de baja nada por
 * ausencia (eso lo hacen las ventanas, que pasan a ser una conciliación cada 3 horas). La marca de agua solo
 * avanza si todo se aplicó; si algo falla, la vuelta siguiente vuelve a pedir desde el mismo punto.
 */
export async function pullSmileChanges(clinicId: string, now = new Date()): Promise<PullResult & { pacientes_cambiados: number }> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || conn.api_mode === "apagada") throw new Error("La conexión con Smile Connect está apagada.");
  if (!conn.api_supports_delta) throw new Error("La API de Smile Connect todavía no permite pedir solo lo que cambió.");
  const client = clientFor(conn);
  // La primera vez, la última hora (lo anterior ya lo trajeron las ventanas).
  const since = new Date((conn.api_delta_at ? Date.parse(conn.api_delta_at) : now.getTime() - 3600_000) - DELTA_OVERLAP_MS);
  const [appts, changedPatients] = await Promise.all([scAppointmentsChangedSince(client, since), scPatientsChangedSince(client, since)]);
  const { metadata } = await smileMetadata(client);
  const known = new Set(
    (await sql<Array<{ external_id: string }>>`
      select external_id from patient_external_ids where clinic_id = ${clinicId}
        and external_id = any(${[...new Set(appts.map((a) => `sc:${a.patient_id}`))]}::text[])`).map((r) => r.external_id),
  );
  const byId = new Map(changedPatients.map((p) => [p.patient_id, p]));
  for (const id of [...new Set(appts.map((a) => a.patient_id))].filter((id) => !known.has(`sc:${id}`) && !byId.has(id)).slice(0, NEW_PATIENTS_PER_RUN)) {
    byId.set(id, await scPatient(client, id));
  }
  const usable = appts.filter((a) => known.has(`sc:${a.patient_id}`) || byId.has(a.patient_id));
  const services = await serviceNames(client, usable);
  const nowIso = now.toISOString();
  const { summary, parsed } = await syncSmileConnect(clinicId, {
    metadata,
    patients: changedPatients,
    appointments: usable.map((a) => apiAppointmentPayload(a, byId.get(a.patient_id), nowIso, services)),
  }, { mode: "live", actor: "Smile Connect (cambios)", skipBlocks: true, now });
  const { actualizados } = await applySmilePatientChanges(clinicId, changedPatients, parsed.patients);
  // Lo que no se pudo aplicar (pacientes nuevos de a poco) se vuelve a pedir: la marca no avanza.
  const pendientes = appts.length - usable.length;
  if (!pendientes) await sql`update smile_connect_connections set api_delta_at = ${now} where clinic_id = ${clinicId}`;
  await clearSmileError(clinicId);
  return { ...summary, leidos: appts.length, pendientes, pacientes_cambiados: actualizados };
}

// ── Disponibilidad en vivo ───────────────────────────────────────────────────

async function daySlots(conn: SmileApiConnection, client: SmileClient, day: string, fresh: boolean, professionalId?: number): Promise<ScSlot[] | null> {
  const [cached] = fresh ? [] : await sql<Array<{ slots: ScSlot[]; fetched_at: string }>>`
    select slots, fetched_at from smile_connect_availability where clinic_id = ${conn.clinic_id} and day = ${day}`;
  const age = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  if (!fresh && age < AVAILABILITY_TTL_MS) return cached!.slots;
  try {
    const slots = await scAvailability(client, day, 5, professionalId);
    // La caché se comparte entre todos los profesionales de la clínica.
    if (professionalId === undefined) {
      await sql`
        insert into smile_connect_availability (clinic_id, day, slots, fetched_at) values (${conn.clinic_id}, ${day}, ${json(slots)}, now())
        on conflict (clinic_id, day) do update set slots = excluded.slots, fetched_at = now()`;
    }
    return slots;
  } catch (e) {
    await recordSmileError(conn.clinic_id, e).catch(() => {});
    console.error("Smile Connect: no se pudo leer la disponibilidad", day, e instanceof Error ? e.message : e);
    // La caché puede orientar una búsqueda, pero no confirma que el horario siga libre.
    if (fresh) throw e;
    return age < AVAILABILITY_STALE_MS ? cached!.slots : null;
  }
}

/**
 * Lo ocupado en Smile Connect para estos profesionales: todo lo que no figura libre en su
 * disponibilidad (turnos, bloqueos, feriados y fuera de horario). Con `fresh` (al reservar) se
 * consulta en el momento. Solo para profesionales vinculados y con la conexión prendida.
 *
 * Con `verified` (Sofi ofrece solo lo verificado en esta consulta), cada día se consulta en el momento:
 * solo los días de la semana de `weekdays` (los que atienden en Turnia), varios a la vez y en orden,
 * hasta el plazo. Un día que no se pudo verificar cuenta como ocupado y queda en `unchecked`, para
 * que Sofi no diga que no hay lugar en días que no se revisaron.
 */
export async function smileBusy(
  clinicId: string,
  professionalIds: string[],
  from: Date,
  to: Date,
  opts: { fresh?: boolean; verified?: { from: string; to: string; weekdays?: number[]; unchecked?: string[] }; timeZone: string },
): Promise<BusyInterval[]> {
  if (!professionalIds.length) return [];
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || conn.api_mode === "apagada") {
    if (opts.verified) throw new Error("La conexión con Smile Connect está apagada.");
    return [];
  }
  const pros = await sql<Array<{ id: string; smile_professional_id: number }>>`
    select id, smile_professional_id from professionals
    where id = any(${professionalIds}::uuid[]) and clinic_id = ${clinicId} and smile_professional_id is not null`;
  if (opts.fresh && pros.length !== new Set(professionalIds).size) {
    throw new Error("Falta vincular un profesional con Smile Connect.");
  }
  if (!pros.length && !opts.verified) return [];
  // Sofi espera la respuesta hasta 20 segundos (response_timeout_secs en setup.ts).
  const deadline = Date.now() + (opts.verified ? VERIFY_DEADLINE_MS : 12_000);
  const client: SmileClient = opts.verified
    ? { request: <T>(path: string, req?: SmileRequest) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Venció el plazo de la consulta de horarios.");
        return clientFor(conn, remaining).request<T>(path, req);
      } }
    : clientFor(conn, opts.fresh ? 3_000 : undefined);
  const fresh = Boolean(opts.fresh || opts.verified);
  const professionalId = fresh && pros.length === 1 ? pros[0].smile_professional_id : undefined;
  const selected = opts.verified
    ? professionalIds.map((id) => ({ id, smileId: pros.find((p) => p.id === id)?.smile_professional_id }))
    : pros.map((p) => ({ id: p.id, smileId: p.smile_professional_id }));
  const today = localDateKey(new Date(), opts.timeZone);
  const first = opts.verified?.from ?? localDateKey(from, opts.timeZone);
  const last = opts.verified?.to ?? localDateKey(new Date(to.getTime() - 1), opts.timeZone);
  const days: string[] = [];
  const weekdays = opts.verified?.weekdays ? new Set(opts.verified.weekdays) : null;
  for (let d = first < today ? today : first; d <= last && days.length < 62; d = addDaysKey(d, 1)) {
    if (!weekdays || weekdays.has(weekdayOfKey(d))) days.push(d);
  }

  const out: BusyInterval[] = [];
  let verifiedDays = 0;
  const addDay = (day: string, slots: ScSlot[] | null) => {
    if (!slots && !opts.verified) return;
    if (slots) verifiedDays++;
    else opts.verified?.unchecked?.push(day);
    const free = freeRanges(slots ?? []);
    const start = localMidnight(day, opts.timeZone).getTime();
    const end = localMidnight(addDaysKey(day, 1), opts.timeZone).getTime();
    for (const p of selected) {
      for (const [a, b] of busyFromFree(p.smileId ? free.get(p.smileId) ?? [] : [], start, end)) {
        out.push({ professional_id: p.id, starts_at: new Date(a).toISOString(), ends_at: new Date(b).toISOString(), source: "smile" });
      }
    }
  };
  if (opts.verified) {
    // Cada día tarda unos segundos en Smile Connect: varios a la vez, los más cercanos primero.
    const results: Array<ScSlot[] | null> = days.map(() => null);
    let next = 0;
    const worker = async () => {
      while (next < days.length && pros.length && Date.now() < deadline) {
        const i = next++;
        results[i] = await daySlots(conn, client, days[i], true, professionalId).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(VERIFY_PARALLEL, days.length) }, worker));
    days.forEach((day, i) => addDay(day, results[i]));
    opts.verified.unchecked?.sort();
    if (days.length && !verifiedDays) throw new Error("Smile Connect no devolvió disponibilidad para las fechas pedidas.");
    return out;
  }
  // De a cuatro días a la vez: la API permite 90 pedidos por minuto.
  for (let i = 0; i < days.length; i += 4) {
    const chunk = days.slice(i, i + 4);
    const results = await Promise.all(chunk.map((day) => daySlots(conn, client, day, fresh, professionalId)));
    chunk.forEach((day, j) => addDay(day, results[j]));
  }
  return out;
}

// ── Copia diaria ─────────────────────────────────────────────────────────────

/** La lista completa de pacientes se relee dos veces por semana; los otros días, solo los nuevos. */
const FULL_PATIENTS_EVERY_MIN = 84 * 60;
export const patientsFullDue = (c: Pick<SmileApiConnection, "api_patients_full_at" | "api_patients_last_id">) =>
  c.api_patients_last_id == null || minutesSince(c.api_patients_full_at) >= FULL_PATIENTS_EVERY_MIN;

/**
 * Copia de los turnos de 30 días atrás a 120 adelante y de los pacientes. Guarda las últimas 14. La lista
 * completa de pacientes es lo que más gasta del cupo diario: se lee dos veces por semana, y los otros días
 * solo los pacientes nuevos (la API pagina por id, así que son los posteriores al último leído).
 */
export async function backupSmileConnect(clinicId: string, now = new Date()): Promise<{ pacientes: number; turnos: number; completa: boolean }> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted) throw new Error("Falta la clave de la API de Smile Connect.");
  const clinic = await getClinic(clinicId);
  const client = clientFor(conn);
  const today = localDateKey(now, clinic.timezone);
  const from = localMidnight(addDaysKey(today, -30), clinic.timezone);
  const to = localMidnight(addDaysKey(today, 120), clinic.timezone);
  const full = patientsFullDue(conn);
  const patients = full ? await scAllPatients(client) : await scPatientsAfter(client, conn.api_patients_last_id!);
  const lastId = patients.reduce((m, p) => Math.max(m, p.patient_id), conn.api_patients_last_id ?? 0);
  const appointments: ScAppointment[] = [];
  for (let start = from; start < to; ) {
    const end = new Date(Math.min(start.getTime() + 31 * 86_400_000, to.getTime()));
    appointments.push(...(await scAppointments(client, start, end, 100)));
    start = end;
  }
  await sql`
    insert into smile_connect_backups (clinic_id, patients, appointments, window_from, window_to, patients_full)
    values (${clinicId}, ${json(patients)}, ${json(appointments)}, ${from}, ${to}, ${full})`;
  await sql`
    delete from smile_connect_backups where clinic_id = ${clinicId} and id not in (
      select id from smile_connect_backups where clinic_id = ${clinicId} order by taken_at desc limit 14)`;
  const supportsNotes = await scSupportsNotes(client).catch(() => conn.api_supports_notes);
  const supportsDelta = await scSupportsDelta(client).catch(() => conn.api_supports_delta);
  await sql`
    update smile_connect_connections set api_backup_at = now(), api_supports_notes = ${supportsNotes},
      api_supports_delta = ${supportsDelta},
      api_patients_last_id = ${lastId}, api_patients_full_at = case when ${full} then now() else api_patients_full_at end
    where clinic_id = ${clinicId}`;
  return { pacientes: patients.length, turnos: appointments.length, completa: full };
}

// ── Smile Connect, fuente de la verdad ──────────────────────────────────────

const DAY_NAMES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const hm = (t: string) => t.slice(0, 5);
type Range = { weekday: number; start: string; end: string };
const rangesText = (rs: Range[]) =>
  [...rs].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)).map((r) => `${DAY_NAMES[r.weekday]} ${r.start}–${r.end}`).join(", ");

/**
 * Copia el horario semanal de cada profesional de Smile Connect a sus horarios de Turnia, que usa Sofi
 * para saber qué días buscar. Reglas:
 * - solo las franjas comunes; las de «solo urgencias» o de algunas prestaciones las configura Turnia y no se tocan;
 * - un profesional que en Turnia no tiene ningún horario no se habilita solo (qué ofrece Sofi lo arma Turnia): queda anotado;
 * - si Smile Connect no devuelve horario para alguien, no se le borra nada (lo libre igual se verifica en vivo).
 */
export async function syncSmileHours(clinicId: string): Promise<{ cambiados: string[]; revisar: string[] }> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || conn.api_mode === "apagada") throw new Error("La conexión con Smile Connect está apagada.");
  const clinic = await getClinic(clinicId);
  const client = clientFor(conn);
  const pros = await sql<Array<{ id: string; full_name: string; smile_professional_id: number; plain: number; special: number }>>`
    select p.id, p.full_name, p.smile_professional_id,
      count(s.id) filter (where not s.urgent_only and coalesce(cardinality(s.appointment_type_ids), 0) = 0)::int as plain,
      count(s.id) filter (where s.urgent_only or coalesce(cardinality(s.appointment_type_ids), 0) > 0)::int as special
    from professionals p left join schedules s on s.professional_id = p.id
    where p.clinic_id = ${clinicId} and p.active and p.smile_professional_id is not null
    group by p.id order by p.full_name`;
  const cambiados: string[] = [];
  const revisar: string[] = [];
  // Un profesional que Smile Connect ya no lista sigue habilitado en Turnia: queda para revisar (no se apaga solo).
  const listed = new Set((await scProfessionals(client)).map((x) => x.professional_id));
  for (const p of pros) {
    if (!listed.has(p.smile_professional_id)) {
      revisar.push(`${p.full_name} ya no figura en Smile Connect. Si dejó de atender, desactivalo en Turnia (Equipo y horarios).`);
      continue;
    }
    const h = await scProfessionalHours(client, p.smile_professional_id);
    if (h.timezone && h.timezone !== clinic.timezone) {
      revisar.push(`${p.full_name}: Smile Connect usa otra zona horaria (${h.timezone}); no se copió su horario.`);
      continue;
    }
    const wanted: Range[] = Object.entries(h.hours ?? {}).flatMap(([wd, cells]) =>
      /^[0-6]$/.test(wd) && Array.isArray(cells) ? hoursToRanges(cells, h.interval_minutes).map((r) => ({ weekday: Number(wd), ...r })) : [],
    );
    if (!wanted.length) continue;
    if (p.plain + p.special === 0) {
      revisar.push(`${p.full_name}: atiende en Smile Connect (${rangesText(wanted)}) y en Turnia no tiene horarios. Configuralo para que Sofi lo ofrezca.`);
      continue;
    }
    const current = await sql<Range[]>`
      select weekday, start_time::text as start, end_time::text as end from schedules
      where professional_id = ${p.id} and not urgent_only and coalesce(cardinality(appointment_type_ids), 0) = 0`;
    const key = (rs: Range[]) => rs.map((r) => `${r.weekday}|${hm(r.start)}|${hm(r.end)}`).sort().join(",");
    if (key(current) === key(wanted)) continue;
    await sql.begin(async (tx) => {
      await tx`delete from schedules where professional_id = ${p.id} and not urgent_only and coalesce(cardinality(appointment_type_ids), 0) = 0`;
      await tx`insert into schedules ${tx(wanted.map((r) => ({ professional_id: p.id, weekday: r.weekday, start_time: r.start, end_time: r.end })))}`;
    });
    cambiados.push(`${p.full_name}: antes ${rangesText(current.map((r) => ({ ...r, start: hm(r.start), end: hm(r.end) }))) || "sin horario"}; ahora ${rangesText(wanted)}.`);
  }
  const stamp = new Intl.DateTimeFormat("es-AR", { timeZone: clinic.timezone, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date());
  // El último cambio copiado queda a la vista hasta el próximo; lo que hay que revisar se renueva en cada vuelta.
  const lastChange = cambiados.length
    ? `Horarios copiados de Smile Connect el ${stamp}: ${cambiados.join(" ")}`
    : (conn.api_hours_note?.split("\n").find((l) => l.startsWith("Horarios copiados")) ?? null);
  const note = [lastChange, ...revisar].filter(Boolean).join("\n") || null;
  await sql`update smile_connect_connections set api_hours_at = now(), api_hours_note = ${note} where clinic_id = ${clinicId}`;
  return { cambiados, revisar };
}

type SmileSeen = { name: string; surname: string; id_number: string | null; email: string | null; phone: string | null };
const seenOf = (p: ScPatient): SmileSeen => ({
  name: p.name?.trim() ?? "",
  surname: p.surname?.trim() ?? "",
  id_number: p.id_number?.trim() || null,
  email: p.email?.trim().toLowerCase() || null,
  phone: [p.phone_country_code, p.phone_number].map((x) => x?.trim() ?? "").join(" ").trim() || null,
});

/**
 * Pasa a Turnia lo que cambió de cada paciente en Smile Connect desde la última vez que se vio: nombre,
 * DNI, mail y celular. La primera vez solo se anota cómo está (lo que Turnia ya sabe, por ejemplo el
 * WhatsApp desde el que escribe, no se pisa con datos viejos). Si el celular cambia, el anterior queda
 * vinculado para que Sofi lo siga reconociendo. Una ficha de Turnia unida a dos de Smile Connect no se toca.
 */
export async function applySmilePatientChanges(
  clinicId: string,
  raw: ScPatient[],
  parsed: Array<{ externalId: string; fullName: string | null; dni: string | null; phone: string | null; email: string | null }>,
): Promise<{ actualizados: number }> {
  if (!raw.length) return { actualizados: 0 };
  const norm = new Map(parsed.map((p) => [p.externalId, p]));
  const rows = await sql<Array<{ external_id: string; patient_id: string; smile_data: SmileSeen | null; links: number; phone: string | null }>>`
    select x.external_id, x.patient_id, x.smile_data, p.phone,
      (select count(*)::int from patient_external_ids y
       where y.clinic_id = x.clinic_id and y.patient_id = x.patient_id and y.external_id like 'sc:%' and y.external_id not like 'sc:inline:%') as links
    from patient_external_ids x join patients p on p.id = x.patient_id
    where x.clinic_id = ${clinicId} and x.external_id = any(${raw.map((p) => `sc:${p.patient_id}`)}::text[])`;
  const byExt = new Map(rows.map((r) => [r.external_id, r]));
  const seenRows: Array<{ external_id: string; smile_data: SmileSeen }> = [];
  const updates: Array<{ id: string; full_name: string | null; dni: string | null; email: string | null; phone: string | null }> = [];
  const oldPhones: Array<{ clinic_id: string; phone: string; patient_id: string }> = [];
  for (const p of raw) {
    const ext = `sc:${p.patient_id}`;
    const row = byExt.get(ext);
    if (!row) continue;
    const now = seenOf(p);
    const before = row.smile_data;
    if (before && JSON.stringify(before) === JSON.stringify(now)) continue;
    seenRows.push({ external_id: ext, smile_data: now });
    if (!before || row.links !== 1) continue;
    const n = norm.get(ext);
    if (!n) continue;
    const u = {
      id: row.patient_id,
      full_name: before.name !== now.name || before.surname !== now.surname ? n.fullName : null,
      dni: before.id_number !== now.id_number ? n.dni : null,
      email: before.email !== now.email ? n.email : null,
      phone: before.phone !== now.phone ? n.phone : null,
    };
    if (!u.full_name && !u.dni && !u.email && !u.phone) continue;
    updates.push(u);
    if (u.phone && row.phone && row.phone !== u.phone) oldPhones.push({ clinic_id: clinicId, phone: row.phone, patient_id: row.patient_id });
  }
  await sql.begin(async (tx) => {
    await tx`select set_config('turnia.smile_quiet', 'on', true)`;
    for (let i = 0; i < seenRows.length; i += 400) {
      await tx`
        update patient_external_ids x set smile_data = r.smile_data
        from json_to_recordset(${json(seenRows.slice(i, i + 400))}::json) as r(external_id text, smile_data jsonb)
        where x.clinic_id = ${clinicId} and x.external_id = r.external_id`;
    }
    for (let i = 0; i < updates.length; i += 400) {
      await tx`
        update patients p set
          full_name = coalesce(u.full_name, p.full_name),
          dni = coalesce(u.dni, p.dni),
          email = coalesce(u.email, p.email),
          phone = coalesce(u.phone, p.phone)
        from json_to_recordset(${json(updates.slice(i, i + 400))}::json) as u(id uuid, full_name text, dni text, email text, phone text)
        where p.id = u.id and p.clinic_id = ${clinicId}`;
    }
    if (oldPhones.length) await tx`insert into patient_phones ${tx(oldPhones)} on conflict (clinic_id, phone) do nothing`;
  });
  return { actualizados: updates.length };
}

/** Pacientes de Smile Connect que Turnia todavía no tiene: se suman de a estos por copia. */
const NEW_PATIENTS_PER_MIRROR = 1_000;

/**
 * Aplica a Turnia la última copia diaria (no gasta lecturas: ya se leyó). Cubre lo que las
 * sincronizaciones frecuentes no miran: asistencia, cancelaciones o cambios que el consultorio cargó
 * tarde en Smile Connect (hasta 30 días atrás), los turnos de 61 a 120 días y los datos de todos los
 * pacientes. Con su freno: si de golpe desaparecen muchos turnos de una ventana, esa ventana no se toca.
 */
export async function mirrorSmileBackup(clinicId: string, now = new Date()): Promise<Record<string, unknown>> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || conn.api_mode === "apagada") throw new Error("La conexión con Smile Connect está apagada.");
  const [b] = await sql<Array<{ patients: ScPatient[]; appointments: ScAppointment[]; taken_at: string }>>`
    select patients, appointments, taken_at from smile_connect_backups where clinic_id = ${clinicId} order by taken_at desc limit 1`;
  if (!b) return { omitida: "Todavía no hay copia." };
  const clinic = await getClinic(clinicId);
  const taken = new Date(b.taken_at);
  const today = localDateKey(taken, clinic.timezone);
  // Las ventanas que no mira la sincronización frecuente (cerca: de ayer a 4 días; lejos: hasta 61).
  const frequentFrom = localMidnight(addDaysKey(today, -1), clinic.timezone);
  const frequentTo = localMidnight(addDaysKey(today, 61), clinic.timezone);
  const windows: Array<[Date, Date]> = [
    [localMidnight(addDaysKey(today, -30), clinic.timezone), localMidnight(addDaysKey(today, -1), clinic.timezone)],
    [localMidnight(addDaysKey(today, 61), clinic.timezone), localMidnight(addDaysKey(today, 120), clinic.timezone)],
  ];
  const client = clientFor(conn);
  const { proIds, metadata } = await smileMetadata(client);
  const known = new Set(
    (await sql<Array<{ external_id: string }>>`select external_id from patient_external_ids where clinic_id = ${clinicId} and external_id like 'sc:%'`)
      .map((r) => r.external_id),
  );
  const out: Record<string, unknown> = {};
  const nowIso = now.toISOString();
  const byId = new Map(b.patients.map((p) => [p.patient_id, p]));
  for (const [i, [from, to]] of windows.entries()) {
    const label = i === 0 ? "pasado" : "lejano";
    const appts = b.appointments.filter((a) => Date.parse(a.start_date) >= from.getTime() && Date.parse(a.start_date) < to.getTime());
    const seen = new Set(appts.map((a) => `sc:${a.appointment_id}`));
    const vanished = (await sql<Array<{ external_id: string }>>`
      select external_id from appointments
      where clinic_id = ${clinicId} and source = 'smile_connect' and external_id like 'sc:%'
        and status in ('confirmado', 'pendiente') and starts_at >= ${from} and starts_at < ${to}`)
      .filter((r) => !seen.has(r.external_id));
    if (vanished.length > MAX_VANISHED) {
      out[label] = `Smile Connect dejó de mostrar ${vanished.length} turnos de golpe: esta ventana no se aplicó.`;
      continue;
    }
    // Los que faltan en la ventana pueden estar en otra parte de la copia (los movieron de día); si no, se
    // pregunta por ellos (pudieron ir más allá de los 120 días). Si la copia los ubica dentro de lo que miran
    // las sincronizaciones frecuentes, no se pisa lo que ellas trajeron después: solo no se da de baja nada.
    const elsewhere = new Map(b.appointments.map((a) => [`sc:${a.appointment_id}`, a]));
    const found = vanished.flatMap((r) => (elsewhere.has(r.external_id) ? [elsewhere.get(r.external_id)!] : []));
    const frequent = (a: ScAppointment) => Date.parse(a.start_date) >= frequentFrom.getTime() && Date.parse(a.start_date) < frequentTo.getTime();
    const moved = [
      ...found.filter((a) => !frequent(a)),
      ...(await stillInSmile(client, vanished.filter((r) => !elsewhere.has(r.external_id)).map((r) => r.external_id))),
    ];
    const keepAll = found.some(frequent);
    // Un turno cuyo paciente no está en la copia (no debería pasar) deja la ventana incompleta: no se da de baja nada.
    const usable = appts.filter((a) => known.has(`sc:${a.patient_id}`) || byId.has(a.patient_id));
    const complete = usable.length === appts.length;
    const events = complete ? await readEvents(conn, client, from, to) : null;
    const services = await serviceNames(client, usable);
    const payload = {
      ...(complete && !keepAll && { from: from.toISOString(), to: to.toISOString() }),
      metadata,
      appointments: [...usable, ...moved].map((a) => apiAppointmentPayload(a, known.has(`sc:${a.patient_id}`) ? undefined : byId.get(a.patient_id), nowIso, services)),
      ...(events && { events: events.filter((e) => proIds.has(e.professional_id)) }),
    };
    const { summary } = await syncSmileConnect(clinicId, payload, { mode: "live", actor: "Smile Connect (copia diaria)", skipBlocks: !events, now });
    out[label] = summary;
  }
  // Todos los pacientes: a los conocidos se les pasa lo que cambió allá y los nuevos se vinculan (o se
  // crean) de a NEW_PATIENTS_PER_MIRROR por copia, para que la primera vez no se pase del tiempo de la corrida.
  const fresh = b.patients.filter((p) => !known.has(`sc:${p.patient_id}`));
  const patients = [...b.patients.filter((p) => known.has(`sc:${p.patient_id}`)), ...fresh.slice(0, NEW_PATIENTS_PER_MIRROR)];
  const { parsed, summary } = await syncSmileConnect(clinicId, { metadata, patients, appointments: [] }, {
    mode: "live", actor: "Smile Connect (copia diaria)", skipBlocks: true, now,
  });
  out.pacientes = {
    nuevos: summary.patientsCreated,
    ...(fresh.length > NEW_PATIENTS_PER_MIRROR && { siguen_despues: fresh.length - NEW_PATIENTS_PER_MIRROR }),
    ...(await applySmilePatientChanges(clinicId, patients, parsed.patients)),
  };
  await sql`update smile_connect_connections set api_mirror_at = now(), api_mirror_summary = ${json(out)} where clinic_id = ${clinicId}`;
  return out;
}

// ── Pacientes (para escribir) ────────────────────────────────────────────────

/** Un paciente que no se puede identificar sin dudas en Smile Connect: lo resuelve recepción, no se crea otro. */
export class SmilePatientReview extends Error {}

const nameWords = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-zñ]+/).filter((w) => w.length >= 2);

/**
 * ¿Es la misma persona por el nombre? El primer nombre y el apellido de Smile Connect tienen que estar
 * en el nombre de Turnia. Sirve para el celular, que en una familia lo comparten varias personas.
 */
export function samePersonName(sc: { name: string; surname: string }, turniaName: string | null | undefined): boolean {
  const turnia = new Set(nameWords(turniaName));
  const first = nameWords(sc.name)[0];
  const surnames = nameWords(sc.surname);
  return Boolean(first && surnames.length && turnia.has(first) && surnames.some((w) => turnia.has(w)));
}

/**
 * Busca en Smile Connect por DNI o por celular. Nunca por nombre solo (hay homónimos). Por celular,
 * además tiene que coincidir el nombre: si no, el turno de un hijo quedaría a nombre de la madre.
 * Si hay más de una ficha que coincide, no se elige ni se crea otra: lo revisa recepción.
 */
export async function findSmilePatient(
  client: SmileClient,
  patient: { dni: string | null; phone: string | null; name?: string | null },
): Promise<ScPatient | null> {
  const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const dni = digits(patient.dni);
  if (dni.length >= 6) {
    const found = (await scSearchPatients(client, dni)).filter((p) => digits(p.id_number) === dni);
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new SmilePatientReview(`En Smile Connect hay ${found.length} fichas con el DNI ${dni}. Recepción tiene que elegir la correcta.`);
  }
  const phone = digits(patient.phone);
  const national = /^549\d{10}$/.test(phone) ? phone.slice(3) : null;
  if (national) {
    const found = (await scSearchPatients(client, national))
      .filter((p) => digits(p.phone_number).endsWith(national.slice(-8)))
      .filter((p) => samePersonName(p, patient.name));
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new SmilePatientReview(`En Smile Connect hay ${found.length} fichas con ese nombre y celular. Recepción tiene que elegir la correcta.`);
  }
  return null;
}

// ── Automatización ───────────────────────────────────────────────────────────

const minutesSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : Infinity);

/**
 * Del tope diario se guarda esto para lo que no puede esperar: confirmar y verificar los turnos de
 * Sofi. Si las sincronizaciones se comieran el cupo, los pedidos de los pacientes se confirmarían
 * recién cuando se renueva (a las 21 de la Argentina, medianoche UTC).
 */
export const WRITE_RESERVE = 1_000;
/** Lo mínimo que tiene que quedar para la ventana lejana y para la copia diaria. */
const WIDE_MIN_BUDGET = 2_000;
const BACKUP_MIN_BUDGET = 2_500;

/** Lo que gasta del cupo una sincronización cercana: páginas enteras, aunque vuelvan a medio llenar. */
export function nearPullCost(nearCount: number | null): number {
  const count = nearCount ?? 75;
  const limit = Math.min(100, Math.max(25, count + 25));
  return Math.max(1, Math.ceil(count / limit)) * limit + NEW_PATIENTS_PER_RUN;
}

/**
 * Cada cuántos minutos se puede traer la ventana cercana sin pasarse del cupo del día: el ritmo de
 * siempre (30 minutos de día, 2 horas de noche) o más espaciado si no alcanza. null: no alcanza.
 */
export function nearPullEvery(baseMinutes: number, cost: number, available: number, minutesLeft: number): number | null {
  if (available < cost) return null;
  return Math.max(baseMinutes, Math.ceil(minutesLeft / Math.floor(available / cost)));
}

/** Lecturas del cupo que quedan hoy (día UTC, como cuenta Smile Connect), sin la reserva para escribir. */
async function readsAvailable(clinicId: string, now: Date): Promise<number> {
  const [row] = await sql<Array<{ used: number }>>`
    select case when api_reads_day = (${now}::timestamptz at time zone 'utc')::date then api_reads else 0 end as used
    from smile_connect_connections where clinic_id = ${clinicId}`;
  return READ_CAP - WRITE_RESERVE - (row?.used ?? 0);
}

/**
 * Lo que va a gastar la copia diaria, por el tamaño de las anteriores (una copia que no entra en el cupo
 * se corta a la mitad y no sirve): los turnos de la última y, si toca la lista completa, los pacientes de
 * la última completa. La primera vez, un mínimo.
 */
async function backupCost(clinicId: string, fullPatients: boolean): Promise<number> {
  const [last] = await sql<Array<{ a: number }>>`
    select jsonb_array_length(appointments) as a from smile_connect_backups where clinic_id = ${clinicId} order by taken_at desc limit 1`;
  const [lastFull] = await sql<Array<{ p: number }>>`
    select jsonb_array_length(patients) as p from smile_connect_backups where clinic_id = ${clinicId} and patients_full order by taken_at desc limit 1`;
  if (!last || (fullPatients && !lastFull)) return BACKUP_MIN_BUDGET;
  const patients = fullPatients ? (Math.ceil(lastFull.p / 100) + 1) * 100 : 200;
  return patients + (Math.ceil(last.a / 100) + 5) * 100;
}

/**
 * Si Smile Connect rechaza la clave (venció, la revocaron o le sacaron permisos), Sofi no puede
 * verificar horarios y deriva todos los pedidos. Se avisa al consultorio por WhatsApp y a n8n, una vez
 * cada 12 horas, además de mostrarlo en el panel.
 */
export async function alertSmileKeyProblem(clinicId: string, e: unknown): Promise<void> {
  if (!(e instanceof SmileApiError) || (e.status !== 401 && e.status !== 403)) return;
  try {
    const bucket = Math.floor(Date.now() / (12 * 3600_000));
    const [first] = await sql`insert into channel_events (key) values (${`smile-clave:${clinicId}:${bucket}`}) on conflict do nothing returning key`;
    if (!first) return;
    const problem = smileErrorText(e);
    const body = [
      "⚠️ *Smile Connect no acepta la clave de Turnia*",
      problem,
      "Mientras tanto, Sofi no puede confirmar turnos con la agenda y le pasa los pedidos a recepción. Avisale a Turnia para cargar una clave nueva.",
      "",
      "_Aviso automático de Turnia._",
    ].join("\n");
    const phones = await sql<Array<{ phone: string }>>`select phone from clinic_notice_phones where clinic_id = ${clinicId}`;
    if (phones.length) {
      await sql`insert into clinic_notices ${sql(phones.map((p) => ({ clinic_id: clinicId, phone: p.phone, kind: "smile", body })))}`;
    }
    await notifyN8n("smile.clave", { clinic_id: clinicId, status: e.status, mensaje: problem });
    const clinic = await getClinic(clinicId);
    await sendAxel(`${axelHead(clinic.name)} no acepta la clave (${problem}). Sofi le pasa los pedidos a recepción hasta que se cargue una nueva: ${panelLink()}`);
  } catch (err) {
    console.error("Smile Connect: no se pudo avisar del problema con la clave", err instanceof Error ? err.message : err);
  }
}

// ── Historial de corridas ────────────────────────────────────────────────────

async function readsToday(clinicId: string): Promise<number> {
  const [row] = await sql<Array<{ used: number }>>`
    select case when api_reads_day = (now() at time zone 'utc')::date then api_reads else 0 end as used
    from smile_connect_connections where clinic_id = ${clinicId}`;
  return row?.used ?? 0;
}

/**
 * Corre un paso de la integración y lo anota en `smile_connect_runs`: qué fue, cuánto tardó, cuántas
 * lecturas del cupo gastó y cómo terminó. El historial nunca frena la sincronización.
 */
export async function trackSmileRun<T>(clinicId: string, kind: string, work: () => Promise<T>, opts: { skip?: (result: T) => boolean } = {}): Promise<T> {
  const started = new Date();
  const before = await readsToday(clinicId).catch(() => 0);
  const log = async (ok: boolean, summary: unknown, error: string | null) => {
    try {
      const reads = Math.max(0, (await readsToday(clinicId)) - before);
      await sql`
        insert into smile_connect_runs (clinic_id, kind, started_at, duration_ms, reads, ok, summary, error)
        values (${clinicId}, ${kind}, ${started}, ${Date.now() - started.getTime()}, ${reads}, ${ok},
                ${summary == null ? null : json(summary)}, ${error?.slice(0, 500) ?? null})`;
    } catch (e) {
      console.error("Smile Connect: no se pudo anotar la corrida", e instanceof Error ? e.message : e);
    }
  };
  try {
    const result = await work();
    if (!opts.skip?.(result)) await log(true, result, null);
    return result;
  } catch (e) {
    await log(false, null, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Las últimas corridas de una clínica, para el panel. */
export async function recentSmileRuns(clinicId: string, limit = 15) {
  return sql<Array<{ id: string; kind: string; started_at: string; duration_ms: number; reads: number; ok: boolean; error: string | null; summary: Record<string, unknown> | null }>>`
    select id::text, kind, started_at, duration_ms, reads, ok, error, summary
    from smile_connect_runs where clinic_id = ${clinicId} order by started_at desc limit ${limit}`;
}

// ── Avisos a Axel ────────────────────────────────────────────────────────────
// El consultorio trabaja solo en Smile Connect y nadie mira el panel todos los días: los problemas de la
// integración le llegan a Axel por WhatsApp, desde la línea de Turnia. Uno por problema, no por intento.

const panelLink = () => `${env.appUrl().replace(/\/$/, "")}/panel/configuracion/calendario#smile-connect-api`;
const axelHead = (clinic: string) => `⚠️ Turnia · Smile Connect de ${clinic}:`;
const shortHash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 16);

async function sendAxel(text: string): Promise<boolean> {
  const { notifyAxel } = await import("./chat-guard");
  return notifyAxel(text);
}

/**
 * Manda el aviso si esa clave de aviso no salió antes. Si el WhatsApp falla (por ejemplo, con la línea de
 * Turnia pausada), se reintenta una vez por hora, no en cada vuelta de 10 minutos.
 */
async function alertAxelOnce(key: string, text: string): Promise<boolean> {
  const failed = `${key}:fallo:${Math.floor(Date.now() / 3600_000)}`;
  const [blocked] = await sql`select 1 from channel_events where key = ${failed}`;
  if (blocked) return false;
  const [claimed] = await sql`insert into channel_events (key) values (${key}) on conflict do nothing returning key`;
  if (!claimed) return false;
  if (await sendAxel(text)) return true;
  await sql`delete from channel_events where key = ${key}`;
  await sql`insert into channel_events (key) values (${failed}) on conflict do nothing`;
  return false;
}

/** Sin la ventana cercana por más de esto, la agenda de Turnia quedó vieja: se avisa. */
const STALE_NEAR_MIN = 3 * 60;
/** Con la sincronización por cambios (cada 10 minutos de día, 30 de noche), el aviso es antes. */
const STALE_DELTA_MIN = 90;
/** Sin copia por más de esto (corre una vez por día), se avisa. */
const STALE_BACKUP_MIN = 30 * 60;
/** Cada cuánto conviene renovar la clave de la API. */
const KEY_ROTATE_DAYS = 180;

/**
 * Revisa cómo quedó la integración de una clínica después de cada vuelta y le avisa a Axel lo que hay que
 * mirar: la agenda que dejó de sincronizarse (con el motivo), la escritura frenada, la copia diaria vieja o
 * con problemas, los horarios para revisar (un profesional nuevo o que ya no está) y, una vez por clave, si
 * falta el permiso de los bloqueos. Devuelve las claves de los avisos que salieron.
 */
export async function checkSmileHealth(clinicId: string, run: Record<string, unknown> = {}, now = new Date()): Promise<string[]> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || conn.api_mode === "apagada") return [];
  const clinic = await getClinic(clinicId);
  const head = axelHead(clinic.name);
  const day = localDateKey(now, clinic.timezone);
  const half = Math.floor(now.getTime() / (12 * 3600_000));
  const connectedFor = minutesSince(conn.api_checked_at);
  const sent: string[] = [];
  const alert = async (key: string, text: string) => {
    if (await alertAxelOnce(`smile-axel:${key}:${clinicId}`, text)) sent.push(key.split(":")[0]);
  };

  // Con la sincronización por cambios, lo fresco es lo último que trajo (cada 10 minutos); sin ella, la ventana cercana.
  const lastFresh = conn.api_supports_delta && conn.api_delta_at ? conn.api_delta_at : conn.api_near_pull_at;
  const staleAfter = conn.api_supports_delta ? STALE_DELTA_MIN : STALE_NEAR_MIN;
  if (connectedFor > staleAfter && minutesSince(lastFresh) > staleAfter) {
    const since = lastFresh ? `desde el ${formatWhen(lastFresh, clinic.timezone)}` : "todavía";
    const why = conn.api_error ?? (typeof run.cupo === "string" ? run.cupo : "sin un error registrado");
    await alert(`agenda:${half}`, `${head} la agenda no se sincroniza ${since} (${why}). Sofi igual verifica cada horario en vivo, pero sus turnos y la asistencia en Turnia pueden estar atrasados: ${panelLink()}`);
  }
  if (conn.api_writes_paused) {
    await alert(`escritura:${day}`, `${head} la escritura quedó frenada: ${conn.api_writes_paused} Se reanuda desde el panel: ${panelLink()}`);
  }
  if (connectedFor > STALE_BACKUP_MIN && minutesSince(conn.api_backup_at) > STALE_BACKUP_MIN) {
    await alert(`copia:${day}`, `${head} no se hizo la copia diaria ${conn.api_backup_at ? `desde el ${formatWhen(conn.api_backup_at, clinic.timezone)}` : "todavía"}. Sin ella no llegan a Turnia la asistencia cargada tarde ni los cambios de los pacientes. Mirá «Lecturas de hoy» y «Último problema»: ${panelLink()}`);
  }
  const mirror = conn.api_mirror_summary ?? {};
  const mirrorProblems = Object.entries(mirror).flatMap(([k, v]) => (typeof v === "string" ? [k === "error" ? v : `${k}: ${v}`] : []));
  if (conn.api_mirror_at && mirrorProblems.length) {
    await alert(`espejo:${shortHash(conn.api_mirror_at)}`, `${head} la copia diaria no se pudo pasar entera a Turnia: ${mirrorProblems.join(" ")} ${panelLink()}`);
  }
  for (const line of (conn.api_hours_note ?? "").split("\n").filter(Boolean)) {
    await alert(`horarios:${shortHash(line)}`, line.startsWith("Horarios copiados")
      ? `ℹ️ Turnia · Smile Connect de ${clinic.name}: ${line}`
      : `${head} ${line} ${panelLink()}`);
  }
  // Buena práctica de seguridad: renovar la clave cada tanto. Es sin vencimiento para que la integración no
  // se corte sola; a los 6 meses se le recuerda a Axel (una vez por clave).
  if (conn.api_key_saved_at && minutesSince(conn.api_key_saved_at) > KEY_ROTATE_DAYS * 24 * 60) {
    await alert(`clave-vieja:${conn.api_key_hint ?? "clave"}`, `${head} la clave de la API se cargó el ${formatWhen(conn.api_key_saved_at, clinic.timezone)}. Conviene renovarla: que el consultorio cree una nueva sin vencimiento con los mismos permisos (tarea 10 de TAREAS_COMPUTER_USE.md), cargarla y después revocar la anterior en Smile Connect.`);
  }
  if (conn.api_events_ok === false) {
    await alert(`bloqueos:${conn.api_key_hint ?? "clave"}`, `${head} la clave no tiene el permiso events:read, así que la Agenda de Turnia no muestra los bloqueos (Sofi los respeta igual). Hace falta una clave nueva con ese permiso: tarea 10 de TAREAS_COMPUTER_USE.md.`);
  }
  return sent;
}

const formatWhen = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

async function recordAndAlert(clinicId: string, e: unknown): Promise<string> {
  await alertSmileKeyProblem(clinicId, e);
  return recordSmileError(clinicId, e);
}

/**
 * Corre cada 10 minutos (/api/automations/calendario) para cada clínica con la conexión prendida:
 * lo pendiente de escribir, la sincronización cercana (cada 30 minutos de 7 a 22, cada 2 horas de
 * noche, o más espaciada si el cupo del día no alcanza), la lejana (cada 8 horas) y la copia diaria
 * (de 3 a 6 de la mañana). Del cupo diario siempre queda una reserva para confirmar turnos.
 */
export async function runSmileConnect(now = new Date()): Promise<Record<string, unknown>> {
  const conns = await sql<Array<SmileApiConnection & { timezone: string }>>`
    select c.clinic_id, c.api_mode, c.api_near_pull_at, c.api_near_count, c.api_wide_pull_at, c.api_backup_at,
           c.api_hours_at, c.api_mirror_at, c.api_patients_full_at, c.api_patients_last_id::int as api_patients_last_id,
           c.api_supports_delta, c.api_delta_at, cl.timezone
    from smile_connect_connections c join clinics cl on cl.id = c.clinic_id
    where c.api_key_encrypted is not null and c.api_mode <> 'apagada'`;
  const out: Record<string, unknown> = {};
  const { pushPendingSmile } = await import("./smile-connect-push");
  if (conns.length) await sql`delete from smile_connect_runs where started_at < now() - interval '30 days'`.catch(() => {});
  const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutesLeft = Math.max(1, (nextUtcMidnight - now.getTime()) / 60_000);
  for (const c of conns) {
    const hour = zonedParts(now, c.timezone).hour;
    const result: Record<string, unknown> = {};
    if (WRITE_MODES.includes(c.api_mode)) {
      try {
        // Solo queda en el historial si hubo algo para escribir (corre cada 10 minutos).
        const pending = await trackSmileRun(c.clinic_id, "escritura", () => pushPendingSmile(c.clinic_id), {
          skip: (r) => Object.keys(r).length === 0 || Object.values(r).every((v) => v === 0),
        });
        result.escritura = pending;
        if (pending.reintentar_en) {
          // Smile Connect pidió esperar: no se lee nada en esta vuelta, pero si dura horas, Axel se entera.
          await checkSmileHealth(c.clinic_id, result, now).catch(() => []);
          out[c.clinic_id] = result;
          continue;
        }
      } catch (e) {
        result.error_escritura = await recordAndAlert(c.clinic_id, e);
      }
    }
    // Con la sincronización por cambios, lo que cambia llega cada 10 minutos (30 de noche) y las ventanas
    // pasan a ser una conciliación: la cercana cada 3 horas y la lejana cada 12.
    if (c.api_supports_delta && minutesSince(c.api_delta_at) >= (hour >= 7 && hour < 22 ? 10 : 30)) {
      try {
        result.cambios = await trackSmileRun(c.clinic_id, "cambios", () => pullSmileChanges(c.clinic_id, now), {
          skip: (r) => r.leidos === 0 && r.pacientes_cambiados === 0 && r.patientsCreated === 0,
        });
      } catch (e) {
        result.error_cambios = await recordAndAlert(c.clinic_id, e);
      }
    }
    try {
      const base = c.api_supports_delta ? 180 : hour >= 7 && hour < 22 ? 30 : 120;
      const every = nearPullEvery(base, nearPullCost(c.api_near_count), await readsAvailable(c.clinic_id, now), minutesLeft);
      if (every === null) result.cupo = "No alcanza el cupo de lecturas de hoy: la sincronización sigue cuando se renueva.";
      else if (minutesSince(c.api_near_pull_at) >= every) result.cerca = await trackSmileRun(c.clinic_id, "cerca", () => pullSmileConnect(c.clinic_id, "cerca", now));
      if (minutesSince(c.api_wide_pull_at) >= (c.api_supports_delta ? 12 : 8) * 60 && (await readsAvailable(c.clinic_id, now)) >= WIDE_MIN_BUDGET) {
        result.lejos = await trackSmileRun(c.clinic_id, "lejos", () => pullSmileConnect(c.clinic_id, "lejos", now));
      }
    } catch (e) {
      result.error = await recordAndAlert(c.clinic_id, e);
    }
    // El horario semanal de cada profesional, cada 6 horas (3 o 4 pedidos que no gastan cupo).
    if (minutesSince(c.api_hours_at) >= 6 * 60) {
      try {
        result.horarios = await trackSmileRun(c.clinic_id, "horarios", () => syncSmileHours(c.clinic_id));
      } catch (e) {
        result.error_horarios = await recordAndAlert(c.clinic_id, e);
      }
    }
    if (hour >= 3 && hour < 6 && minutesSince(c.api_backup_at) >= 20 * 60 && (await readsAvailable(c.clinic_id, now)) >= await backupCost(c.clinic_id, patientsFullDue(c))) {
      try {
        result.copia = await trackSmileRun(c.clinic_id, "copia", () => backupSmileConnect(c.clinic_id, now));
      } catch (e) {
        result.error_copia = await recordAndAlert(c.clinic_id, e);
      }
    } else if (c.api_backup_at && minutesSince(c.api_backup_at) < 20 * 60 && (!c.api_mirror_at || Date.parse(c.api_mirror_at) < Date.parse(c.api_backup_at))) {
      // La copia se aplica a Turnia en la vuelta siguiente, para no sumar las dos en la misma corrida.
      try {
        result.espejo = await trackSmileRun(c.clinic_id, "espejo", () => mirrorSmileBackup(c.clinic_id, now));
      } catch (e) {
        result.error_espejo = await recordAndAlert(c.clinic_id, e);
        // No se reintenta cada 10 minutos: queda el error en el panel y se prueba con la copia de mañana.
        await sql`update smile_connect_connections set api_mirror_at = now(), api_mirror_summary = ${json({ error: result.error_espejo })} where clinic_id = ${c.clinic_id}`;
      }
    }
    try {
      const avisos = await checkSmileHealth(c.clinic_id, result, now);
      if (avisos.length) result.avisos_axel = avisos;
    } catch (e) {
      console.error("Smile Connect: no se pudo revisar el estado para avisar", e instanceof Error ? e.message : e);
    }
    out[c.clinic_id] = result;
  }
  return out;
}
