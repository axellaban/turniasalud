import "server-only";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/calendar/crypto";
import { GoogleError, accountEmail, exchangeCode, refreshAccessToken, revokeGrant } from "@/lib/calendar/google";
import { LEAD_COLUMNS, leadsForSheet } from "@/lib/leads-sheet";
import type { Outreach } from "@/lib/sales/outreach";
import { CHANNEL_LABEL, PHONE_KIND_LABEL, STATUS_LABEL, demoUrl, displayOutreachPhone } from "@/lib/sales/outreach-messages";
import { DEFAULT_TZ, zonedParts } from "@/lib/time";
import { SheetsApiError, createSpreadsheet, spreadsheetInfo, writeTabs, type Cell, type Tab } from "./google-sheets";

// La planilla de Turnia en el Google Drive de Axel: la prospección y los pedidos de demo, siempre
// al día. Es un espejo: cada copia reescribe las dos pestañas completas, de a una copia por vez.
// La conexión (sheets_connections) es por dueño: hoy Turnia; mañana, cada clínica con la suya.

export const SHEETS_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"] as const;
/** Va en el estado del OAuth para que la vuelta de Google sepa que es la planilla y no Calendar. */
export const TURNIA_SHEET_SUBJECT = "planilla-turnia";
const OWNER = "turnia";
const TITLE = "Turnia · Prospección y pedidos de demo";
const TAB_OUTREACH = "Prospección";
const TAB_LEADS = "Pedidos de demo";

export type SheetsStatus = "conectado" | "reconectar" | "sin_planilla";

export type SheetsConnection = {
  id: string;
  owner: string;
  account_email: string | null;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  status: SheetsStatus;
  last_error: string | null;
  sync_requested_at: string | null;
  sync_started_at: string | null;
  last_sync_at: string | null;
  connected_at: string;
};

export async function turniaSheet(): Promise<SheetsConnection | null> {
  const [row] = await sql<SheetsConnection[]>`select * from sheets_connections where owner = ${OWNER}`;
  return row ?? null;
}

const message = (e: unknown) => (e instanceof GoogleError ? e.message : "No se pudo copiar a la planilla. Se reintenta con el próximo cambio.");

/** Qué le pasa a la conexión según el error: volver a conectar, crear otra planilla o nada (un error pasajero). */
function statusFor(e: unknown): SheetsStatus {
  if (e instanceof SheetsApiError && e.missing) return "sin_planilla";
  return e instanceof GoogleError && e.reconnect ? "reconectar" : "conectado";
}

/** Token de acceso vigente; lo renueva si vence en menos de un minuto. */
async function accessToken(conn: SheetsConnection): Promise<string> {
  if (conn.access_token && conn.access_expires_at && new Date(conn.access_expires_at).getTime() > Date.now() + 60_000) {
    return decryptSecret(conn.access_token);
  }
  const tokens = await refreshAccessToken(conn.refresh_token);
  await sql`
    update sheets_connections set access_token = ${encryptSecret(tokens.access_token)},
      access_expires_at = now() + make_interval(secs => ${tokens.expires_in}), updated_at = now()
    where id = ${conn.id}`;
  return tokens.access_token;
}

/**
 * Vuelta del OAuth: guarda el permiso (cifrado), deja lista la planilla y hace la primera copia.
 * Si es la misma cuenta, sigue usando su planilla; con otra cuenta se crea una nueva.
 */
export async function connectTurniaSheet(code: string): Promise<void> {
  const tokens = await exchangeCode(code);
  if (!tokens.refresh_token) throw new GoogleError("Google no entregó un permiso permanente. Volvé a intentar.", 400);
  if (!(tokens.scope ?? "").split(" ").includes(SHEETS_SCOPES[2])) {
    throw new GoogleError("Hay que aceptar el permiso para crear y editar la planilla de Turnia.", 400);
  }
  const email = await accountEmail(tokens.access_token);
  const previous = await turniaSheet();
  const keep = Boolean(previous?.spreadsheet_id && previous.account_email === email);
  await sql`
    insert into sheets_connections (owner, account_email, refresh_token, access_token, access_expires_at, status)
    values (${OWNER}, ${email}, ${encryptSecret(tokens.refresh_token)}, ${encryptSecret(tokens.access_token)},
            now() + make_interval(secs => ${tokens.expires_in}), 'conectado')
    on conflict (owner) do update set account_email = excluded.account_email, refresh_token = excluded.refresh_token,
      access_token = excluded.access_token, access_expires_at = excluded.access_expires_at, status = 'conectado', last_error = null,
      spreadsheet_id = ${keep ? sql`sheets_connections.spreadsheet_id` : null},
      spreadsheet_url = ${keep ? sql`sheets_connections.spreadsheet_url` : null},
      last_sync_at = null, sync_started_at = null, connected_at = now(), updated_at = now()`;
  try {
    await ensureSpreadsheet();
  } catch (e) {
    // La cuenta queda conectada: el panel muestra el error y «Crear la planilla» para reintentar.
    await sql`update sheets_connections set status = ${statusFor(e)}, last_error = ${message(e)}, updated_at = now() where owner = ${OWNER}`;
    throw e;
  }
  await syncTurniaSheet();
}

/** Deja una planilla lista: la que había, si sigue existiendo, o una nueva en su Drive. */
async function ensureSpreadsheet(): Promise<void> {
  const conn = await turniaSheet();
  if (!conn) throw new GoogleError("No hay una cuenta de Google conectada.", 400);
  const token = await accessToken(conn);
  if (conn.spreadsheet_id) {
    try {
      const info = await spreadsheetInfo(token, conn.spreadsheet_id);
      await sql`update sheets_connections set spreadsheet_url = ${info.url || conn.spreadsheet_url}, status = 'conectado' where id = ${conn.id}`;
      return;
    } catch (e) {
      if (!(e instanceof SheetsApiError && e.missing)) throw e;
    }
  }
  const { id, url } = await createSpreadsheet(token, TITLE, [
    { title: TAB_OUTREACH, header: OUTREACH_COLUMNS },
    { title: TAB_LEADS, header: LEAD_COLUMNS },
  ]);
  await sql`
    update sheets_connections set spreadsheet_id = ${id}, spreadsheet_url = ${url}, status = 'conectado', last_error = null,
      last_sync_at = null, updated_at = now()
    where id = ${conn.id}`;
}

/** La planilla se borró: crea otra en el mismo Drive y copia todo. */
export async function recreateTurniaSheet(): Promise<{ ok: boolean; error?: string }> {
  try {
    await sql`update sheets_connections set spreadsheet_id = null, spreadsheet_url = null where owner = ${OWNER}`;
    await ensureSpreadsheet();
  } catch (e) {
    const error = message(e);
    await sql`update sheets_connections set status = ${statusFor(e)}, last_error = ${error}, updated_at = now() where owner = ${OWNER}`;
    return { ok: false, error };
  }
  return syncTurniaSheet();
}

/**
 * Corta la conexión. La planilla queda en su Drive. El permiso se revoca en Google salvo que la
 * misma cuenta tenga conectado Calendar: Google revoca todo junto y cortaría también la agenda.
 */
export async function disconnectTurniaSheet(): Promise<void> {
  const conn = await turniaSheet();
  if (!conn) return;
  const [calendar] = await sql`select 1 from calendar_connections where account_email = ${conn.account_email} limit 1`;
  if (!calendar) await revokeGrant(conn.refresh_token);
  await sql`delete from sheets_connections where id = ${conn.id}`;
}

/**
 * Copia todo a la planilla. Una copia por vez: si hay otra en curso, deja el pedido anotado y esa
 * vuelve a copiar al terminar (así nunca gana una copia vieja). Nunca tira: el error queda en el panel.
 */
export async function syncTurniaSheet(): Promise<{ ok: boolean; error?: string }> {
  try {
    const current = await turniaSheet();
    // Sin planilla, o esperando que se reconecte o se cree otra: no se intenta (el panel ya lo muestra).
    if (!current?.spreadsheet_id || current.status !== "conectado") return { ok: false, error: current?.last_error ?? "No hay una planilla conectada." };
    await sql`update sheets_connections set sync_requested_at = clock_timestamp() where id = ${current.id}`;
    // Hasta tres vueltas: alcanza para los cambios que llegan mientras se copia.
    for (let round = 0; round < 3; round++) {
      // El turno: nadie copiando (o una copia colgada hace más de 2 minutos) y algo nuevo para copiar.
      const [conn] = await sql<SheetsConnection[]>`
        update sheets_connections set sync_started_at = clock_timestamp()
        where owner = ${OWNER} and spreadsheet_id is not null and status = 'conectado'
          and (sync_started_at is null or sync_started_at < clock_timestamp() - interval '2 minutes')
          and (last_sync_at is null or sync_requested_at > last_sync_at)
        returning *`;
      if (!conn) break;
      try {
        await writeTabs(await accessToken(conn), conn.spreadsheet_id!, await tabs());
        // Quedó copiado lo que había al empezar esta vuelta (con la precisión de la base, no la de JavaScript).
        await sql`
          update sheets_connections set last_sync_at = sync_started_at, sync_started_at = null, status = 'conectado',
            last_error = null, updated_at = now()
          where id = ${conn.id}`;
      } catch (e) {
        const error = message(e);
        await sql`
          update sheets_connections set sync_started_at = null, status = ${statusFor(e)}, last_error = ${error}, updated_at = now()
          where id = ${conn.id}`;
        return { ok: false, error };
      }
    }
    return { ok: true };
  } catch (e) {
    console.error("Planilla de Turnia:", e);
    return { ok: false, error: message(e) };
  }
}

/** Después de responder, copia a la planilla (si hay una conectada). Para server actions y rutas. */
export function queueTurniaSheetSync(): void {
  after(() => syncTurniaSheet());
}

// ── Las pestañas ──

/** «2026-10-26 14:30», hora de Argentina: se lee bien y se ordena bien. */
function stamp(iso: string | null): string {
  if (!iso) return "";
  const p = zonedParts(new Date(iso), DEFAULT_TZ);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
}

const OUTREACH_COLUMNS = [
  "Código", "Nombre", "Trato", "Saludo", "Consultorio", "Zona", "Dirección", "Especialidad", "Teléfono", "De quién es el teléfono",
  "Instagram", "Email", "Web", "Prioridad", "Estado", "Mensajes", "Saludo enviado", "Primer contacto", "Último contacto", "Último canal", "Próximo paso",
  "Abrió su demo", "Veces que la abrió", "Probó la demo", "Link de su demo", "Señales", "Fuente", "Notas", "Actualizado",
];

type OutreachRow = Omit<Outreach, "shared" | "suppressed"> & { updated_at: string };

async function tabs(): Promise<Tab[]> {
  const [outreach, leads] = await Promise.all([
    sql<OutreachRow[]>`select * from sales_outreach order by created_at, id`,
    leadsForSheet("all"),
  ]);
  const outreachRows: Cell[][] = outreach.map((p) => [
    p.code, p.name, p.title, p.greeting, p.business_name, p.zone, p.address, p.specialty,
    p.phone ? displayOutreachPhone(p.phone) : "", p.phone_kind ? PHONE_KIND_LABEL[p.phone_kind] : "",
    p.instagram ? `@${p.instagram}` : "", p.email ?? "", p.website ?? "", p.priority, STATUS_LABEL[p.status] ?? p.status, p.touches,
    stamp(p.greeted_at), stamp(p.first_contact_at), stamp(p.last_contact_at), p.last_channel ? (CHANNEL_LABEL[p.last_channel] ?? p.last_channel) : "", p.next_action_on ?? "",
    stamp(p.opened_at), p.opens, stamp(p.demo_at), demoUrl(env.appUrl(), p.code), p.signals, p.source, p.notes, stamp(p.updated_at),
  ]);
  const leadRows: Cell[][] = leads.map((l) => [
    l.id, stamp(l.fecha), l.nombre, l.email, l.whatsapp, l.consultorio, l.rol, l.especialidad, l.profesionales, l.mensaje, l.origen, l.estado,
    l.notas, stamp(l.actualizado),
  ]);
  return [
    { title: TAB_OUTREACH, rows: [OUTREACH_COLUMNS, ...outreachRows] },
    { title: TAB_LEADS, rows: [LEAD_COLUMNS, ...leadRows] },
  ];
}
