import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { sql } from "../db";
import { env } from "../env";

export async function createDemoHandoff(website: string, ip: string): Promise<string | null> {
  const requester = createHmac("sha256", env.agentToolsSecret()).update(ip).digest("hex");
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('turnia-demo-handoffs', 0))`;
    await tx`delete from demo_handoffs where created_at < now() - interval '1 day'`;
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
