import "server-only";
import { sql } from "./db";
import { env } from "./env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Las clínicas de la demo del lead magnet (/probar-demo) no le avisan nada al equipo. */
async function isDemoClinic(clinicId: unknown): Promise<boolean> {
  if (typeof clinicId !== "string" || !UUID.test(clinicId)) return false;
  const [row] = await sql<{ is_demo: boolean }[]>`select is_demo from clinics where id = ${clinicId}`;
  return Boolean(row?.is_demo);
}

/**
 * Manda un evento al webhook de n8n (si está configurado). Nunca rompe el flujo
 * principal: si n8n no responde, el turno igual queda reservado.
 */
export async function notifyN8n(event: string, payload: Record<string, unknown>): Promise<void> {
  const url = env.n8nWebhookUrl();
  if (!url) return;
  try {
    if (await isDemoClinic(payload.clinic_id)) return;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AGENT_TOOLS_SECRET ? { "x-turnia-secret": process.env.AGENT_TOOLS_SECRET } : {}),
      },
      body: JSON.stringify({ event, sent_at: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    console.error(`n8n: no se pudo enviar ${event}`, e);
  }
}
