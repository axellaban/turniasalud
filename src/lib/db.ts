import "server-only";
import postgres from "postgres";

// Conexión directa a Postgres (Neon, Supabase o local) con consultas
// parametrizadas. Solo corre en el servidor: el navegador nunca recibe la URL.
// Neon y Supabase dan esta URL en su panel; la integración de Neon en Vercel
// la carga sola como DATABASE_URL.

export type Sql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;

export function databaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function connect(): Sql {
  const raw = databaseUrl();
  if (!raw) throw new Error("Falta la variable de entorno DATABASE_URL. Revisá la configuración en Vercel.");
  const url = new URL(raw);
  // channel_binding es de libpq: si se manda como parámetro de inicio, Postgres lo rechaza.
  url.searchParams.delete("channel_binding");
  return postgres(url.toString(), {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Los poolers (PgBouncer de Neon, Supavisor de Supabase) trabajan en modo transacción.
    prepare: false,
    onnotice: () => {},
    connection: { application_name: "turnia-salud", TimeZone: "UTC" },
    transform: { undefined: null },
    types: {
      // Las fechas sin hora (DNI, nacimiento) quedan como "AAAA-MM-DD".
      fecha: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
      // Los instantes viajan como texto ISO, igual que en la API.
      instante: {
        to: 1184,
        from: [1114, 1184],
        serialize: (x: unknown) => (x instanceof Date ? x : new Date(String(x))).toISOString(),
        parse: (x: string) => new Date(x).toISOString(),
      },
    },
  });
}

const cache = globalThis as unknown as { turniaSql?: Sql };

function client(): Sql {
  return (cache.turniaSql ??= connect());
}

/**
 * Cliente perezoso: se conecta en la primera consulta, así el build y las
 * páginas sin datos no necesitan la variable de entorno.
 */
export const sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_target, _this, args) => Reflect.apply(client() as unknown as (...a: unknown[]) => unknown, undefined, args),
  get: (_target, prop) => Reflect.get(client(), prop),
});

/** Valor para una columna jsonb. */
export const json = (value: unknown) => sql.json(value as postgres.JSONValue);

/** Cierra la conexión (tests y scripts). */
export async function closeDb(): Promise<void> {
  const current = cache.turniaSql;
  cache.turniaSql = undefined;
  await current?.end({ timeout: 5 });
}

/** Código de error de Postgres, si lo hay (23P01 = superposición, 23505 = duplicado). */
export function pgErrorCode(error: unknown): string | null {
  return error instanceof postgres.PostgresError ? error.code : null;
}
