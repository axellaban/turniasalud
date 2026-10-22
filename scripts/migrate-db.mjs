// Aplica supabase/schema.sql en la base antes de cada build de producción en
// Vercel, así nadie tiene que pegarlo a mano en el SQL Editor de Neon después
// de un cambio. El esquema es idempotente: correrlo de nuevo no borra datos.
// Nunca corre seed.sql.
//
// - Solo en Vercel con VERCEL_ENV=production (los previews no tocan la base).
// - Localmente o en CI no hace nada, salvo `npm run db:migrate` (usa DATABASE_URL).
// - Si falla, corta el build: el deploy anterior sigue publicado y la base no
//   queda a medias (todo va en una transacción). Para publicar igual, cargar
//   SKIP_DB_MIGRATION=1 en Vercel.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const forced = process.argv.includes("--force");
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

function skip(reason) {
  console.log(`[db] No se actualiza la base: ${reason}.`);
  process.exit(0);
}

if (process.env.SKIP_DB_MIGRATION === "1") skip("SKIP_DB_MIGRATION=1");
if (!forced && process.env.VERCEL !== "1") skip("no es un build de Vercel");
if (!forced && process.env.VERCEL_ENV !== "production") skip(`build de ${process.env.VERCEL_ENV || "desarrollo"}, no de producción`);
if (!url) {
  if (forced) {
    console.error("[db] Falta DATABASE_URL.");
    process.exit(1);
  }
  skip("falta DATABASE_URL");
}

const target = new URL(url);
// channel_binding es de libpq: si se manda como parámetro de inicio, Postgres lo rechaza.
target.searchParams.delete("channel_binding");
const sql = postgres(target.toString(), { max: 1, connect_timeout: 30, prepare: false, onnotice: () => {} });
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

try {
  const started = Date.now();
  await sql.begin(async (tx) => {
    // Dos deploys a la vez no aplican el esquema al mismo tiempo.
    await tx`select pg_advisory_xact_lock(hashtextextended('turnia:schema', 0))`;
    await tx.unsafe(schema);
  });
  console.log(`[db] Base actualizada con supabase/schema.sql en ${Date.now() - started} ms (${target.hostname}).`);
} catch (e) {
  console.error(`[db] No se pudo actualizar la base (${target.hostname}): ${e instanceof Error ? e.message : e}`);
  console.error("[db] El build se corta para no publicar código con la base vieja. Si necesitás publicar igual, cargá SKIP_DB_MIGRATION=1 en Vercel.");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
