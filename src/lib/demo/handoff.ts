import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { sql } from "../db";
import { env } from "../env";

export async function createDemoHandoff(website: string, ip: string): Promise<string | null> {
  const requester = createHmac("sha256", env.agentToolsSecret()).update(ip).digest("hex");
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('turnia-demo-handoffs', 0))`;
    await tx`delete from demo_handoffs where expires_at < now() and created_at < now() - interval '1 day'`;
    const [quota] = await tx<{ own: number; total: number }[]>`
      select count(*) filter (where requester_hash = ${requester})::int as own, count(*)::int as total
      from demo_handoffs where created_at > now() - interval '1 hour'`;
    // Freno contra abusos del formulario público: 30 enlaces por origen y 1000 en total por hora.
    if (quota.own >= 30 || quota.total >= 1000) return null;
    const token = `d_${randomBytes(18).toString("base64url")}`;
    await tx`insert into demo_handoffs (token, website, requester_hash) values (${token}, ${website}, ${requester})`;
    return token;
  });
}

/** Reclamo atómico: otro usuario no puede reutilizar el enlace de una demo ya iniciada. */
export async function claimDemoHandoff(token: string, userId: string): Promise<string | null> {
  if (!/^d_[a-zA-Z0-9_-]{24}$/.test(token)) return null;
  const [row] = await sql<{ website: string }[]>`
    update demo_handoffs set claimed_by = ${userId}
    where token = ${token} and expires_at > now() and (claimed_by is null or claimed_by = ${userId})
    returning website`;
  return row?.website ?? null;
}

/** Los enlaces de perfil se comparten para probar una ficha guardada: valen varias veces durante este lapso. */
export const PROFILE_HANDOFF_DAYS = 7;

/** Solo se emite desde el panel autenticado; no crea otra clínica ni consume una extracción. */
export async function createProfileHandoff(clinicId: string, website: string | null): Promise<string> {
  const token = `p_${randomBytes(18).toString("base64url")}`;
  await sql`insert into demo_handoffs (token, website, requester_hash, clinic_id, expires_at)
    values (${token}, ${website || env.appUrl()}, 'admin-profile', ${clinicId}, now() + make_interval(days => ${PROFILE_HANDOFF_DAYS}))`;
  return token;
}

/** Reutilizable por cualquier chat mientras no venza; claimed_by guarda el último que lo usó. */
export async function claimProfileHandoff(token: string, userId: string): Promise<string | null> {
  if (!/^p_[a-zA-Z0-9_-]{24}$/.test(token)) return null;
  const [row] = await sql<{ clinic_id: string }[]>`update demo_handoffs set claimed_by = ${userId}
    where token = ${token} and clinic_id is not null and expires_at > now() returning clinic_id`;
  return row?.clinic_id ?? null;
}
