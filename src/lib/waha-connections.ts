import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

// Las líneas propias se suman al WAHA general; no cambian el canal de la demo.
// Las claves viven únicamente en una variable privada de Vercel.
const connectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  clinicId: z.uuid(),
  phone: z.string().regex(/^\d{8,15}$/),
  url: z.url().refine((s) => {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/";
  }),
  apiKey: z.string().min(16),
  webhookHmac: z.string().min(16),
  session: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("default"),
  enabled: z.boolean().default(false),
  revision: z.number().int().positive(),
});

export type WahaConnection = z.infer<typeof connectionSchema>;
const scope = new AsyncLocalStorage<WahaConnection>();
let cached: { raw: string; connections: WahaConnection[] } | undefined;

export function wahaConnections(): WahaConnection[] {
  const raw = process.env.WAHA_CONNECTIONS || "[]";
  if (cached?.raw === raw) return cached.connections;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("WAHA_CONNECTIONS no contiene JSON válido."); }
  const result = z.array(connectionSchema).safeParse(parsed);
  if (!result.success) throw new Error("Revisá los campos de WAHA_CONNECTIONS; la configuración es inválida.");
  const rows = result.data;
  for (const key of ["id", "clinicId", "phone", "url"] as const) {
    if (new Set(rows.map((c) => c[key])).size !== rows.length) throw new Error(`WAHA_CONNECTIONS repite ${key}.`);
  }
  cached = { raw, connections: rows };
  return rows;
}

export const currentWahaConnection = () => scope.getStore();
export const wahaConnectionById = (id: string) => wahaConnections().find((c) => c.id === id);
export const wahaConnectionForClinic = (clinicId: string) => wahaConnections().find((c) => c.clinicId === clinicId);
export function withWahaConnection<T>(connection: WahaConnection, work: () => T): T {
  return scope.run(connection, work);
}

/** Usa el WAHA general (la línea de Turnia) aunque se esté atendiendo la línea propia de una clínica. */
export function withGeneralWaha<T>(work: () => T): T {
  return scope.exit(work);
}

export function withClinicWaha<T>(clinicId: string, work: () => T): T {
  const connection = wahaConnectionForClinic(clinicId);
  return connection ? withWahaConnection(connection, work) : work();
}
