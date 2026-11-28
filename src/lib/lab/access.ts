import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "../db";

// Claves para leer el laboratorio desde afuera (Claude Code o ChatGPT con la suscripción). Se crean en
// Panel → Laboratorio → Criterios; en la base queda solo el hash.
//   - «lectura»: /api/lab/informe.
//   - «evaluar»: además /api/lab/evaluaciones (traer lo pendiente y cargar evaluaciones y propuestas).
// LAB_REPORT_TOKEN, si está en Vercel, vale solo para leer.

export type LabScope = "lectura" | "evaluar";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export async function labTokenAuthorized(request: Request, scope: LabScope): Promise<boolean> {
  const received = request.headers.get("x-lab-token") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!received || received.length < 24) return false;
  const expected = process.env.LAB_REPORT_TOKEN;
  if (scope === "lectura" && expected && expected.length >= 24) {
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  const [row] = await sql`
    update lab_access_tokens set last_used_at = now()
    where token_hash = ${sha(received)} and revoked_at is null and (${scope} = 'lectura' or scope = 'evaluar')
    returning id`;
  return Boolean(row);
}
