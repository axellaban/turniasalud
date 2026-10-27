import "server-only";
import { after } from "next/server";
import { sql } from "../db";
import { env } from "../env";
import type { BusyInterval } from "../slots";
import { zonedTimeToUtc } from "../time";
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
  patient_phone: string;
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
  const phone = /^\d{8,15}$/.test(row.patient_phone) ? `+${row.patient_phone}` : null;
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
             p.google_calendar_id, t.name as type_name, pa.full_name as patient_name, pa.phone as patient_phone,
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
          calendar_sync = 'ok', calendar_error = null
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
