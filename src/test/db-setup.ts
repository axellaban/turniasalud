import { readFileSync } from "node:fs";
import postgres from "postgres";

// Prepara una base Postgres DESCARTABLE para los tests de integración:
// borra el esquema public y aplica schema.sql y seed.sql (dos veces, para
// probar que son idempotentes). Solo acepta bases locales o el servicio de CI.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

export function testDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`TEST_DATABASE_URL apunta a "${host}". Los tests borran la base: usá un Postgres local o de CI.`);
  }
  return url;
}

/**
 * Crea (o vuelve a crear) otra base vacía en el mismo servidor de test, para
 * que cada archivo de integración tenga la suya y puedan correr en paralelo.
 */
export async function scratchDatabase(url: string, name: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Nombre de base inválido: ${name}`);
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const scratch = new URL(url);
  scratch.pathname = `/${name}`;
  return scratch.toString();
}

export async function resetTestDatabase(url: string): Promise<void> {
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe("drop schema if exists public cascade; create schema public;");
    for (let i = 0; i < 2; i++) {
      await admin.unsafe(readFileSync("supabase/schema.sql", "utf8"));
      await admin.unsafe(readFileSync("supabase/seed.sql", "utf8"));
    }
  } finally {
    await admin.end();
  }
}
