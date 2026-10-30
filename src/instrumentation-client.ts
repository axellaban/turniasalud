import posthog from "posthog-js";
import { POSTHOG_PROJECT_KEY, isPrivatePath, redactTokens } from "@/lib/analytics-shared";

// PostHog: eventos de la web, las demos y la prospección (catálogo en ANALITICA.md).
// Solo producción envía eventos, salvo que se defina NEXT_PUBLIC_POSTHOG_KEY a mano.
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY || POSTHOG_PROJECT_KEY;
const enabled = process.env.NEXT_PUBLIC_VERCEL_ENV === "production" || Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

const pathOf = (url: unknown) => {
  try {
    return new URL(String(url), window.location.origin).pathname;
  } catch {
    return "";
  }
};

/** La grabación se pausa en el panel y en /demo; se retoma al volver a la web. */
let recordingPaused = false;

if (enabled && typeof window !== "undefined") {
  try {
    recordingPaused = isPrivatePath(window.location.pathname);
    posthog.init(key, {
      // Proxy en el mismo dominio (next.config.ts): los bloqueadores de anuncios no cortan los eventos.
      api_host: "/ingest",
      ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || "https://us.posthog.com",
      defaults: "2026-08-30",
      disable_session_recording: recordingPaused,
      before_send: (event) => {
        if (!event) return event;
        // Nada del panel ni de la demo interna: ahí hay datos de pacientes y de cada consultorio.
        if (isPrivatePath(pathOf(event.properties?.$current_url ?? window.location.href))) return null;
        for (const bag of [event.properties, event.$set, event.$set_once] as (Record<string, unknown> | undefined)[])
          if (bag) for (const k of Object.keys(bag)) if (typeof bag[k] === "string") bag[k] = redactTokens(bag[k] as string);
        return event;
      },
    });
    // Clics en los llamados a la acción y la marca de tráfico interno, fuera del camino crítico.
    void import("@/lib/interaction-tracking").then(({ installInteractionTracking }) => installInteractionTracking());
  } catch {
    /* La analítica nunca rompe la página. */
  }
}

/** Al entrar al panel por navegación del cliente se deja de grabar; al volver a la web, se retoma. */
export function onRouterTransitionStart(url: string) {
  try {
    if (!enabled || !posthog.__loaded) return;
    const privado = isPrivatePath(pathOf(url));
    if (privado && !recordingPaused) {
      recordingPaused = true;
      posthog.stopSessionRecording();
    } else if (!privado && recordingPaused) {
      recordingPaused = false;
      posthog.startSessionRecording();
    }
  } catch {
    /* La analítica nunca rompe la navegación. */
  }
}
