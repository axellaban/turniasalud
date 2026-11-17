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
  scAppointments,
  scAvailability,
  scBoxes,
  scClinic,
  scPatient,
  scProfessionals,
  scSearchPatients,
  scSupportsNotes,
  SmileApiError,
  smileClient,
  smileErrorText,
  type ScAppointment,
  type ScPatient,
  type ScSlot,
  type SmileClient,
  type SmileRequest,
} from "./smile-connect-api";
import { addDaysKey, localDateKey, zonedParts, zonedTimeToUtc } from "./time";

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
  crear: { label: "Crear turnos", detail: "Sofi confirma los turnos simples después de verificarlos en Smile Connect. Recepción coordina los cambios y las cancelaciones." },
  completa: { label: "Crear, mover y cancelar", detail: "Sofi y el equipo pueden mover o cancelar los turnos habilitados. Los cambios se confirman después de verificarlos en Smile Connect." },
};
export const WRITE_MODES: readonly SmileMode[] = ["sombra", "crear", "completa"];

/** Del cupo diario de 10.000 registros (pacientes y turnos) por clínica, Turnia usa hasta 8.000. */
export const READ_CAP = 8_000;
const AVAILABILITY_TTL_MS = 2 * 60_000;
const AVAILABILITY_STALE_MS = 30 * 60_000;
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
};

export class SmileBudgetError extends Error {}

/** La escritura real necesita además SMILE_CONNECT_WRITES=on en el servidor. Si no, es de prueba. */
export const writesEnabledOnServer = () => process.env.SMILE_CONNECT_WRITES === "on";

export async function getSmileApiConnection(clinicId: string, tx?: TransactionSql): Promise<SmileApiConnection | null> {
  const [row] = await (tx ?? sql)<SmileApiConnection[]>`
    select clinic_id, api_key_encrypted, api_key_hint, api_clinic_id, api_clinic_name, api_mode, api_error, api_error_at,
           api_checked_at, api_near_pull_at, api_near_count, api_wide_pull_at, api_backup_at, api_reads_day::text as api_reads_day,
           api_reads, api_supports_notes, api_writes_paused, api_retry_at
    from smile_connect_connections where clinic_id = ${clinicId}`;
  return row ?? null;
}

/** Cuenta los registros que va a leer y frena antes de pasarse del cupo del día (hora UTC). */
async function reserveReads(clinicId: string, n: number, tx?: TransactionSql): Promise<void> {
  const [row] = await (tx ?? sql)<Array<{ api_reads: number }>>`
    update smile_connect_connections set
      api_reads = case when api_reads_day = (now() at time zone 'utc')::date then api_reads + ${n} else ${n} end,
      api_reads_day = (now() at time zone 'utc')::date
    where clinic_id = ${clinicId}
    returning api_reads`;
  if (!row || row.api_reads > READ_CAP) {
    throw new SmileBudgetError(`Se llegó al tope diario de lecturas de Smile Connect (${READ_CAP}). Sigue mañana.`);
  }
}

export function clientFor(conn: Pick<SmileApiConnection, "clinic_id" | "api_key_encrypted">, timeoutMs?: number, tx?: TransactionSql): SmileClient {
  if (!conn.api_key_encrypted) throw new Error("Este consultorio no tiene la clave de la API de Smile Connect.");
  return smileClient(decryptSecret(conn.api_key_encrypted), { onReserve: (n) => reserveReads(conn.clinic_id, n, tx), timeoutMs });
}

export async function recordSmileError(clinicId: string, e: unknown): Promise<string> {
  const message = e instanceof SmileBudgetError ? e.message : smileErrorText(e);
  await sql`update smile_connect_connections set api_error = ${message.slice(0, 300)}, api_error_at = now() where clinic_id = ${clinicId}`;
  return message;
}

const clearSmileError = (clinicId: string) =>
  sql`update smile_connect_connections set api_error = null, api_error_at = null where clinic_id = ${clinicId} and api_error is not null`;

// ── La clave ─────────────────────────────────────────────────────────────────

export type SmileKeyCheck = {
  clinicName: string | null;
  smileClinicId: number;
  supportsNotes: boolean;
  professionals: Array<{ smileId: number; name: string; box: string | null; turnia: string | null }>;
};

/** Mapea los profesionales de Smile Connect con los de Turnia (por nombre) y guarda cuál es cuál. */
async function mapProfessionals(clinicId: string, client: SmileClient): Promise<SmileKeyCheck["professionals"]> {
  const [pros, boxes] = await Promise.all([scProfessionals(client), scBoxes(client)]);
  const turnia = [...(await sql<Array<{ id: string; full_name: string }>>`
    select id, full_name from professionals where clinic_id = ${clinicId} order by active desc, created_at`)];
  const used = new Set<string>();
  const out: SmileKeyCheck["professionals"] = [];
  for (const p of pros) {
    const name = `${p.name} ${p.surname}`.replace(/\s+/g, " ").trim();
    const match = matchProfessional(name, turnia.filter((t) => !used.has(t.id)));
    if (match) {
      used.add(match.id);
      await sql`
        update professionals set smile_professional_id = ${p.professional_id}, smile_box_id = ${p.box_id}
        where id = ${match.id} and clinic_id = ${clinicId}`;
    }
    out.push({ smileId: p.professional_id, name, box: boxes.find((b) => b.box_id === p.box_id)?.name ?? null, turnia: match?.full_name ?? null });
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
  await ensureSmileConnectToken(clinicId);
  await sql`
    update smile_connect_connections set
      api_key_encrypted = ${encryptSecret(key)}, api_key_hint = ${key.slice(-4)},
      api_clinic_id = ${clinic.clinic_id}, api_clinic_name = ${clinic.clinic_name},
      api_checked_at = now(), api_error = null, api_error_at = null, api_retry_at = null,
      api_supports_notes = ${supportsNotes}, updated_at = now()
    where clinic_id = ${clinicId}`;
  const professionals = await mapProfessionals(clinicId, client);
  return { clinicName: clinic.clinic_name, smileClinicId: clinic.clinic_id, supportsNotes, professionals };
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

/** Turno de la API → formato que entiende el sincronizador (el mismo del userscript). */
export function apiAppointmentPayload(a: ScAppointment, patient: ScPatient | undefined, nowIso: string): Record<string, unknown> {
  return {
    appointment_id: a.appointment_id,
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

/**
 * Trae de Smile Connect los turnos de una ventana y los sincroniza (sin bloqueos: la API no los da;
 * Sofi los ve en la disponibilidad en vivo). Los pacientes que Turnia no conoce se leen de a uno.
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
  const [pros, boxes] = await Promise.all([scProfessionals(client), scBoxes(client)]);
  const metadata = {
    professionals: pros.map((p) => ({ professional_id: p.professional_id, name: p.name, surname: p.surname, box_id: p.box_id, active: true })),
    boxes: boxes.map((b) => ({ box_id: b.box_id, name: b.name })),
  };
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

    const nowIso = now.toISOString();
    const payload = {
      from: from.toISOString(),
      to: to.toISOString(),
      metadata,
      appointments: usable.map((a) => apiAppointmentPayload(a, fetched.get(a.patient_id), nowIso)),
    };
    const { summary } = await syncSmileConnect(clinicId, payload, { mode: "live", actor: "Smile Connect (API)", skipBlocks: true, now });
    for (const k of Object.keys(summary) as Array<keyof SmileConnectSyncSummary>) total[k] += summary[k];
    if (which === "cerca") {
      await sql`update smile_connect_connections set api_near_pull_at = now(), api_near_count = ${appts.length} where clinic_id = ${clinicId}`;
    }
  }
  if (which === "lejos") await sql`update smile_connect_connections set api_wide_pull_at = now() where clinic_id = ${clinicId}`;
  await clearSmileError(clinicId);
  return total;
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
 */
export async function smileBusy(
  clinicId: string,
  professionalIds: string[],
  from: Date,
  to: Date,
  opts: { fresh?: boolean; verified?: { from: string; to: string }; timeZone: string },
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
  const deadline = Date.now() + 12_000;
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
  for (let d = first < today ? today : first; d <= last && days.length < 62; d = addDaysKey(d, 1)) days.push(d);

  const out: BusyInterval[] = [];
  let verifiedDays = 0;
  // De a cuatro días a la vez: la API permite 90 pedidos por minuto.
  for (let i = 0; i < days.length; i += 4) {
    const chunk = days.slice(i, i + 4);
    const results = await Promise.all(chunk.map((day) => {
      if (!opts.verified) return daySlots(conn, client, day, fresh, professionalId);
      if (!pros.length || Date.now() >= deadline) return null;
      return daySlots(conn, client, day, true, professionalId).catch(() => null);
    }));
    chunk.forEach((day, j) => {
      const slots = results[j];
      if (!slots && !opts.verified) return;
      if (slots) verifiedDays++;
      const free = freeRanges(slots ?? []);
      const start = localMidnight(day, opts.timeZone).getTime();
      const end = localMidnight(addDaysKey(day, 1), opts.timeZone).getTime();
      for (const p of selected) {
        for (const [a, b] of busyFromFree(p.smileId ? free.get(p.smileId) ?? [] : [], start, end)) {
          out.push({ professional_id: p.id, starts_at: new Date(a).toISOString(), ends_at: new Date(b).toISOString(), source: "smile" });
        }
      }
    });
  }
  if (opts.verified && !verifiedDays) throw new Error("Smile Connect no devolvió disponibilidad para las fechas pedidas.");
  return out;
}

// ── Copia diaria ─────────────────────────────────────────────────────────────

/** Copia de los pacientes y de los turnos de 30 días atrás a 120 adelante. Guarda las últimas 14. */
export async function backupSmileConnect(clinicId: string, now = new Date()): Promise<{ pacientes: number; turnos: number }> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted) throw new Error("Falta la clave de la API de Smile Connect.");
  const clinic = await getClinic(clinicId);
  const client = clientFor(conn);
  const today = localDateKey(now, clinic.timezone);
  const from = localMidnight(addDaysKey(today, -30), clinic.timezone);
  const to = localMidnight(addDaysKey(today, 120), clinic.timezone);
  const patients = await scAllPatients(client);
  const appointments: ScAppointment[] = [];
  for (let start = from; start < to; ) {
    const end = new Date(Math.min(start.getTime() + 31 * 86_400_000, to.getTime()));
    appointments.push(...(await scAppointments(client, start, end, 100)));
    start = end;
  }
  await sql`
    insert into smile_connect_backups (clinic_id, patients, appointments, window_from, window_to)
    values (${clinicId}, ${json(patients)}, ${json(appointments)}, ${from}, ${to})`;
  await sql`
    delete from smile_connect_backups where clinic_id = ${clinicId} and id not in (
      select id from smile_connect_backups where clinic_id = ${clinicId} order by taken_at desc limit 14)`;
  const supportsNotes = await scSupportsNotes(client).catch(() => conn.api_supports_notes);
  await sql`update smile_connect_connections set api_backup_at = now(), api_supports_notes = ${supportsNotes} where clinic_id = ${clinicId}`;
  return { pacientes: patients.length, turnos: appointments.length };
}

// ── Pacientes (para escribir) ────────────────────────────────────────────────

/** Busca en Smile Connect por DNI o por celular. Nunca por nombre solo (hay homónimos). */
export async function findSmilePatient(
  client: SmileClient,
  patient: { dni: string | null; phone: string | null },
): Promise<ScPatient | null> {
  const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const dni = digits(patient.dni);
  if (dni.length >= 6) {
    const found = (await scSearchPatients(client, dni)).filter((p) => digits(p.id_number) === dni);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  const phone = digits(patient.phone);
  const national = /^549\d{10}$/.test(phone) ? phone.slice(3) : null;
  if (national) {
    const found = (await scSearchPatients(client, national)).filter((p) => digits(p.phone_number).endsWith(national.slice(-8)));
    if (found.length === 1) return found[0];
  }
  return null;
}

// ── Automatización ───────────────────────────────────────────────────────────

const minutesSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : Infinity);

/**
 * Corre cada 10 minutos (/api/automations/calendario) para cada clínica con la conexión prendida:
 * la sincronización cercana (cada 30 minutos de 7 a 22, cada 2 horas de noche), la lejana (cada
 * 8 horas), lo pendiente de escribir y la copia diaria (de 3 a 6 de la mañana).
 */
export async function runSmileConnect(now = new Date()): Promise<Record<string, unknown>> {
  const conns = await sql<Array<SmileApiConnection & { timezone: string }>>`
    select c.clinic_id, c.api_mode, c.api_near_pull_at, c.api_wide_pull_at, c.api_backup_at, cl.timezone
    from smile_connect_connections c join clinics cl on cl.id = c.clinic_id
    where c.api_key_encrypted is not null and c.api_mode <> 'apagada'`;
  const out: Record<string, unknown> = {};
  const { pushPendingSmile } = await import("./smile-connect-push");
  for (const c of conns) {
    const hour = zonedParts(now, c.timezone).hour;
    const result: Record<string, unknown> = {};
    if (WRITE_MODES.includes(c.api_mode)) {
      try {
        const pending = await pushPendingSmile(c.clinic_id);
        result.escritura = pending;
        if (pending.reintentar_en) {
          out[c.clinic_id] = result;
          continue;
        }
      } catch (e) {
        result.error_escritura = await recordSmileError(c.clinic_id, e);
      }
    }
    try {
      if (minutesSince(c.api_near_pull_at) >= (hour >= 7 && hour < 22 ? 30 : 120)) result.cerca = await pullSmileConnect(c.clinic_id, "cerca", now);
      if (minutesSince(c.api_wide_pull_at) >= 8 * 60) result.lejos = await pullSmileConnect(c.clinic_id, "lejos", now);
    } catch (e) {
      result.error = await recordSmileError(c.clinic_id, e);
    }
    if (hour >= 3 && hour < 6 && minutesSince(c.api_backup_at) >= 20 * 60) {
      try {
        result.copia = await backupSmileConnect(c.clinic_id, now);
      } catch (e) {
        result.error_copia = await recordSmileError(c.clinic_id, e);
      }
    }
    out[c.clinic_id] = result;
  }
  return out;
}
