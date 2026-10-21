import "server-only";
import { env } from "./env";

/**
 * Manda un evento al webhook de n8n (si está configurado). Nunca rompe el flujo
 * principal: si n8n no responde, el turno igual queda reservado.
 */
export async function notifyN8n(event: string, payload: Record<string, unknown>): Promise<void> {
  const url = env.n8nWebhookUrl();
  if (!url) return;
  try {
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
