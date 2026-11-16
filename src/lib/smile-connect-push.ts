import "server-only";
import { json, sql, type TransactionSql } from "./db";
import { displayPhone } from "./phone";
import {
  fitsFree,
  freeRanges,
  scAppointment,
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
import { clientFor, findSmilePatient, getSmileApiConnection, writesEnabledOnServer, WRITE_MODES, type SmileApiConnection } from "./smile-connect-link";
import { localDateKey } from "./time";

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
/** Más que esto en una hora no es normal en un consultorio: se frena la escritura y se avisa. */
const MAX_WRITES_PER_HOUR = 15;
const ACTIVE = ["confirmado", "pendiente"];

type Row = {
  id: string;
  clinic_id: string;
  patient_id: string;
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
  type_name: string;
  smile_professional_id: number | null;
  smile_box_id: number | null;
  professional: string;
  timezone: string;
  agent_name: string;
};

type Outcome = { status: "ok" | "revisar" | "error" | "sombra" | "nada"; message?: string };

const scIdOf = (external: string | null) => {
  const m = /^sc:(\d+)$/.exec(external ?? "");
  return m ? Number(m[1]) : null;
};
const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

class Review extends Error {}

async function logChange(
  tx: TransactionSql,
  row: Pick<Row, "clinic_id" | "id">,
  action: "crear_paciente" | "crear" | "mover" | "cancelar",
  status: "hecho" | "sombra" | "error" | "revisar",
  data: { request?: unknown; before?: unknown; result?: unknown; error?: string },
) {
  await tx`
    insert into smile_connect_changes (clinic_id, appointment_id, action, status, request, before, result, error)
    values (${row.clinic_id}, ${row.id}, ${action}, ${status}, ${data.request === undefined ? null : json(data.request)},
      ${data.before === undefined ? null : json(data.before)}, ${data.result === undefined ? null : json(data.result)}, ${data.error ?? null})`;
}

/** El motivo del turno, si la API ya acepta notas. */
function notesFor(row: Row, conn: SmileApiConnection): { notes?: string } {
  if (!conn.api_supports_notes) return {};
  const title = row.title && row.title.toLowerCase() !== row.type_name.toLowerCase() ? ` (${row.title})` : "";
  const text = [`${row.type_name}${title}`, row.notes, `Lo dio ${row.agent_name || "Sofi"} (Turnia)`].filter(Boolean).join(" · ");
  return { notes: text.slice(0, 500) };
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
  const found = await findSmilePatient(client, { dni: p?.dni ?? null, phone: p?.phone ?? null });
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
  const slots = await scAvailability(client, day, 5, row.smile_professional_id!);
  if (own && !own.cancelled && own.professional_ids[0] === row.smile_professional_id) {
    slots.push({ start: own.start_date, end: own.end_date, professionalId: row.smile_professional_id! });
  }
  const free = freeRanges(slots).get(row.smile_professional_id!) ?? [];
  if (!fitsFree(free, Date.parse(row.starts_at), Date.parse(row.ends_at))) {
    throw new Review("En Smile Connect ese horario ya está ocupado o bloqueado: el turno quedó solo en Turnia. Revisalo con el paciente.");
  }
}

function describe(row: Pick<Row, "starts_at" | "professional" | "timezone">): string {
  const d = new Date(row.starts_at);
  const day = new Intl.DateTimeFormat("es-AR", { timeZone: row.timezone, weekday: "long", day: "numeric", month: "numeric" }).format(d);
  const hour = new Intl.DateTimeFormat("es-AR", { timeZone: row.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day} ${hour} con ${row.professional}`;
}

async function processRow(tx: TransactionSql, conn: SmileApiConnection, client: SmileClient, row: Row): Promise<Outcome> {
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

  // ¿Es el turno nuevo de uno que se movió? Entonces se mueve el de Smile Connect.
  const [previous] = scId ? [] : await tx<Row[]>`
    select a.*, '' as type_name from appointments a
    where a.replaced_by = ${row.id} and a.clinic_id = ${row.clinic_id} and a.external_id ~ '^sc:[0-9]+$'`;
  const moving = scId ?? scIdOf(previous?.external_id ?? null);
  if (moving) {
    const known = previous ?? row;
    if (conn.api_mode === "crear") {
      throw new Review(`Movelo a mano en Smile Connect: ${previous ? `de ${describe({ ...row, starts_at: previous.starts_at })} ` : ""}a ${describe(row)}.`);
    }
    const before = await precheck(tx, client, row, moving, previous ? { starts_at: previous.starts_at, ends_at: previous.ends_at } : row);
    if (before.cancelled) throw new Review("En Smile Connect ese turno ya estaba cancelado. No se movió: revisalo.");
    const sameTimes = sameInstant(before.start_date, row.starts_at) && sameInstant(before.end_date, row.ends_at) && before.professional_ids[0] === row.smile_professional_id;
    if (!sameTimes) {
      await assertFreeInSmile(client, row, before);
      const request = { ...times(row), ...notesFor(row, conn) };
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
  const request = { patient_id: patientId ?? 0, ...times(row), ...notesFor(row, conn) };
  if (!real || !patientId) {
    await logChange(tx, row, "crear", "sombra", { request });
    return { status: "sombra" };
  }
  const result = await scCreateAppointment(client, { ...request, patient_id: patientId }, `turnia-turno-${row.id}`);
  await tx`update appointments set external_id = ${`sc:${result.appointment_id}`} where id = ${row.id}`;
  await logChange(tx, row, "crear", "hecho", { request, result });
  return { status: "ok" };
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

/**
 * Escribe en Smile Connect lo pendiente de una clínica (de a un turno, con su verificación).
 * Corre después de los cambios y con la automatización de cada 10 minutos.
 */
export async function pushPendingSmile(clinicId: string): Promise<Record<string, number | string>> {
  const conn = await getSmileApiConnection(clinicId);
  if (!conn?.api_key_encrypted || !WRITE_MODES.includes(conn.api_mode)) return { omitido: "La escritura está apagada." };
  if (conn.api_writes_paused) return { frenado: conn.api_writes_paused };
  const client = clientFor(conn);
  const pending = await sql<Array<{ id: string }>>`
    select id from appointments
    where clinic_id = ${clinicId} and smile_sync in ('pendiente', 'error') and smile_attempts < ${MAX_ATTEMPTS}
    order by created_at limit 20`;
  const result = { ok: 0, sombra: 0, revisar: 0, error: 0 };
  for (const { id } of pending) {
    const [{ n }] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from smile_connect_changes
      where clinic_id = ${clinicId} and status = 'hecho' and created_at > now() - interval '1 hour'`;
    if (n >= MAX_WRITES_PER_HOUR) {
      const reason = `Se frenó la escritura en Smile Connect: hubo ${n} cambios en la última hora. Revisá el registro y reanudala.`;
      await sql`update smile_connect_connections set api_writes_paused = ${reason} where clinic_id = ${clinicId}`;
      return { ...result, frenado: reason };
    }
    const outcome = await sql.begin(async (tx) => {
      await tx`select set_config('turnia.smile_quiet', 'on', true)`;
      const [row] = await tx<Row[]>`
        select a.id, a.clinic_id, a.patient_id, a.professional_id, a.second_professional_id, a.starts_at, a.ends_at, a.status, a.source,
               a.notes, a.title, a.external_id, a.external_status, a.replaced_by, a.smile_attempts,
               t.name as type_name, p.smile_professional_id, p.smile_box_id, p.full_name as professional, c.timezone, c.agent_name
        from appointments a
          join appointment_types t on t.id = a.appointment_type_id
          join professionals p on p.id = a.professional_id
          join clinics c on c.id = a.clinic_id
        where a.id = ${id} and a.smile_sync in ('pendiente', 'error')
        for update of a skip locked`;
      if (!row) return null;
      try {
        const out = await processRow(tx, conn, client, row);
        await tx`
          update appointments set smile_sync = ${out.status === "nada" ? null : "ok"}, smile_error = null
          where id = ${row.id}`;
        return out;
      } catch (e) {
        const review = e instanceof Review || (e instanceof SmileApiError && !e.transient);
        const message = (e instanceof Review ? e.message : smileErrorText(e)).slice(0, 300);
        await tx`
          update appointments set smile_sync = ${review ? "revisar" : "error"}, smile_error = ${message}, smile_attempts = smile_attempts + 1
          where id = ${row.id}`;
        if (review) {
          await logChange(tx, row, row.status === "cancelado" ? "cancelar" : row.external_id ? "mover" : "crear", "revisar", { error: message });
          await noticeReview(tx, row, message);
        }
        return { status: review ? "revisar" : "error", message } as Outcome;
      }
    });
    if (!outcome) continue;
    if (outcome.status === "ok") result.ok++;
    if (outcome.status === "sombra") result.sombra++;
    if (outcome.status === "revisar") result.revisar++;
    if (outcome.status === "error") result.error++;
  }
  return result;
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
    await tx`update appointments set smile_sync = null, smile_error = null where id = ${appointmentId} and clinic_id = ${clinicId}`;
  });
}
