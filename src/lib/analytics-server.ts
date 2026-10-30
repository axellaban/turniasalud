import "server-only";
import { after } from "next/server";
import { POSTHOG_HOST, POSTHOG_PROJECT_KEY, TRACKING_VERSION } from "./analytics-shared";

// Eventos que pasan en el servidor y no en el navegador: los mensajes de la prospección que se
// registran desde el panel, la demo por WhatsApp o Telegram y la preparación de cada demo. Van al
// mismo proyecto de PostHog que los del navegador, por su API de captura (sin librería). Como los
// del navegador, solo salen en producción, salvo que se defina NEXT_PUBLIC_POSTHOG_KEY a mano.

export type ServerProperties = Record<string, string | number | boolean | null>;

/** Propiedades de la persona; sin ellas el evento no crea ni actualiza una persona en PostHog. */
export type PersonUpdate = { set?: ServerProperties; setOnce?: ServerProperties };

export function serverAnalyticsEnabled(): boolean {
  return process.env.VERCEL_ENV === "production" || Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

/** El cuerpo que recibe la API de captura de PostHog. */
export function captureBody(event: string, distinctId: string, properties: ServerProperties = {}, person?: PersonUpdate) {
  return {
    api_key: process.env.NEXT_PUBLIC_POSTHOG_KEY || POSTHOG_PROJECT_KEY,
    event,
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      ...properties,
      app_env: process.env.VERCEL_ENV || "local",
      tracking_version: TRACKING_VERSION,
      $lib: "turnia-server",
      ...(person ? { $set: person.set ?? {}, $set_once: person.setOnce ?? {} } : { $process_person_profile: false }),
    },
  };
}

/** Envía un evento y espera la respuesta (como mucho 3 s). Nunca tira: la analítica no frena nada. */
export async function captureServer(event: string, distinctId: string, properties: ServerProperties = {}, person?: PersonUpdate): Promise<void> {
  if (!serverAnalyticsEnabled()) return;
  try {
    const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST || POSTHOG_HOST).replace(/\/$/, "");
    const res = await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(captureBody(event, distinctId, properties, person)),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error("PostHog: no se registró", event, res.status);
  } catch (e) {
    console.error("PostHog: no se registró", event, e instanceof Error ? e.message : e);
  }
}

/**
 * Lo mismo, después de responder: no le suma espera a quien tocó el botón. Fuera de una petición
 * (un script, un test) se manda sin esperar.
 */
export function captureLater(event: string, distinctId: string, properties: ServerProperties = {}, person?: PersonUpdate): void {
  if (!serverAnalyticsEnabled()) return;
  const send = () => captureServer(event, distinctId, properties, person);
  try {
    after(send);
  } catch {
    void send();
  }
}
