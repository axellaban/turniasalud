import "server-only";
import { createHash } from "node:crypto";
import { sql } from "./db";

// Límite de intentos fallidos de ingreso al panel por origen (IP), para que no se
// pueda probar contraseñas a ciegas. Si la base no responde, no bloquea: el ingreso
// del administrador nunca depende de este registro.
const WINDOW_MINUTES = 15;
const MAX_FAILURES = 10;

export function requesterKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "desconocido";
  return createHash("sha256").update(`turnia-login:${ip}`).digest("hex");
}

export async function tooManyFailures(key: string): Promise<boolean> {
  try {
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from login_failures
      where requester_hash = ${key} and created_at > now() - make_interval(mins => ${WINDOW_MINUTES})`;
    return count >= MAX_FAILURES;
  } catch (error) {
    console.error("login: no se pudo consultar el límite de intentos", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function recordFailure(key: string): Promise<void> {
  try {
    await sql`delete from login_failures where created_at < now() - interval '1 day'`;
    await sql`insert into login_failures (requester_hash) values (${key})`;
  } catch (error) {
    console.error("login: no se pudo registrar el intento", error instanceof Error ? error.message : error);
  }
}
