import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { sql } from "../db";
import { env } from "../env";

export async function createDemoHandoff(website: string, ip: string): Promise<string | null> {
  const requester = createHmac("sha256", env.agentToolsSecret()).update(ip).digest("hex");
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('turnia-demo-handoffs', 0))`;
    await tx`delete from demo_handoffs where expires_at < now() - interval '1 day'`;
    const [quota] = await tx<{ own: number; total: number }[]>`
      select count(*) filter (where requester_hash = ${requester})::int as own, count(*)::int as total
      from demo_handoffs where created_at > now() - interval '1 hour'`;
    if (quota.own >= 10 || quota.total >= 1000) return null;
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

/** Solo se emite desde el panel autenticado; no crea otra clínica ni consume una extracción. */
export async function createProfileHandoff(clinicId: string, website: string | null): Promise<string> {
  return sql.begin(async (tx) => {
    await tx`select id from clinics where id = ${clinicId} for update`;
    // Un nuevo enlace deja sin efecto los anteriores de esta ficha.
    await tx`update demo_handoffs set expires_at = now() where clinic_id = ${clinicId} and expires_at > now()`;
    const token = `p_${randomBytes(18).toString("base64url")}`;
    await tx`insert into demo_handoffs (token, website, requester_hash, clinic_id, expires_at) values (${token}, ${website || env.appUrl()}, 'admin-profile', ${clinicId}, now() + interval '7 days')`;
    return token;
  });
}

export async function revokeProfileHandoffs(clinicId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select id from clinics where id = ${clinicId} for update`;
    await tx`update demo_handoffs set expires_at = now() where clinic_id = ${clinicId} and expires_at > now()`;
  });
}

export async function claimProfileHandoff(token: string): Promise<string | null> {
  if (!/^p_[a-zA-Z0-9_-]{24}$/.test(token)) return null;
  // El enlace comparte una ficha de demo; cada usuario conserva su sesión por separado.
  const [row] = await sql<{ clinic_id: string }[]>`select h.clinic_id from demo_handoffs h join clinics c on c.id = h.clinic_id
    where h.token = ${token} and h.expires_at > now() and c.is_demo`;
  return row?.clinic_id ?? null;
}
