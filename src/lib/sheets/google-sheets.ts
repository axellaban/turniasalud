import "server-only";
import { GoogleError } from "@/lib/calendar/google";

// Google Sheets por la API REST (sin SDK). Con el permiso drive.file, Turnia solo ve las planillas
// que creó ella (o las que la persona le eligió): nunca el resto de su Drive.

export const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
/** Escribir cientos de filas tarda más que un evento de Calendar. */
const TIMEOUT_MS = 20_000;

export type Cell = string | number;
/** Una pestaña completa: la primera fila son los títulos. */
export type Tab = { title: string; rows: Cell[][] };

/** Google Sheets API sin habilitar en el proyecto de Google Cloud de Turnia. */
const disabledApi = (status: number, detail: string) => status === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(detail);

/** Error de la API de Sheets, con el detalle de Google para decidir qué hacer. */
export class SheetsApiError extends GoogleError {
  constructor(status: number, readonly detail: string) {
    super(
      status === 401 ? "Google rechazó el acceso: volvé a conectar la cuenta."
      : disabledApi(status, detail) ? "Falta habilitar «Google Sheets API» en el proyecto de Google Cloud de Turnia (ver GOOGLE_SHEETS.md)."
      : status === 403 || status === 404 ? "La planilla ya no existe o Turnia perdió el acceso (¿la borraste?)."
      : status === 429 ? "Google pidió esperar un poco: se vuelve a copiar con el próximo cambio."
      : `Google Sheets respondió con un error (${status}).`,
      status,
      status === 401,
    );
  }

  /** La API no está habilitada: no es la planilla, es el proyecto de Google Cloud. */
  get disabled(): boolean {
    return disabledApi(this.status, this.detail);
  }

  /** La planilla se borró, se vació la papelera o Turnia perdió el acceso: hay que crear otra. */
  get missing(): boolean {
    return (this.status === 403 || this.status === 404) && !this.disabled;
  }
}

async function request(token: string, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new SheetsApiError(res.status, String((data.error as { message?: unknown } | undefined)?.message ?? ""));
  return data;
}

/** Rango A1 de una pestaña: 'Pedidos de demo'!A1 (las comillas del nombre se duplican). */
const range = (tab: string, cells: string) => `'${tab.replace(/'/g, "''")}'!${cells}`;

const tabProperties = (title: string) => ({ title, gridProperties: { frozenRowCount: 1 } });

/** Crea la planilla en el Drive de la cuenta conectada: una pestaña por tabla, con los títulos en negrita. */
export async function createSpreadsheet(token: string, title: string, tabs: Array<{ title: string; header: string[] }>): Promise<{ id: string; url: string }> {
  const data = await request(token, SHEETS_API, {
    method: "POST",
    body: JSON.stringify({
      properties: { title, locale: "es_AR", timeZone: "America/Argentina/Buenos_Aires" },
      sheets: tabs.map((tab) => ({
        properties: tabProperties(tab.title),
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [{ values: tab.header.map((h) => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })) }],
          },
        ],
      })),
    }),
  });
  return { id: String(data.spreadsheetId), url: String(data.spreadsheetUrl) };
}

/** Nombre, link y pestañas de la planilla. Sirve también para ver que sigue existiendo. */
export async function spreadsheetInfo(token: string, id: string): Promise<{ title: string; url: string; tabs: string[] }> {
  const data = await request(token, `${SHEETS_API}/${encodeURIComponent(id)}?fields=spreadsheetUrl,properties.title,sheets.properties.title`);
  const sheets = (data.sheets ?? []) as Array<{ properties?: { title?: string } }>;
  return {
    title: String((data.properties as { title?: unknown } | undefined)?.title ?? ""),
    url: String(data.spreadsheetUrl ?? ""),
    tabs: sheets.map((s) => String(s.properties?.title ?? "")),
  };
}

/**
 * Reescribe cada pestaña completa: los datos desde A1 y, abajo, borra lo que sobraba de la copia
 * anterior. Si alguien borró o renombró una pestaña, la vuelve a crear.
 */
export async function writeTabs(token: string, id: string, tabs: Tab[]): Promise<void> {
  const base = `${SHEETS_API}/${encodeURIComponent(id)}`;
  const write = () =>
    request(token, `${base}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: tabs.map((t) => ({ range: range(t.title, "A1"), majorDimension: "ROWS", values: t.rows })) }),
    });
  try {
    await write();
  } catch (e) {
    if (!(e instanceof SheetsApiError && e.status === 400 && /parse range/i.test(e.detail))) throw e;
    const present = new Set((await spreadsheetInfo(token, id)).tabs);
    const missing = tabs.filter((t) => !present.has(t.title));
    if (!missing.length) throw e;
    await request(token, `${base}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: missing.map((t) => ({ addSheet: { properties: tabProperties(t.title) } })) }),
    });
    await write();
  }
  await request(token, `${base}/values:batchClear`, {
    method: "POST",
    body: JSON.stringify({ ranges: tabs.map((t) => range(t.title, `A${t.rows.length + 1}:ZZ`)) }),
  });
}
