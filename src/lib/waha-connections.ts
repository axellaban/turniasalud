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

// Permite corregir el transporte de una línea sin reemplazar el secreto con todas las clínicas.
// No puede cambiar la asignación, el número, la firma del webhook ni habilitar una clínica.
const transportSchema = z.record(z.string(), connectionSchema.pick({
  url: true, apiKey: true, session: true, revision: true,
}).partial().strict());

export function wahaConnections(): WahaConnection[] {
  const raw = process.env.WAHA_CONNECTIONS || "[]";
  const transportRaw = process.env.WAHA_CONNECTION_TRANSPORTS || "{}";
  const cacheKey = raw + "\0" + transportRaw;
  if (cached?.raw === cacheKey) return cached.connections;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("WAHA_CONNECTIONS no contiene JSON válido."); }
  const result = z.array(connectionSchema).safeParse(parsed);
  if (!result.success) throw new Error("Revisá los campos de WAHA_CONNECTIONS; la configuración es inválida.");
  let transportParsed: unknown;
  try { transportParsed = JSON.parse(transportRaw); } catch { throw new Error("WAHA_CONNECTION_TRANSPORTS no contiene JSON válido."); }
  const transports = transportSchema.safeParse(transportParsed);
  if (!transports.success || Object.keys(transports.data).some((id) => !result.data.some((c) => c.id === id))) {
    throw new Error("Revisá los campos de WAHA_CONNECTION_TRANSPORTS; solo admite transportes de líneas existentes.");
  }
  const rows = result.data.map((c) => ({ ...c, ...transports.data[c.id] }));
  for (const key of ["id", "clinicId", "phone", "url"] as const) {
    if (new Set(rows.map((c) => c[key])).size !== rows.length) throw new Error(`WAHA_CONNECTIONS repite ${key}.`);
  }
  cached = { raw: cacheKey, connections: rows };
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
