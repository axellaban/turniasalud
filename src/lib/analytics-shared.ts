// Lo que comparten la analítica del navegador (instrumentation-client.ts, analytics.ts) y la del
// servidor (analytics-server.ts). Sin dependencias: lo usan los dos lados y los tests.

/** Token del proyecto de Turnia Salud en PostHog (US Cloud). Público por diseño: solo escribe eventos. */
export const POSTHOG_PROJECT_KEY = "phc_nKjNDywk3NVRFgPootaB3berBhUXhhm94zEiSGmyr83H";
export const POSTHOG_HOST = "https://us.i.posthog.com";

/** Cambia cuando cambia el catálogo de eventos (ANALITICA.md), para separar los datos de antes. */
export const TRACKING_VERSION = 1;

/**
 * El panel (datos de pacientes y de cada consultorio) y la demo interna (/demo) no se miden ni se
 * graban: ningún evento sale con esas direcciones.
 */
export function isPrivatePath(pathname: string): boolean {
  return /^\/(panel|demo)(\/|$)/.test(pathname);
}

/**
 * Los tokens de una demo del navegador o de su llamada abren esa demo (y gastan minutos de
 * ElevenLabs): nunca llegan a la analítica, tampoco dentro de una URL o del referrer.
 */
export function redactTokens(text: string): string {
  return text.replace(/(\/probar-demo\/(?:sesion|llamada)\/)[^/?#\s"']+/g, "$1[oculto]");
}

/** La zona del sitio: viaja en cada evento del navegador como `surface`. */
export function surfaceOf(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/p/")) return "demo_personal";
  if (pathname.startsWith("/probar-demo/sesion/")) return "demo_web";
  if (pathname.startsWith("/probar-demo/llamada/")) return "demo_llamada";
  if (pathname.startsWith("/probar-demo")) return "probar_demo";
  if (pathname.startsWith("/pedi-una-demo")) return "pedi_una_demo";
  if (pathname.startsWith("/escucha-a-nuestros-agentes")) return "escucha";
  if (/^\/(especialidades|soluciones|organizaciones)(\/|$)/.test(pathname)) return "landing";
  if (/^\/(plataforma|recepcion|activa|nosotros)(\/|$)/.test(pathname)) return "producto";
  return "otra";
}

/** `conversion`: lleva a probar la demo o a pedirla. `navigation`: el resto. */
export type CtaKind = "conversion" | "navigation";

/**
 * Atributos que convierten un elemento en un llamado a la acción medido: un `cta_clicked` por
 * clic con su id, su zona y su destino lógico. No cambian nada en pantalla.
 */
export function cta(id: string, location: string, destination: string, kind: CtaKind = "conversion") {
  return { "data-cta": id, "data-cta-location": location, "data-cta-destination": destination, "data-cta-kind": kind };
}

/** La persona de la prospección en PostHog: la misma desde el navegador (su link) y desde el panel. */
export const prospectDistinctId = (code: string) => `prospecto:${code}`;

/** Una demo por WhatsApp o Telegram, que no pasa por el navegador: sus eventos se agrupan por demo. */
export const demoDistinctId = (sessionId: string) => `demo:${sessionId}`;

/** El id anónimo que manda el navegador al empezar una demo, para que el servidor siga en la misma persona. */
export function cleanAnalyticsId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,200}$/.test(value) ? value : null;
}
