import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "@/lib/db";
import { LEAD_STATUSES } from "@/lib/leads";

// Pedidos de demo → Google Sheets. El usuario implementa en su planilla una aplicación web de Apps
// Script (el código sale de appsScriptCode, con la clave ya puesta) y pega su URL en el panel. Cada
// pedido nuevo, cada cambio de estado y cada borrado se copian solos, sin frenar el formulario.

export class SheetError extends Error {}

export type SheetSettings = { url: string | null; name: string | null; synced_at: string | null; error: string | null };

export const SHEET_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;

/** La clave que comparten la planilla y Turnia: sale del secreto de la sesión, no se guarda en ningún lado. */
export function sheetKey(): string {
  const secret = process.env.SESSION_SECRET || process.env.AGENT_TOOLS_SECRET;
  if (!secret) throw new SheetError("Falta SESSION_SECRET para firmar los envíos a la planilla.");
  return createHmac("sha256", secret).update("turnia-planilla-pedidos").digest("base64url").slice(0, 32);
}

export async function sheetSettings(): Promise<SheetSettings> {
  const [row] = await sql<SheetSettings[]>`
    select leads_sheet_url as url, leads_sheet_name as name, leads_sheet_synced_at as synced_at, leads_sheet_error as error
    from sales_settings where id = 1`;
  return row ?? { url: null, name: null, synced_at: null, error: null };
}

/** Una fila de la planilla: las mismas columnas que el código de Apps Script. */
export type SheetLead = {
  id: string;
  fecha: string;
  nombre: string;
  email: string;
  whatsapp: string;
  consultorio: string;
  rol: string;
  especialidad: string;
  profesionales: string;
  mensaje: string;
  origen: string;
  estado: string;
  notas: string;
  actualizado: string;
};

const ORIGEN: Record<string, string> = {
  "demo-web": "Probó la demo (navegador)",
  "demo-whatsapp": "Probó la demo (WhatsApp)",
  "demo-telegram": "Probó la demo (Telegram)",
};

type LeadRow = {
  id: string; name: string; email: string | null; phone: string | null; organization: string | null; role: string | null;
  specialty: string | null; size: string | null; message: string | null; source: string | null; status: string; notes: string | null;
  created_at: string; updated_at: string;
};

export function toSheetLead(r: LeadRow): SheetLead {
  return {
    id: r.id,
    fecha: r.created_at,
    nombre: r.name,
    email: r.email ?? "",
    whatsapp: r.phone ?? "",
    consultorio: r.organization ?? "",
    rol: r.role ?? "",
    especialidad: r.specialty ?? "",
    profesionales: r.size ?? "",
    mensaje: r.message ?? "",
    origen: (r.source && ORIGEN[r.source]) ?? (r.source ? `Formulario (${r.source})` : "Formulario «Pedí una demo»"),
    estado: LEAD_STATUSES[r.status as keyof typeof LEAD_STATUSES] ?? r.status,
    notas: r.notes ?? "",
    actualizado: r.updated_at,
  };
}

/** Los títulos de las columnas, en el orden de SheetLead. */
export const LEAD_COLUMNS = ["ID", "Fecha", "Nombre", "Email", "WhatsApp", "Clínica o consultorio", "Rol", "Especialidad", "Profesionales", "Qué quiere resolver", "Origen", "Estado", "Notas", "Actualizado"];

export async function leadsForSheet(ids: string[] | "all"): Promise<SheetLead[]> {
  if (ids !== "all" && !ids.length) return [];
  const rows = await sql<LeadRow[]>`
    select id, name, email, phone, organization, role, specialty, size, message, source, status, notes, created_at, updated_at
    from leads ${ids === "all" ? sql`` : sql`where id in ${sql(ids)}`}
    order by created_at, id`;
  return rows.map(toSheetLead);
}

/** Manda una orden a la aplicación web de la planilla. Apps Script responde con una redirección a su JSON. */
async function post(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clave: sheetKey(), ...body }),
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SheetError(
      response.ok
        ? "La planilla no respondió como se esperaba. Revisá que la implementación sea «Aplicación web», con acceso para «Cualquier persona»."
        : `La planilla respondió con un error (${response.status}).`,
    );
  }
  if (data.ok !== true) {
    throw new SheetError(
      data.error === "clave"
        ? "La clave no coincide: copiá de nuevo el código del panel en Apps Script e implementá una versión nueva."
        : `La planilla respondió con un error: ${String(data.error ?? "desconocido").slice(0, 200)}.`,
    );
  }
  return data;
}

const message = (e: unknown) => (e instanceof SheetError ? e.message : "No se pudo conectar con la planilla. Probá de nuevo en un rato.");

/** Guarda la URL de la aplicación web y prueba la conexión. */
export async function connectSheet(rawUrl: string): Promise<{ name: string }> {
  const url = rawUrl.trim();
  if (!SHEET_URL.test(url)) {
    throw new SheetError("Pegá la URL de la aplicación web: empieza con https://script.google.com/macros/s/ y termina en /exec.");
  }
  let data: Record<string, unknown>;
  try {
    data = await post(url, { accion: "probar" });
  } catch (e) {
    throw new SheetError(message(e));
  }
  const name = typeof data.planilla === "string" && data.planilla.trim() ? data.planilla.trim().slice(0, 200) : "tu planilla";
  await sql`
    update sales_settings set leads_sheet_url = ${url}, leads_sheet_name = ${name}, leads_sheet_error = null, leads_sheet_synced_at = now()
    where id = 1`;
  return { name };
}

export async function disconnectSheet(): Promise<void> {
  await sql`update sales_settings set leads_sheet_url = null, leads_sheet_name = null, leads_sheet_error = null where id = 1`;
}

/**
 * Copia (o actualiza) pedidos en la planilla. Sin planilla conectada no hace nada. Nunca tira:
 * el error queda en el panel y el pedido ya está guardado en Turnia.
 */
export async function syncLeadsToSheet(ids: string[] | "all"): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const { url } = await sheetSettings();
    if (!url) return { ok: false, count: 0, error: "No hay una planilla conectada." };
    const leads = await leadsForSheet(ids);
    for (let i = 0; i < leads.length; i += 200) await post(url, { accion: "guardar", pedidos: leads.slice(i, i + 200) });
    await sql`update sales_settings set leads_sheet_synced_at = now(), leads_sheet_error = null where id = 1`;
    return { ok: true, count: leads.length };
  } catch (e) {
    console.error("Planilla de pedidos de demo:", e);
    const error = message(e);
    await sql`update sales_settings set leads_sheet_error = ${error} where id = 1`.catch(() => {});
    return { ok: false, count: 0, error };
  }
}

/** Saca de la planilla un pedido borrado del panel. */
export async function removeLeadFromSheet(id: string): Promise<void> {
  try {
    const { url } = await sheetSettings();
    if (url) await post(url, { accion: "borrar", ids: [id] });
  } catch (e) {
    console.error("Planilla de pedidos de demo:", e);
    await sql`update sales_settings set leads_sheet_error = ${message(e)} where id = 1`.catch(() => {});
  }
}

/** El código que el usuario pega en Extensiones → Apps Script de su planilla, con la clave ya puesta. */
export function appsScriptCode(key: string): string {
  return [
    "// Turnia Salud → Google Sheets: cada pedido de demo se copia solo en esta planilla.",
    "// Pegalo en Extensiones → Apps Script, guardá e implementalo como «Aplicación web».",
    `const CLAVE = "${key}";`,
    'const HOJA = "Pedidos de demo";',
    `const COLUMNAS = [${LEAD_COLUMNS.map((c) => JSON.stringify(c)).join(", ")}];`,
    "",
    "function doPost(e) {",
    "  let datos;",
    "  try { datos = JSON.parse(e.postData.contents); } catch (error) { return responder({ ok: false, error: \"json\" }); }",
    '  if (datos.clave !== CLAVE) return responder({ ok: false, error: "clave" });',
    "  const candado = LockService.getScriptLock();",
    "  candado.waitLock(20000);",
    "  try {",
    "    const hoja = obtenerHoja();",
    '    if (datos.accion === "probar") return responder({ ok: true, planilla: SpreadsheetApp.getActive().getName() });',
    '    if (datos.accion === "borrar") {',
    "      (datos.ids || []).forEach(function (id) { const fila = buscar(hoja, id); if (fila) hoja.deleteRow(fila); });",
    "      return responder({ ok: true });",
    "    }",
    "    const pedidos = datos.pedidos || [];",
    "    pedidos.forEach(function (p) { guardar(hoja, p); });",
    "    return responder({ ok: true, cantidad: pedidos.length });",
    "  } finally {",
    "    candado.releaseLock();",
    "  }",
    "}",
    "",
    "function obtenerHoja() {",
    "  const libro = SpreadsheetApp.getActive();",
    "  let hoja = libro.getSheetByName(HOJA);",
    "  if (!hoja) hoja = libro.insertSheet(HOJA, 0);",
    "  if (hoja.getLastRow() === 0) {",
    "    hoja.appendRow(COLUMNAS);",
    "    hoja.setFrozenRows(1);",
    '    hoja.getRange(1, 1, 1, COLUMNAS.length).setFontWeight("bold");',
    "  }",
    "  return hoja;",
    "}",
    "",
    "function buscar(hoja, id) {",
    "  if (hoja.getLastRow() < 2) return 0;",
    '  const celda = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();',
    "  return celda ? celda.getRow() : 0;",
    "}",
    "",
    "// El WhatsApp va como texto: si no, Sheets lo convierte en un número.",
    'function texto(valor) { return valor ? "\'" + valor : ""; }',
    "",
    "function guardar(hoja, p) {",
    "  const fila = [p.id, new Date(p.fecha), p.nombre, p.email, texto(p.whatsapp), p.consultorio, p.rol, p.especialidad, p.profesionales, p.mensaje, p.origen, p.estado, p.notas, new Date(p.actualizado)];",
    "  const existente = buscar(hoja, p.id);",
    "  if (existente) hoja.getRange(existente, 1, 1, fila.length).setValues([fila]);",
    "  else hoja.appendRow(fila);",
    "}",
    "",
    "function responder(datos) {",
    "  return ContentService.createTextOutput(JSON.stringify(datos)).setMimeType(ContentService.MimeType.JSON);",
    "}",
    "",
  ].join("\n");
}
