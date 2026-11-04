import "server-only";
import { after } from "next/server";
import { sql } from "../db";
import { env } from "../env";
import type { BusyInterval } from "../slots";
import { humanSlot, zonedTimeToUtc } from "../time";
import { calendarFetch, getConnection, GoogleError, type CalendarConnection } from "./google";

// Agenda ↔ Google Calendar.
// - Lectura: lo ocupado en el calendario del profesional deja de ofrecerse. Se ignoran
//   los eventos que creó Turnia (ya son turnos), los marcados «Disponible» y los rechazados.
// - Escritura: cada turno es un evento en el calendario del profesional, con lo mínimo
//   del paciente. Un turno nunca espera a Google: el evento queda pendiente y se reintenta.

/** Lo leído de Google sirve para mostrar opciones durante este lapso. */
const BUSY_TTL_MS = 2 * 60_000;
/** Si Google no responde, lo último leído vale hasta este lapso. */
const BUSY_STALE_MS = 24 * 60 * 60_000;
const MAX_ATTEMPTS = 8;
/** Estados en los que el turno tiene que estar en el calendario (los cancelados se borran). */
const ON_CALENDAR = ["confirmado", "pendiente", "atendido", "ausente"];

type GoogleTime = { dateTime?: string; date?: string };
export type GoogleEvent = {
  id?: string;
  status?: string;
  transparency?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  extendedProperties?: { private?: Record<string, string> };
};

function instant(t: GoogleTime | undefined, timeZone: string): number | null {
  if (t?.dateTime) return new Date(t.dateTime).getTime();
  if (t?.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
    const [y, m, d] = t.date.split("-").map(Number);
    return zonedTimeToUtc(y, m, d, 0, 0, timeZone).getTime();
  }
  return null;
}

/** Eventos de Google → intervalos ocupados del profesional. Pura (se testea sin Google). */
export function busyFromEvents(events: GoogleEvent[], professionalId: string, timeZone: string): BusyInterval[] {
  const busy: BusyInterval[] = [];
  for (const e of events) {
    if (e.status === "cancelled" || e.transparency === "transparent") continue;
    if (e.extendedProperties?.private?.turnia_appointment_id) continue;
    if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
    const start = instant(e.start, timeZone);
    const end = instant(e.end, timeZone);
    if (start === null || end === null || end <= start) continue;
    busy.push({ professional_id: professionalId, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() });
  }
  return busy;
}

const EVENT_FIELDS = "items(id,status,transparency,start,end,attendees(self,responseStatus),extendedProperties),nextPageToken";

async function fetchEvents(conn: CalendarConnection, calendarId: string, from: Date, to: Date): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 4; page++) {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      maxResults: "2500",
      // Solo horarios y marcas: Turnia no lee títulos ni descripciones de la agenda del profesional.
      fields: EVENT_FIELDS,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await calendarFetch(conn, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    if (!res.ok) throw new GoogleError(`No se pudo leer el calendario (${res.status}).`, res.status);
    const data = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    events.push(...(data.items ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return events;
}

type ProCalendar = {
  id: string;
  google_calendar_id: string | null;
  google_busy: BusyInterval[] | null;
  google_busy_from: string | null;
  google_busy_to: string | null;
  google_busy_at: string | null;
};

const overlaps = (b: BusyInterval, from: Date, to: Date) => new Date(b.starts_at) < to && new Date(b.ends_at) > from;

/**
 * Lo ocupado en Google para estos profesionales entre `from` y `to`. Con `fresh`
 * (al reservar) se consulta a Google en el momento; si no, se usa lo leído hace
 * menos de 2 minutos. Si Google falla, nunca frena la agenda: usa lo último leído o nada.
 */
export async function googleBusy(
  clinicId: string,
  professionalIds: string[],
  from: Date,
  to: Date,
  opts: { fresh?: boolean; timeZone: string },
): Promise<BusyInterval[]> {
  if (!professionalIds.length) return [];
  const conn = await getConnection(clinicId);
  if (!conn || conn.status !== "conectado") return [];
  const pros = await sql<ProCalendar[]>`
    select id, google_calendar_id, google_busy, google_busy_from, google_busy_to, google_busy_at
    from professionals where id = any(${professionalIds}::uuid[]) and google_calendar_id is not null`;
  const now = Date.now();
  const results = await Promise.all(
    pros.map(async (p) => {
      const cached = p.google_busy && p.google_busy_at && p.google_busy_from && p.google_busy_to
        ? { busy: p.google_busy, at: new Date(p.google_busy_at).getTime(), from: new Date(p.google_busy_from), to: new Date(p.google_busy_to) }
        : null;
      const covers = cached && cached.from <= from && cached.to >= to;
      if (!opts.fresh && covers && now - cached.at < BUSY_TTL_MS) return cached.busy.filter((b) => overlaps(b, from, to));
      try {
        const events = await fetchEvents(conn, p.google_calendar_id!, from, to);
        const busy = busyFromEvents(events, p.id, opts.timeZone);
        if (!opts.fresh) {
          await sql`
            update professionals set google_busy = ${sql.json(busy)}, google_busy_from = ${from}, google_busy_to = ${to}, google_busy_at = now()
            where id = ${p.id}`;
        }
        return busy;
      } catch (e) {
        console.error("Calendario: no se pudo leer lo ocupado", p.id, e instanceof Error ? e.message : e);
        if (cached && now - cached.at < BUSY_STALE_MS) return cached.busy.filter((b) => overlaps(b, from, to));
        return [];
      }
    }),
  );
  await sql`update calendar_connections set last_sync_at = now() where id = ${conn.id}`;
  return results.flat();
}

// ── Escritura de turnos ──────────────────────────────────────────────────────

type SyncRow = {
  id: string;
  clinic_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  source: string;
  calendar_event_id: string | null;
  calendar_event_calendar: string | null;
  google_calendar_id: string | null;
  type_name: string;
  patient_name: string | null;
  patient_phone: string | null;
  clinic_address: string | null;
  timezone: string;
};

/** Id del evento derivado del turno: un reintento después de un corte no duplica el evento. */
export const eventIdFor = (appointmentId: string) => `turnia${appointmentId.replace(/-/g, "").toLowerCase()}`;

/** «Juan Pérez» → «Juan P.»: en el calendario va lo mínimo del paciente. */
export function shortName(full: string | null): string {
  const words = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "Paciente";
  return words.length === 1 ? words[0] : `${words[0]} ${words[words.length - 1][0].toUpperCase()}.`;
}

function eventBody(row: SyncRow) {
  const phone = row.patient_phone && /^\d{8,15}$/.test(row.patient_phone) ? `+${row.patient_phone}` : null;
  return {
    summary: `Turno: ${row.type_name} · ${shortName(row.patient_name)}`,
    description: [
      row.patient_name ? `Paciente: ${row.patient_name}` : null,
      phone ? `Teléfono: ${phone}` : null,
      "Reservado con Turnia. El detalle está en el panel:",
      `${env.appUrl().replace(/\/$/, "")}/panel/agenda`,
    ].filter(Boolean).join("\n"),
    location: row.clinic_address ?? undefined,
    start: { dateTime: new Date(row.starts_at).toISOString(), timeZone: row.timezone },
    end: { dateTime: new Date(row.ends_at).toISOString(), timeZone: row.timezone },
    status: "confirmed",
    extendedProperties: { private: { turnia_appointment_id: row.id, turnia_clinic_id: row.clinic_id } },
  };
}

async function removeEvent(conn: CalendarConnection, calendarId: string, eventId: string): Promise<void> {
  const res = await calendarFetch(conn, `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=none`, { method: "DELETE" });
  // Ya no estaba: da igual.
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new GoogleError(`No se pudo borrar el evento (${res.status}).`, res.status);
}

async function upsertEvent(conn: CalendarConnection, calendarId: string, row: SyncRow): Promise<string> {
  const eventId = eventIdFor(row.id);
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const body = JSON.stringify(eventBody(row));
  const patched = await calendarFetch(conn, `${base}/${eventId}?sendUpdates=none`, { method: "PATCH", body });
  if (patched.ok) return eventId;
  if (patched.status !== 404 && patched.status !== 410) throw new GoogleError(`No se pudo actualizar el evento (${patched.status}).`, patched.status);
  const created = await calendarFetch(conn, `${base}?sendUpdates=none`, { method: "POST", body: JSON.stringify({ id: eventId, ...eventBody(row) }) });
  if (!created.ok) throw new GoogleError(`No se pudo crear el evento (${created.status}).`, created.status);
  return eventId;
}

/** Deja el evento del turno como tiene que estar. Devuelve el estado final de la sincronización. */
async function syncOne(conn: CalendarConnection | null, id: string): Promise<"ok" | "error" | "omitido"> {
  return sql.begin(async (tx) => {
    // El lock evita que dos procesos escriban el mismo evento a la vez.
    const [row] = await tx<SyncRow[]>`
      select a.id, a.clinic_id, a.status, a.starts_at, a.ends_at, a.source, a.calendar_event_id, a.calendar_event_calendar,
             p.google_calendar_id, coalesce(a.title, t.name) as type_name, pa.full_name as patient_name, pa.phone as patient_phone,
             c.address as clinic_address, c.timezone
      from appointments a
        join professionals p on p.id = a.professional_id
        join appointment_types t on t.id = a.appointment_type_id
        join patients pa on pa.id = a.patient_id
        join clinics c on c.id = a.clinic_id
      where a.id = ${id} and a.calendar_sync in ('pendiente', 'error')
      for update of a skip locked`;
    if (!row) return "omitido";
    if (!conn) {
      await tx`update appointments set calendar_sync = null, calendar_error = null where id = ${id}`;
      return "omitido";
    }
    try {
      const target = ON_CALENDAR.includes(row.status) ? row.google_calendar_id : null;
      if (row.calendar_event_id && row.calendar_event_calendar && row.calendar_event_calendar !== target) {
        await removeEvent(conn, row.calendar_event_calendar, row.calendar_event_id);
      }
      const eventId = target ? await upsertEvent(conn, target, row) : null;
      await tx`
        update appointments set calendar_event_id = ${eventId}, calendar_event_calendar = ${target},
          calendar_sync = 'ok', calendar_error = null, calendar_drift = null, calendar_drift_at = null
        where id = ${id}`;
      return "ok";
    } catch (e) {
      const message = e instanceof Error ? e.message : "Error con Google.";
      await tx`
        update appointments set calendar_sync = 'error', calendar_error = ${message.slice(0, 300)}, calendar_attempts = calendar_attempts + 1
        where id = ${id}`;
      return "error";
    }
  });
}

/**
 * Sincroniza los turnos pendientes (de una clínica o de todas). Corre después de
 * cada herramienta del agente y de los cambios del panel, y por la automatización
 * /api/automations/calendario para los reintentos.
 */
export async function syncPendingCalendar(clinicId?: string): Promise<{ ok: number; error: number }> {
  const pending = await sql<{ id: string; clinic_id: string }[]>`
    select id, clinic_id from appointments
    where calendar_sync in ('pendiente', 'error') and calendar_attempts < ${MAX_ATTEMPTS}
      ${clinicId ? sql`and clinic_id = ${clinicId}` : sql``}
    order by starts_at limit 50`;
  const result = { ok: 0, error: 0 };
  const connections = new Map<string, CalendarConnection | null>();
  for (const p of pending) {
    if (!connections.has(p.clinic_id)) connections.set(p.clinic_id, await getConnection(p.clinic_id));
    const conn = connections.get(p.clinic_id) ?? null;
    // Con la conexión en error no se pierde nada: el turno queda pendiente hasta reconectar.
    if (conn?.status === "error") continue;
    const outcome = await syncOne(conn, p.id);
    if (outcome === "ok") result.ok++;
    if (outcome === "error") result.error++;
  }
  return result;
}

/**
 * Antes de borrar turnos (al borrar una ficha): saca sus eventos del calendario
 * del profesional. Devuelve cuántos eventos no se pudieron sacar.
 */
export async function removeCalendarEvents(clinicId: string, appointmentIds: string[]): Promise<number> {
  if (!appointmentIds.length) return 0;
  const rows = await sql<Array<{ calendar_event_id: string; calendar_event_calendar: string }>>`
    select calendar_event_id, calendar_event_calendar from appointments
    where clinic_id = ${clinicId} and id = any(${appointmentIds}::uuid[])
      and calendar_event_id is not null and calendar_event_calendar is not null`;
  if (!rows.length) return 0;
  const conn = await getConnection(clinicId);
  if (!conn || conn.status === "error") return rows.length;
  let failed = 0;
  for (const row of rows) {
    try {
      await removeEvent(conn, row.calendar_event_calendar, row.calendar_event_id);
    } catch (e) {
      failed++;
      console.error("Calendario: no se pudo sacar el evento de un turno borrado", e instanceof Error ? e.message : e);
    }
  }
  return failed;
}

/** Al cambiar el calendario de un profesional, sus turnos próximos se vuelven a escribir donde corresponde. */
export async function resyncProfessional(professionalId: string): Promise<void> {
  await sql`
    update appointments set calendar_sync = 'pendiente', calendar_attempts = 0, calendar_error = null
    where professional_id = ${professionalId} and ends_at > now() - interval '1 day'
      and (status = any(${ON_CALENDAR}::text[]) or calendar_event_id is not null)`;
}


/**
 * Escribe los eventos pendientes después de responder. Fuera de un pedido (pruebas,
 * scripts) no hay «después»: quedan para la automatización de reintentos.
 */
export function syncCalendarLater(clinicId: string): void {
  try {
    after(() => syncPendingCalendar(clinicId).catch((e) => console.error("Calendario: sincronización", e instanceof Error ? e.message : e)));
  } catch {
    // Sin contexto de pedido: lo toma /api/automations/calendario.
  }
}

// ── Cambios hechos en Google ─────────────────────────────────────────────────

type DriftRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string;
  calendar_event_id: string;
  calendar_event_calendar: string;
  calendar_drift: string | null;
  type_name: string;
  patient_name: string | null;
  professional: string;
  timezone: string;
};

/** Qué pasó con el evento de un turno: nada (null), «borrado» o «movido:<inicio ISO>/<fin ISO>». Pura. */
export function eventDrift(event: GoogleEvent | null, row: Pick<DriftRow, "starts_at" | "ends_at">, timeZone: string): string | null {
  if (!event || event.status === "cancelled") return "borrado";
  const start = instant(event.start, timeZone);
  const end = instant(event.end, timeZone);
  if (start === null || end === null) return null;
  const moved = Math.abs(start - Date.parse(row.starts_at)) > 60_000 || Math.abs(end - Date.parse(row.ends_at)) > 60_000;
  return moved ? `movido:${new Date(start).toISOString()}/${new Date(end).toISOString()}` : null;
}

/** El evento por su id, aunque esté fuera del rango leído (null si ya no existe). */
async function fetchEvent(conn: CalendarConnection, calendarId: string, eventId: string): Promise<GoogleEvent | null> {
  const res = await calendarFetch(conn, `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?fields=id,status,start,end`);
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new GoogleError(`No se pudo leer el evento (${res.status}).`, res.status);
  return (await res.json()) as GoogleEvent;
}

/**
 * Turnos próximos de Turnia que el profesional movió o borró en su Google Calendar. Se avisa una sola
 * vez al equipo con una tarea, y nada más: Turnia no le escribe al paciente por esto ni vuelve a
 * escribir el evento (no pisa lo que hizo el profesional). Si el evento vuelve a coincidir, se limpia.
 * Corre con /api/automations/calendario.
 */
export async function checkCalendarChanges(clinicId?: string): Promise<{ revisados: number; cambios: number }> {
  const clinics = await sql<Array<{ clinic_id: string }>>`
    select clinic_id from calendar_connections where status = 'conectado' ${clinicId ? sql`and clinic_id = ${clinicId}` : sql``}`;
  const result = { revisados: 0, cambios: 0 };
  for (const { clinic_id } of clinics) {
    const conn = await getConnection(clinic_id);
    if (!conn || conn.status !== "conectado") continue;
    const rows = await sql<DriftRow[]>`
      select a.id, a.clinic_id, a.patient_id, a.starts_at, a.ends_at, a.calendar_event_id, a.calendar_event_calendar, a.calendar_drift,
             coalesce(a.title, t.name) as type_name, pa.full_name as patient_name, pr.full_name as professional, c.timezone
      from appointments a
        join appointment_types t on t.id = a.appointment_type_id
        join patients pa on pa.id = a.patient_id
        join professionals pr on pr.id = a.professional_id
        join clinics c on c.id = a.clinic_id
      where a.clinic_id = ${clinic_id} and a.status in ('confirmado', 'pendiente') and a.calendar_sync = 'ok'
        and a.calendar_event_id is not null and a.calendar_event_calendar is not null
        and a.starts_at > now() and a.starts_at < now() + interval '14 days'
      order by a.starts_at
      limit 200`;
    const calendars = [...new Set(rows.map((r) => r.calendar_event_calendar))];
    for (const calendarId of calendars) {
      const mine = rows.filter((r) => r.calendar_event_calendar === calendarId);
      let events: GoogleEvent[];
      try {
        events = await fetchEvents(conn, calendarId, new Date(Date.now() - 86400_000), new Date(Date.now() + 15 * 86400_000));
      } catch (e) {
        console.error("Calendario: no se pudieron revisar los cambios", calendarId, e instanceof Error ? e.message : e);
        continue;
      }
      const byId = new Map(events.filter((e) => e.id).map((e) => [e.id!, e]));
      for (const row of mine) {
        result.revisados++;
        try {
          const event = byId.get(row.calendar_event_id) ?? (await fetchEvent(conn, calendarId, row.calendar_event_id));
          const drift = eventDrift(event, row, row.timezone);
          if (drift === row.calendar_drift) continue;
          // Si el turno cambió en Turnia mientras tanto, ya no se compara con esto; si otra corrida ya
          // anotó el cambio, no se repite la tarea.
          const [updated] = await sql<Array<{ id: string }>>`
            update appointments set calendar_drift = ${drift}, calendar_drift_at = ${drift ? sql`now()` : null}
            where id = ${row.id} and calendar_sync = 'ok' and starts_at = ${row.starts_at} and ends_at = ${row.ends_at}
              and calendar_drift is not distinct from ${row.calendar_drift}
            returning id`;
          if (!updated || !drift) continue;
          result.cambios++;
          const when = humanSlot(new Date(row.starts_at), row.timezone);
          const who = row.patient_name ?? "un paciente";
          const [newStart, newEnd] = drift.startsWith("movido:") ? drift.slice("movido:".length).split("/") : [];
          const fix = "En Turnia sigue como estaba: si el cambio va, hacelo también en la Agenda (así el recordatorio sale bien) y avisale al paciente.";
          const task = !newStart
            ? {
                title: `Google Calendar: se borró el turno de ${who}`,
                details: `${row.professional} borró de su Google Calendar el turno de ${row.type_name} del ${when}. En Turnia sigue reservado: si se canceló, cancelalo en la Agenda y avisale al paciente. Si el turno sigue en pie, no hace falta hacer nada.`,
              }
            : newStart === new Date(row.starts_at).toISOString()
              ? {
                  title: `Google Calendar: cambió la duración del turno de ${who}`,
                  details: `${row.professional} cambió en su Google Calendar la duración del turno de ${row.type_name} del ${when}: ahora termina a las ${humanSlot(new Date(newEnd), row.timezone).split(" a las ").pop()}. ${fix}`,
                }
              : {
                  title: `Google Calendar: se movió el turno de ${who}`,
                  details: `${row.professional} movió en su Google Calendar el turno de ${row.type_name} del ${when} al ${humanSlot(new Date(newStart), row.timezone)}. ${fix}`,
                };
          await sql`
            insert into tasks (clinic_id, patient_id, type, priority, title, details)
            values (${row.clinic_id}, ${row.patient_id}, 'administrativo', 'alta', ${task.title}, ${task.details})`;
        } catch (e) {
          console.error("Calendario: no se pudo revisar un turno", row.id, e instanceof Error ? e.message : e);
        }
      }
    }
  }
  return result;
}
