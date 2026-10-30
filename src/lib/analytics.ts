import posthog from "posthog-js";
import { surfaceOf } from "@/lib/analytics-shared";

// Eventos del navegador para PostHog. Solo se cargan en producción (instrumentation-client.ts): en
// local y en los tests estas funciones no hacen nada. La analítica es de mejor esfuerzo: nunca tira.

export type EventProperties = Record<string, string | number | boolean>;

/**
 * Un evento, con la zona del sitio (`surface`). `beacon`: justo antes de salir de la página (o de
 * una navegación), para que no se pierda. `setOnce` guarda en la persona el primer valor de una
 * propiedad sin pisarlo después.
 */
export function track(event: string, properties: EventProperties = {}, beacon = false, setOnce?: EventProperties) {
  try {
    if (!posthog.__loaded) return;
    const props = { surface: surfaceOf(window.location.pathname), ...properties };
    posthog.capture(event, setOnce ? { ...props, $set_once: setOnce } : props, beacon ? { transport: "sendBeacon" } : undefined);
  } catch {
    /* Mejor esfuerzo. */
  }
}

/** Viaja en todos los eventos siguientes de este navegador (la demo que vio, el entorno…). */
export function registerSuperProperties(properties: EventProperties) {
  try {
    if (posthog.__loaded) posthog.register(properties);
  } catch {
    /* Mejor esfuerzo. */
  }
}

/** Atribución de primer contacto: queda la primera demo vista y no se reemplaza. */
export function registerSuperPropertiesOnce(properties: EventProperties) {
  try {
    if (posthog.__loaded) posthog.register_once(properties);
  } catch {
    /* Mejor esfuerzo. */
  }
}

/** Propiedades de la persona: `set` reemplaza, `setOnce` conserva el primer valor. */
export function setPersonProperties(set: EventProperties, setOnce?: EventProperties) {
  try {
    if (posthog.__loaded) posthog.setPersonProperties(set, setOnce);
  } catch {
    /* Mejor esfuerzo. */
  }
}

/**
 * Este navegador es el de esa persona (un odontólogo de la prospección que abrió su link): lo que
 * hizo antes como anónimo y lo que registra el panel quedan en la misma persona.
 */
export function identify(distinctId: string, set: EventProperties = {}, setOnce: EventProperties = {}) {
  try {
    if (posthog.__loaded && posthog.get_distinct_id() !== distinctId) posthog.identify(distinctId, set, setOnce);
  } catch {
    /* Mejor esfuerzo. */
  }
}

/** El id de PostHog de este navegador, para que el servidor siga la demo en la misma persona. */
export function analyticsId(): string | null {
  try {
    return posthog.__loaded ? posthog.get_distinct_id() : null;
  } catch {
    return null;
  }
}

const MILESTONE_KEY = "turnia_milestones";

/**
 * Un paso de activación que cuenta una vez por navegador (la primera demo, la primera conversación):
 * su propio evento la primera vez, con la fecha como propiedad de la persona. El evento de siempre
 * sigue saliendo cada vez.
 */
export function trackMilestone(milestone: string, properties: EventProperties = {}) {
  try {
    if (!posthog.__loaded) return;
    let seen: Record<string, number> = {};
    try {
      seen = JSON.parse(localStorage.getItem(MILESTONE_KEY) || "{}");
    } catch {
      /* Modo privado o almacenamiento bloqueado: la propiedad de la persona igual deduplica. */
    }
    if (seen[milestone]) return;
    seen[milestone] = Date.now();
    try {
      localStorage.setItem(MILESTONE_KEY, JSON.stringify(seen));
    } catch {
      /* Ídem. */
    }
    track(milestone, properties, false, { [`${milestone}_at`]: new Date().toISOString() });
  } catch {
    /* Mejor esfuerzo. */
  }
}
