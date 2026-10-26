import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "../db";
import { env } from "../env";
import { decryptSecret, encryptSecret } from "./crypto";

// Google Calendar por la API REST (sin SDK): conexión OAuth de la cuenta de la
// clínica, renovación del token, lista de calendarios y eventos. El OAuth (estado
// firmado, canje del código, renovación y revocación) también lo usa Google Sheets.

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** Un pedido a Google nunca frena una reserva más que esto. */
const TIMEOUT_MS = 3000;

export class GoogleError extends Error {
  constructor(message: string, readonly status: number, readonly reconnect = false) {
    super(message);
  }
}

export type CalendarConnection = {
  id: string;
  clinic_id: string;
  account_email: string | null;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  status: "conectado" | "error";
  last_error: string | null;
  last_sync_at: string | null;
  connected_at: string;
};

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export const redirectUri = () => `${env.appUrl().replace(/\/$/, "")}/api/google/callback`;

/** Cookie que ata el estado del OAuth al navegador que pidió conectar. */
export const OAUTH_COOKIE = "turnia_google_oauth";

// ── Estado del OAuth: firmado y atado a una cookie del navegador que lo pidió ──
const STATE_TTL_SECS = 10 * 60;
const signState = (payload: string) => createHmac("sha256", `google-oauth:${env.sessionSecret()}`).update(payload).digest("base64url");

/** `subject`: para quién es la conexión (el id de la clínica, o la planilla de Turnia). Sin puntos. */
export function createOAuthState(subject: string, now = Date.now()): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${subject}.${nonce}.${Math.floor(now / 1000) + STATE_TTL_SECS}`;
  return { state: `${payload}.${signState(payload)}`, nonce };
}

export function readOAuthState(state: string, nonce: string | undefined, now = Date.now()): string | null {
  const parts = state.split(".");
  if (parts.length !== 4 || !nonce) return null;
  const [subject, stateNonce, expires, signature] = parts;
  const expected = Buffer.from(signState(`${subject}.${stateNonce}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (stateNonce !== nonce || !/^\d+$/.test(expires) || Number(expires) * 1000 < now) return null;
  return subject;
}

export function authorizationUrl(state: string, scopes: readonly string[] = GOOGLE_SCOPES): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    // Siempre pide el consentimiento: es la única forma de recibir un refresh token nuevo.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export type GoogleTokens = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await call(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // invalid_grant: el usuario revocó el acceso o venció (en modo prueba, a los 7 días).
    const reconnect = data.error === "invalid_grant";
    throw new GoogleError(reconnect ? "Google pidió volver a conectar la cuenta." : `Google rechazó el pedido (${String(data.error ?? res.status)}).`, res.status, reconnect);
  }
  return data as GoogleTokens;
}

/** Canje del código de la vuelta del OAuth (de cualquier conexión con Google). */
export const exchangeCode = (code: string) => tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });

/** Un token de acceso nuevo, con el permiso permanente guardado (cifrado). */
export const refreshAccessToken = (sealedRefreshToken: string) =>
  tokenRequest({ refresh_token: decryptSecret(sealedRefreshToken), grant_type: "refresh_token" });

/** El email de la cuenta que dio el permiso (null si Google no lo dice). */
export async function accountEmail(accessToken: string): Promise<string | null> {
  const me = await call(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  return me.ok ? (((await me.json()) as { email?: string }).email ?? null) : null;
}

/** Revoca el permiso en Google. Si Google no responde, se puede quitar desde la cuenta de Google. */
export async function revokeGrant(sealedRefreshToken: string): Promise<void> {
  try {
    await call(`${REVOKE_URL}?token=${encodeURIComponent(decryptSecret(sealedRefreshToken))}`, { method: "POST" });
  } catch {
    // Igual se borra de Turnia.
  }
}

/** Canje del código de la vuelta del OAuth: guarda la conexión de la clínica (cifrada). */
export async function connectWithCode(clinicId: string, code: string): Promise<CalendarConnection> {
  const tokens = await exchangeCode(code);
  if (!tokens.refresh_token) throw new GoogleError("Google no entregó un permiso permanente. Volvé a intentar.", 400);
  const granted = (tokens.scope ?? "").split(" ");
  if (!granted.includes("https://www.googleapis.com/auth/calendar.events")) {
    throw new GoogleError("Hay que aceptar el permiso para ver y editar eventos del calendario.", 400);
  }
  const email = await accountEmail(tokens.access_token);
  const [row] = await sql<CalendarConnection[]>`
    insert into calendar_connections (clinic_id, account_email, refresh_token, access_token, access_expires_at, status, last_error)
    values (${clinicId}, ${email}, ${encryptSecret(tokens.refresh_token)}, ${encryptSecret(tokens.access_token)},
            now() + make_interval(secs => ${tokens.expires_in}), 'conectado', null)
    on conflict (clinic_id) do update set account_email = excluded.account_email, refresh_token = excluded.refresh_token,
      access_token = excluded.access_token, access_expires_at = excluded.access_expires_at, status = 'conectado',
      last_error = null, connected_at = now(), updated_at = now()
    returning *`;
  return row;
}

export async function getConnection(clinicId: string): Promise<CalendarConnection | null> {
  const [row] = await sql<CalendarConnection[]>`select * from calendar_connections where clinic_id = ${clinicId}`;
  return row ?? null;
}

export async function markConnectionError(clinicId: string, message: string): Promise<void> {
  await sql`update calendar_connections set status = 'error', last_error = ${message.slice(0, 300)}, updated_at = now() where clinic_id = ${clinicId}`;
}

/** Token de acceso vigente; lo renueva si vence en menos de un minuto. */
export async function accessToken(conn: CalendarConnection): Promise<string> {
  if (conn.access_token && conn.access_expires_at && new Date(conn.access_expires_at).getTime() > Date.now() + 60_000) {
    return decryptSecret(conn.access_token);
  }
  try {
    const tokens = await refreshAccessToken(conn.refresh_token);
    await sql`
      update calendar_connections set access_token = ${encryptSecret(tokens.access_token)},
        access_expires_at = now() + make_interval(secs => ${tokens.expires_in}),
        status = 'conectado', last_error = null, updated_at = now()
      where id = ${conn.id}`;
    return tokens.access_token;
  } catch (e) {
    if (e instanceof GoogleError && e.reconnect) await markConnectionError(conn.clinic_id, e.message);
    throw e;
  }
}

/** Pedido autenticado a la API de Calendar. */
export async function calendarFetch(conn: CalendarConnection, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(conn);
  const res = await call(`${CALENDAR_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 401) {
    await markConnectionError(conn.clinic_id, "Google rechazó el acceso: volvé a conectar la cuenta.");
    throw new GoogleError("Google rechazó el acceso.", 401, true);
  }
  return res;
}

export type GoogleCalendar = { id: string; name: string; primary: boolean; canWrite: boolean };

/** Calendarios de la cuenta conectada en los que se puede escribir (los únicos que sirven para un profesional). */
export async function listCalendars(conn: CalendarConnection): Promise<GoogleCalendar[]> {
  const res = await calendarFetch(conn, "/users/me/calendarList?minAccessRole=writer&maxResults=250");
  if (!res.ok) throw new GoogleError(`No se pudo leer la lista de calendarios (${res.status}).`, res.status);
  const data = (await res.json()) as { items?: Array<{ id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }> };
  return (data.items ?? [])
    .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary), canWrite: c.accessRole === "owner" || c.accessRole === "writer" }))
    .filter((c) => c.canWrite)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name, "es"));
}

/** Corta la conexión: revoca el permiso en Google (si responde) y la borra de Turnia. */
export async function disconnect(clinicId: string): Promise<void> {
  const conn = await getConnection(clinicId);
  if (!conn) return;
  // Google revoca todo junto: si la misma cuenta tiene conectada otra clínica o la planilla de Turnia, no se revoca.
  const [shared] = await sql`
    select 1 from calendar_connections where account_email = ${conn.account_email} and clinic_id <> ${clinicId}
    union all select 1 from sheets_connections where account_email = ${conn.account_email} limit 1`;
  if (!shared) await revokeGrant(conn.refresh_token);
  await sql.begin(async (tx) => {
    await tx`delete from calendar_connections where clinic_id = ${clinicId}`;
    await tx`update professionals set google_busy = null, google_busy_at = null where clinic_id = ${clinicId}`;
    await tx`update appointments set calendar_sync = null, calendar_error = null where clinic_id = ${clinicId} and calendar_sync in ('pendiente', 'error')`;
  });
}
