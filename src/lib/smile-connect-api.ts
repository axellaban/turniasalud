import "server-only";

// Cliente de la API pública de Smile Connect (https://app.smileconnect.pro/api/v1, OpenAPI en /openapi).
// Clave por clínica (`sc_live_<uuid>.<secreto>`), con permisos explícitos por operación. Límites:
// 90 pedidos por minuto, 20 escrituras por minuto y 10.000 registros sensibles (pacientes y turnos)
// por día y clínica, contando el tamaño de página pedido aunque vuelva vacía. Este módulo no toca la
// base: solo habla con Smile Connect. Lo usa src/lib/smile-connect-link.ts.

export const SMILE_API_BASE = "https://app.smileconnect.pro/api/v1";
const apiBase = () => (process.env.SMILE_CONNECT_API_URL || SMILE_API_BASE).replace(/\/$/, "");

/** Lo que pide Turnia a la clave. Las de escritura solo hacen falta para escribir. */
export const READ_SCOPES = ["clinic:read", "professionals:read", "boxes:read", "availability:read", "appointments:read", "patients:read"] as const;
export const WRITE_SCOPES = ["patients:create", "appointments:create", "appointments:reschedule", "appointments:cancel"] as const;

export class SmileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
  /** ¿Vale la pena reintentar más tarde? (límite, caída o corte de red). */
  get transient(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** Qué decirle al consultorio según el error. */
export function smileErrorText(e: unknown): string {
  if (!(e instanceof SmileApiError)) return e instanceof Error ? e.message : String(e);
  if (e.status === 401) return "Smile Connect rechazó la clave: venció o la revocaron. Generá una nueva en Smile Connect y cargala acá.";
  if (e.status === 403) return "La clave de Smile Connect no tiene permiso para esto. Revisá los permisos de la clave en Smile Connect.";
  if (e.status === 404) return "Smile Connect no encontró ese registro.";
  if (e.status === 409) return "Smile Connect rechazó el cambio por un conflicto (por ejemplo, el turno cambió recién).";
  if (e.status === 429) return "Smile Connect pidió esperar: se superó el límite de pedidos.";
  if (e.status === 0) return "No se pudo conectar con Smile Connect.";
  return `Smile Connect respondió ${e.status}${e.code ? ` (${e.code})` : ""}.`;
}

export type SmileRequest = {
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /** Registros sensibles que reserva este pedido (tamaño de página o 1). */
  reserve?: number;
};

export type SmileClient = {
  request<T>(path: string, req?: SmileRequest): Promise<T>;
};

/**
 * Cliente con la clave de una clínica. `onReserve` se llama antes de cada lectura de pacientes o
 * turnos con lo que reserva del cupo diario: si tira un error, el pedido no sale.
 */
export function smileClient(apiKey: string, opts: { onReserve?: (n: number) => Promise<void> | void; timeoutMs?: number } = {}): SmileClient {
  return {
    async request<T>(path: string, req: SmileRequest = {}): Promise<T> {
      if (req.reserve && opts.onReserve) await opts.onReserve(req.reserve);
      const url = new URL(`${apiBase()}${path}`);
      for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
      const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
      if (req.body !== undefined) headers["Content-Type"] = "application/json";
      if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;
      let res: Response;
      try {
        res = await fetch(url, {
          method: req.method ?? "GET",
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          cache: "no-store",
          signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        });
      } catch (e) {
        throw new SmileApiError(`Sin conexión con Smile Connect: ${e instanceof Error ? e.message : e}`, 0);
      }
      const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (!res.ok) {
        const retry = Number(res.headers.get("retry-after"));
        throw new SmileApiError(
          data?.error?.message ?? `Smile Connect respondió ${res.status}`,
          res.status,
          data?.error?.code ?? null,
          Number.isFinite(retry) && retry > 0 ? retry : null,
        );
      }
      return data as T;
    },
  };
}

// ── Tipos de la API (solo lo que usa Turnia) ─────────────────────────────────

export type ScClinic = { clinic_id: number; clinic_name: string | null; timezone: string };
export type ScProfessional = { professional_id: number; name: string; surname: string; box_id: number | null };
export type ScBox = { box_id: number; name: string };
export type ScSlot = { start: string; end: string; professionalId: number; professionalName?: string; professionalSurname?: string };
export type ScPatient = {
  patient_id: number;
  name: string;
  surname: string;
  id_number: string | null;
  email: string | null;
  phone_country_code: string | null;
  phone_number: string | null;
};
export type ScAppointment = {
  appointment_id: number;
  patient_id: number;
  start_date: string;
  end_date: string;
  box_id: number | null;
  professional_ids: number[];
  attendance: string | null;
  cancelled: boolean;
};
type Page<T> = { data: T[]; next_cursor: number | null };

/** Todas las páginas de un listado (after = next_cursor). `max` corta antes, por las dudas. */
async function all<T>(client: SmileClient, path: string, query: Record<string, string | number | undefined>, opts: { limit: number; sensitive: boolean; max?: number }): Promise<T[]> {
  const out: T[] = [];
  let after = 0;
  for (let page = 0; page < (opts.max ?? 50); page++) {
    const r = await client.request<Page<T>>(path, { query: { ...query, limit: opts.limit, after }, reserve: opts.sensitive ? opts.limit : undefined });
    out.push(...r.data);
    if (!r.next_cursor || !r.data.length) return out;
    after = r.next_cursor;
  }
  // Un listado a medias haría creer que lo que falta se borró en Smile Connect: mejor no usar nada.
  throw new SmileApiError(`El listado ${path} tiene más páginas de las esperadas: no se usó.`, 413);
}

export const scClinic = async (c: SmileClient) => (await c.request<{ data: ScClinic }>("/clinic")).data;
export const scProfessionals = (c: SmileClient) => all<ScProfessional>(c, "/professionals", {}, { limit: 100, sensitive: false });
export const scBoxes = (c: SmileClient) => all<ScBox>(c, "/boxes", {}, { limit: 100, sensitive: false });

/** Lo libre de un día (fecha local), en celdas de `duration` minutos. Sin profesional: todos. */
export async function scAvailability(c: SmileClient, date: string, duration = 5, professionalId?: number): Promise<ScSlot[]> {
  const r = await c.request<{ data: { slots: ScSlot[] } }>("/availability", { query: { date, duration_minutes: duration, professional_id: professionalId } });
  return r.data.slots ?? [];
}

/** Turnos que empiezan en [start, end) (máximo 31 días), también los cancelados. */
export function scAppointments(c: SmileClient, start: Date, end: Date, limit = 100): Promise<ScAppointment[]> {
  return all<ScAppointment>(c, "/appointments", { start: start.toISOString(), end: end.toISOString() }, { limit, sensitive: true });
}

export const scAppointment = async (c: SmileClient, id: number) =>
  (await c.request<{ data: ScAppointment }>(`/appointments/${id}`, { reserve: 1 })).data;
export const scPatient = async (c: SmileClient, id: number) =>
  (await c.request<{ data: ScPatient }>(`/patients/${id}`, { reserve: 1 })).data;
export const scSearchPatients = async (c: SmileClient, search: string, limit = 5) =>
  (await c.request<Page<ScPatient>>("/patients", { query: { search, limit, after: 0 }, reserve: limit })).data;
export const scAllPatients = (c: SmileClient) => all<ScPatient>(c, "/patients", {}, { limit: 100, sensitive: true, max: 200 });

export type ScNewPatient = {
  name: string;
  surname: string;
  id_number?: string;
  email?: string;
  phone_country_code?: string;
  phone_number?: string;
  professional_ids?: number[];
};
export type ScAppointmentTimes = { professional_id: number; box_id: number; start_date: string; end_date: string; notes?: string };

export async function scCreatePatient(c: SmileClient, body: ScNewPatient, idempotencyKey: string) {
  return (await c.request<{ data: { patient_id: number }; replayed?: boolean }>("/patients", { method: "POST", body, idempotencyKey })).data;
}
export async function scCreateAppointment(c: SmileClient, body: ScAppointmentTimes & { patient_id: number }, idempotencyKey: string) {
  return (await c.request<{ data: { appointment_id: number }; replayed?: boolean }>("/appointments", { method: "POST", body, idempotencyKey })).data;
}
export async function scRescheduleAppointment(c: SmileClient, id: number, body: ScAppointmentTimes) {
  return (await c.request<{ data: { appointment_id: number } }>(`/appointments/${id}`, { method: "PATCH", body })).data;
}
export async function scCancelAppointment(c: SmileClient, id: number) {
  return (await c.request<{ data: { appointment_id: number } }>(`/appointments/${id}/cancel`, { method: "POST" })).data;
}

/**
 * ¿La API ya acepta notas al crear y mover un turno? Hoy no (el esquema no las permite y rechaza
 * campos de más). Cuando Smile Connect las sume, Turnia empieza a mandar el motivo sin otro cambio.
 */
export async function scSupportsNotes(c: SmileClient): Promise<boolean> {
  const spec = await c.request<{ paths?: Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> } }>> }>("/openapi");
  const props = (path: string, method: string) => spec.paths?.[path]?.[method]?.requestBody?.content?.["application/json"]?.schema?.properties ?? {};
  return "notes" in props("/appointments", "post") && "notes" in props("/appointments/{id}", "patch");
}

// ── Conversiones ─────────────────────────────────────────────────────────────

/** «María José García» → nombre «María José», apellido «García». Smile Connect pide los dos. */
export function splitName(full: string | null | undefined): { name: string; surname: string } {
  const words = (full ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return { name: "Paciente", surname: "Sin apellido" };
  if (words.length === 1) return { name: words[0].slice(0, 100), surname: "Sin apellido" };
  return { name: words.slice(0, -1).join(" ").slice(0, 100), surname: words[words.length - 1].slice(0, 100) };
}

/**
 * Teléfono de Turnia (549…, como WhatsApp) al formato de Smile Connect: código de país y número
 * nacional sin el 9 de celular (Argentina: 10 dígitos, característica + número).
 */
export function smilePhone(phone: string | null | undefined): { phone_country_code: string; phone_number: string } | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (/^549\d{10}$/.test(digits)) return { phone_country_code: "54", phone_number: digits.slice(3) };
  if (/^54\d{10}$/.test(digits)) return { phone_country_code: "54", phone_number: digits.slice(2) };
  // Otro país: sin una tabla de códigos no se separa con certeza. La ficha se crea sin teléfono.
  return null;
}

/** El mail, solo si Smile Connect lo acepta (su patrón es más estricto): uno inválido haría fallar el alta. */
const SMILE_EMAIL = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
export function smileEmail(email: string | null | undefined): string | undefined {
  const clean = (email ?? "").trim();
  return clean.length <= 254 && SMILE_EMAIL.test(clean) ? clean : undefined;
}

/** El documento, hasta 50 caracteres (el límite de Smile Connect). */
export function smileIdNumber(dni: string | null | undefined): string | undefined {
  const clean = (dni ?? "").trim();
  return clean && clean.length <= 50 ? clean : undefined;
}

/** Celdas libres (de cualquier largo) → tramos libres por profesional, unidos y ordenados. */
export function freeRanges(slots: ScSlot[]): Map<number, Array<[number, number]>> {
  const byPro = new Map<number, Array<[number, number]>>();
  for (const s of slots) {
    const a = Date.parse(s.start);
    const b = Date.parse(s.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const list = byPro.get(s.professionalId) ?? [];
    list.push([a, b]);
    byPro.set(s.professionalId, list);
  }
  for (const [pro, list] of byPro) {
    list.sort((x, y) => x[0] - y[0]);
    const merged: Array<[number, number]> = [];
    for (const [a, b] of list) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    byPro.set(pro, merged);
  }
  return byPro;
}

/** Lo ocupado de [from, to): todo lo que no está libre. */
export function busyFromFree(free: Array<[number, number]>, from: number, to: number): Array<[number, number]> {
  const busy: Array<[number, number]> = [];
  let cursor = from;
  for (const [a, b] of free) {
    if (b <= cursor || a >= to) continue;
    if (a > cursor) busy.push([cursor, Math.min(a, to)]);
    cursor = Math.max(cursor, b);
    if (cursor >= to) break;
  }
  if (cursor < to) busy.push([cursor, to]);
  return busy;
}

/** ¿[start, end) entra entero en lo libre? */
export function fitsFree(free: Array<[number, number]>, start: number, end: number): boolean {
  return busyFromFree(free, start, end).length === 0;
}
