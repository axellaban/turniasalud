import posthog from "posthog-js";
import { TRACKING_VERSION, surfaceOf } from "@/lib/analytics-shared";
import { registerSuperProperties, track, type EventProperties } from "@/lib/analytics";

/**
 * Comportamiento sobre los eventos de analytics.ts: los clics en los llamados a la acción, el
 * tráfico del equipo y el tiempo activo en las demos. Privacidad primero: nunca lee lo que se
 * escribe en un formulario ni el texto de un botón; cada elemento dice qué es con atributos `data-`
 * (ver `cta`). Lo continuo (scroll, tiempo, audio) se resume: nunca sale un evento por movimiento.
 * PostHog suma solo a cada evento la persona (distinct_id), $session_id, $device_type, la URL y el
 * vínculo a la grabación.
 */

type Dataset = Record<string, string | undefined>;

/** Las propiedades de un clic en un elemento `cta`, leídas solo de sus atributos. */
export function ctaProperties(dataset: Dataset, pathname: string): EventProperties {
  const clip = (v: string | undefined) => (v ? v.slice(0, 80) : undefined);
  return {
    cta_id: clip(dataset.cta) ?? "unknown",
    cta_location: clip(dataset.ctaLocation) ?? "unknown",
    cta_destination: clip(dataset.ctaDestination) ?? "unknown",
    cta_kind: clip(dataset.ctaKind) ?? "conversion",
    surface: surfaceOf(pathname),
  };
}

/** Un clic que sale de la página en la misma pestaña: su evento sale en el acto. */
const leavesPage = (el: HTMLElement) => {
  if (!(el instanceof HTMLAnchorElement)) return false;
  const href = el.getAttribute("href") ?? "";
  return Boolean(href) && !href.startsWith("#") && el.target !== "_blank" && !el.hasAttribute("download");
};

/**
 * Se dispara cuando un clic está por llevar a otra página en la misma pestaña. La salida de
 * PostHog (pagehide) no sobrevive a una navegación así: los temporizadores reportan acá.
 */
export const LEAVING = "turnia:leaving";

const INTERNAL_KEY = "turnia_internal";
const INTERNAL_PARAM = "turnia_interno";

/** El dispositivo es del equipo (vale también sin PostHog cargado: queda para la próxima visita). */
export function isInternal(): boolean {
  try {
    return Boolean(localStorage.getItem(INTERNAL_KEY));
  } catch {
    return false;
  }
}

/**
 * El tráfico del equipo (el panel del administrador, la demo vista desde el panel o un dispositivo
 * marcado con ?turnia_interno=1) lleva is_internal en cada evento y en la persona, así los tableros
 * lo dejan afuera. ?turnia_interno=0 lo desmarca.
 */
export function markInternal(reason: string) {
  try {
    localStorage.setItem(INTERNAL_KEY, reason.slice(0, 40));
  } catch {
    /* Almacenamiento bloqueado: esta carga igual queda marcada. */
  }
  try {
    if (!posthog.__loaded) return;
    posthog.register({ is_internal: true });
    posthog.setPersonProperties({ is_internal: true });
  } catch {
    /* Mejor esfuerzo. */
  }
}

function applyInternal() {
  let flagged: string | null = null;
  try {
    const param = new URLSearchParams(window.location.search).get(INTERNAL_PARAM);
    if (param === "0") {
      localStorage.removeItem(INTERNAL_KEY);
      posthog.unregister("is_internal");
      posthog.setPersonProperties({ is_internal: false });
      return;
    }
    if (param === "1") localStorage.setItem(INTERNAL_KEY, "manual");
    flagged = localStorage.getItem(INTERNAL_KEY);
  } catch {
    /* Almacenamiento bloqueado: nada que leer. */
  }
  if (flagged) markInternal(flagged);
}

/** Se instala una vez, desde instrumentation-client.ts, después de que arranca PostHog. */
export function installInteractionTracking(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __turniaTracking?: boolean };
  if (w.__turniaTracking || !posthog.__loaded) return;
  w.__turniaTracking = true;
  registerSuperProperties({ app_env: process.env.NEXT_PUBLIC_VERCEL_ENV || "local", tracking_version: TRACKING_VERSION });
  applyInternal();
  // Fase de captura: corre antes que el manejador del elemento y antes de que empiece la navegación.
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>("[data-cta]");
      if (!el || el.matches(":disabled,[aria-disabled='true']")) return;
      const leaving = leavesPage(el);
      track("cta_clicked", ctaProperties(el.dataset, window.location.pathname), leaving);
      if (leaving) window.dispatchEvent(new Event(LEAVING));
    },
    { capture: true },
  );
}

const pct = (n: number) => Math.round(Math.min(100, Math.max(0, n)));
const IDLE_MS = 30_000;
const TICK_MS = 5_000;

/**
 * Tiempo activo en una demo: visible y con actividad en los últimos 30 s. Se reporta por tramos
 * (cada vez que se oculta la pestaña o se sale), así el total de la visita es la suma de sus
 * `demo_active_time`, con el scroll más profundo. Devuelve la función que lo detiene.
 */
export function startDemoEngagement(context: EventProperties) {
  let lastInput = Date.now();
  let lastTick = Date.now();
  let activeMs = 0;
  let visibleMs = 0;
  let maxScroll = 0;
  let scrollQueued = false;
  const tick = () => {
    const now = Date.now();
    if (document.visibilityState === "visible") {
      const span = now - lastTick;
      visibleMs += span;
      if (now - lastInput < IDLE_MS) activeMs += span;
    }
    lastTick = now;
  };
  const onInput = () => {
    tick();
    lastInput = Date.now();
  };
  const onScroll = () => {
    onInput();
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const doc = document.documentElement;
      maxScroll = Math.max(maxScroll, pct(((window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight)) * 100));
    });
  };
  const flush = (reason: string) => {
    tick();
    if (visibleMs >= 1000)
      track(
        "demo_active_time",
        { ...context, active_ms: Math.min(activeMs, 3_600_000), visible_ms: Math.min(visibleMs, 3_600_000), max_scroll_pct: maxScroll, end_reason: reason },
        true,
      );
    activeMs = 0;
    visibleMs = 0;
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush("hidden");
    else lastTick = lastInput = Date.now();
  };
  const onPageHide = () => flush("pagehide");
  const onLeaving = () => flush("navigation");
  const timer = window.setInterval(tick, TICK_MS);
  const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  for (const e of inputs) window.addEventListener(e, onInput, { passive: true, capture: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener(LEAVING, onLeaving);
  return () => {
    flush("unmount");
    window.clearInterval(timer);
    for (const e of inputs) window.removeEventListener(e, onInput, { capture: true });
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener(LEAVING, onLeaving);
  };
}

/**
 * Cuánto se escuchó de un audio de muestra: un `demo_audio_listened` cada vez que se corta (pausa,
 * fin, pestaña oculta o salida), con lo escuchado en ese tramo y hasta dónde llegó.
 */
export class ListenTracker {
  private since: number | null = null;
  private maxPct = 0;
  private plays = 0;
  // El audio sigue sonando con la pestaña oculta: se reporta el tramo y se sigue contando.
  private readonly onHide = () => {
    if (document.visibilityState !== "hidden" || this.since === null) return;
    this.stop("hidden", true);
    this.since = Date.now();
  };
  private readonly onPageHide = () => this.stop("pagehide", true);
  private readonly onLeaving = () => this.stop("navigation", true);
  constructor(private readonly context: EventProperties) {
    document.addEventListener("visibilitychange", this.onHide);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener(LEAVING, this.onLeaving);
  }
  play() {
    if (this.since !== null) return;
    this.since = Date.now();
    this.plays += 1;
    if (this.plays === 1) track("demo_audio_played", this.context);
  }
  progress(position: number, duration: number) {
    if (duration > 0) this.maxPct = Math.max(this.maxPct, pct((position / duration) * 100));
  }
  stop(reason: string, beacon = false) {
    if (this.since === null) return;
    const listened = Date.now() - this.since;
    this.since = null;
    if (reason === "ended") this.maxPct = 100;
    if (listened >= 1000)
      track(
        "demo_audio_listened",
        { ...this.context, listened_ms: Math.min(listened, 3_600_000), max_pct: this.maxPct, completed: this.maxPct >= 95, end_reason: reason },
        beacon,
      );
  }
  dispose() {
    this.stop("unmount");
    document.removeEventListener("visibilitychange", this.onHide);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener(LEAVING, this.onLeaving);
  }
}
