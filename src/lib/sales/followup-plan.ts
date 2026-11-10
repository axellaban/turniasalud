// La cola de Follow-up (traída de habita.: amoblaia src/lib/followup/plan.ts), adaptada a Turnia:
// qué pasó en la conversación (situación), qué toca ahora (acción, grupo, prioridad) y por qué no
// se puede ejecutar todavía (bloqueo). Puro: lo comparten el servidor y los tests.
import { FOLLOWUP_STAGES, TOUCH_STAGES, type StageKey } from "./followup-stages";

export const SITUATIONS = {
  sin_respuesta: "Sin respuesta",
  confirmo_numero: "Respondió el saludo",
  interesado: "Interesado",
  neutro: "Neutro",
  pregunta_precios: "Pregunta precios",
  mas_adelante: "Pide más adelante",
  recontactar_vacaciones: "Recontactar · Vacaciones",
  recontactar_mas_adelante: "Recontactar · Más adelante",
  derivo: "Derivó",
  rechazo: "Rechazo",
  no_contactar: "No contactar",
  sin_whatsapp: "Sin WhatsApp",
  numero_incorrecto: "Número incorrecto",
} as const;
export type Situation = keyof typeof SITUATIONS;
export const isSituation = (v: unknown): v is Situation => typeof v === "string" && v in SITUATIONS;
/** A estas no se les escribe nunca, haya la versión que haya. */
export const CLOSED_SITUATIONS: Situation[] = ["rechazo", "no_contactar", "sin_whatsapp", "numero_incorrecto"];

export const PRIORITIES = ["alta", "media", "baja"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const isPriority = (v: unknown): v is Priority => typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);

export type Group = "respuestas" | "demos" | "seguimientos" | "nuevos";
export const GROUP_LABEL: Record<Group, string> = { respuestas: "Respuestas", demos: "Demos por enviar", seguimientos: "Seguimientos", nuevos: "Contactos nuevos" };
const GROUP_ORDER: Group[] = ["respuestas", "demos", "seguimientos", "nuevos"];
const DEFAULT_PRIORITY: Record<Group, Priority> = { respuestas: "alta", demos: "alta", seguimientos: "media", nuevos: "baja" };

/** Las etapas que siguen a la demo: se espera esto desde nuestro último mensaje. */
export const AFTER_HOURS = 48;
/** Una persona tomada por una sesión queda así de bloqueada para las demás. */
export const CLAIM_SECONDS = 600;

/** Estados de Prospección (sales_outreach.status) que ya dicen la situación. */
export function derivedSituation(p: { status: string; touches: number; suppressed: boolean; whatsapp: boolean }): Situation {
  if (p.suppressed || p.status === "baja") return "no_contactar";
  if (p.status === "no_interesa") return "rechazo";
  if (p.status === "sin_canal" || !p.whatsapp) return "sin_whatsapp";
  if (p.status === "reunion") return "interesado";
  if (p.status === "respondio") return p.touches === 0 ? "confirmo_numero" : "neutro";
  return "sin_respuesta";
}

/** La situación marcada a mano vale mientras el embudo siga en el mismo paso (como en habita.). */
export function currentSituation(derived: Situation, manual: { situation: string | null; step: number | null } | null, step: number): { situation: Situation; manual: boolean } {
  if (CLOSED_SITUATIONS.includes(derived)) return { situation: derived, manual: false };
  if (manual && isSituation(manual.situation) && manual.step === step) return { situation: manual.situation, manual: true };
  return { situation: derived, manual: false };
}

export function groupOf(stage: StageKey, situation: Situation): Group {
  if (["confirmo_numero", "interesado", "pregunta_precios", "derivo", "neutro"].includes(situation)) return "respuestas";
  if (stage === "sin-saludo") return "nuevos";
  if (stage === "saludo-sin-demo") return "demos";
  if (stage === "converso-sin-cuenta") return "respuestas";
  return "seguimientos";
}

export const defaultPriority = (g: Group): Priority => DEFAULT_PRIORITY[g];

/** Lo que dice la acción en la cola: la meta de la etapa. */
export function actionLabel(stage: StageKey) {
  const s = FOLLOWUP_STAGES.find((x) => x.key === stage)!;
  return stage === "sin-saludo" ? "Paso 1: el saludo" : stage === "saludo-sin-demo" ? "Paso 2: pedir permiso" : `Llevar a: ${s.goal.toLowerCase()}`;
}

export type PlanInput = {
  stage: StageKey;
  situation: Situation;
  touches: number;
  whatsapp: boolean;
  /** Sin saludar: el mismo número no lo recibió otro. */
  contactable: boolean;
  /** Ya salió el Paso 2 (el gancho que pide permiso para pasar el link). */
  permission?: boolean;
  /** El próximo paso de Prospección (día, AAAA-MM-DD), la cadencia de días hábiles de su panel. */
  nextActionOn: string | null;
  lastContactAt: string | null;
  snoozedUntil: string | null;
  hasVersion: boolean;
  sentThisVersion: boolean;
  newToday: number;
  dailyCap: number;
};
export type Plan = {
  /** Hay algo para mandar (aunque esté bloqueado o programado). */
  pending: boolean;
  /** Por qué no hay acción (secuencia terminada, cerrado). */
  actionReason: string | null;
  /** Programada: sale en esta fecha. */
  dueAt: string | null;
  blocked: string | null;
};

const DAY_MS = 86_400_000;

/** «AAAA-MM-DD» de hoy en Argentina. */
export const artToday = (now: Date) => new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/** Fuera de horario, hora de Argentina: lunes a sábado de 8:30 a 21 (contactos nuevos hasta las 20). */
export function outsideHours(group: Group, now: Date): string | null {
  const art = new Date(now.getTime() - 3 * 3600_000);
  const day = art.getUTCDay();
  const minutes = art.getUTCHours() * 60 + art.getUTCMinutes();
  const close = group === "nuevos" ? 20 * 60 : 21 * 60;
  if (day === 0) return "Fuera de horario: los domingos no se escribe.";
  if (minutes < 8 * 60 + 30 || minutes >= close) return `Fuera de horario: de lunes a sábado, de 8:30 a ${group === "nuevos" ? 20 : 21}.`;
  return null;
}

/** Qué toca con esta persona ahora, y por qué no se puede si no se puede (habita.: blockReason). */
export function planFor(p: PlanInput, group: Group, now: Date): Plan {
  // A request to recontact is a pause, not permission to run the normal cadence.
  // Rules can be configured separately, but never send immediately on classification.
  if (p.situation === "recontactar_vacaciones" || p.situation === "recontactar_mas_adelante")
    return { pending: false, actionReason: "Recontacto pendiente de programación.", dueAt: null, blocked: null };
  if (CLOSED_SITUATIONS.includes(p.situation)) return { pending: false, actionReason: SITUATIONS[p.situation], dueAt: null, blocked: null };
  if (p.sentThisVersion) return { pending: false, actionReason: "Ya se mandó el mensaje de esta etapa: espera que avance o responda.", dueAt: null, blocked: null };
  if (TOUCH_STAGES.includes(p.stage) && p.touches >= 3 && group !== "respuestas")
    return { pending: false, actionReason: "Ya se le escribió tres veces: no se escribe más hasta que responda.", dueAt: null, blocked: null };
  // Entre el saludo y la demo va el Paso 2, solo a quien respondió el saludo. El link (Paso 3 o Seguimiento 1) sale desde
  // «Audios y mensajes»: depende de si respondió el Paso 2, y eso lo dice la lectura de WhatsApp.
  if (p.stage === "saludo-sin-demo" && p.permission)
    return { pending: false, actionReason: "Ya salió el Paso 2: la demo va desde «Audios y mensajes» (Paso 3 si responde; si no, el Seguimiento 1 a las 24 h).", dueAt: null, blocked: null };
  if (p.stage === "saludo-sin-demo" && group !== "respuestas")
    return { pending: false, actionReason: "Esperando que responda el saludo: el Paso 2 va cuando contesta.", dueAt: null, blocked: null };
  const out = (blocked: string | null, dueAt: string | null = null): Plan => ({ pending: true, actionReason: null, dueAt, blocked });
  if (p.snoozedUntil && Date.parse(p.snoozedUntil) > now.getTime()) return out(`Reprogramada hasta el ${new Date(p.snoozedUntil).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.`);
  if (!p.hasVersion) return out("Falta el texto de esta etapa: creá una versión en Follow-up.");
  if (!p.whatsapp) return out("Sin WhatsApp: es un fijo o no tiene celular.");
  if (p.stage === "sin-saludo" && !p.contactable) return out("Posible duplicado: ese número ya recibió un mensaje.");
  // Programada: los primeros pasos siguen la cadencia de Prospección; los siguientes, 48 h desde el último mensaje.
  if (group !== "respuestas") {
    if (TOUCH_STAGES.includes(p.stage) && p.stage !== "sin-saludo" && p.nextActionOn && p.nextActionOn > artToday(now))
      return out(null, `${p.nextActionOn}T12:00:00.000Z`);
    if (!TOUCH_STAGES.includes(p.stage) && p.lastContactAt && Date.parse(p.lastContactAt) + AFTER_HOURS * 3600_000 > now.getTime())
      return out(null, new Date(Date.parse(p.lastContactAt) + AFTER_HOURS * 3600_000).toISOString());
  }
  if (p.stage === "sin-saludo" && p.newToday >= p.dailyCap) return out(`Tope de ${p.dailyCap} contactos nuevos por día: ya se saludó a ${p.newToday} hoy.`);
  const hours = outsideHours(group, now);
  if (hours) return out(hours);
  return out(null);
}

export type Ordered = { priority: Priority; group: Group; rank: number; since: string; ads?: boolean };
const P: Record<Priority, number> = { alta: 0, media: 1, baja: 2 };
/** La cola: prioridad, grupo, prioridad de la lista (1 a 3), los que pagan anuncios y los que esperan hace más. */
export const byPriority = (a: Ordered, b: Ordered) =>
  P[a.priority] - P[b.priority] || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.rank - b.rank || Number(Boolean(b.ads)) - Number(Boolean(a.ads)) || a.since.localeCompare(b.since);

export const DAYS = DAY_MS;
