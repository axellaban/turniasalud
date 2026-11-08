// Follow-up: una next best action por etapa del embudo comercial (EMBUDO.md), con versiones
// medidas. Puro: lo comparten el servidor, el navegador y los tests. Traído de habita.
// (amoblaia: src/lib/followup/stages.ts), adaptado a las etapas y los datos de Turnia.

/**
 * Cada etapa son los que llegaron a un paso del embudo y no al siguiente. El paso: -1 sin saludar,
 * 0 saludado, 1 demo enviada, 2 la abrió, 3 conversó con Sofi, 4 cuenta creada, 5 cuenta activa,
 * 6 cliente pago (el último no tiene etapa: ya pagó).
 */
export const FOLLOWUP_STAGES = [
  { key: "sin-saludo", step: -1, title: "Sin saludar", goal: "Saludo enviado" },
  { key: "saludo-sin-demo", step: 0, title: "Saludado, sin demo", goal: "Demo enviada" },
  { key: "demo-sin-abrir", step: 1, title: "Demo enviada, sin abrir", goal: "Demo visitada" },
  { key: "abrio-sin-conversar", step: 2, title: "Abrió la demo, sin conversar con Sofi", goal: "Conversó con Sofi" },
  { key: "converso-sin-cuenta", step: 3, title: "Conversó con Sofi, sin cuenta", goal: "Cuenta creada" },
  { key: "cuenta-sin-actividad", step: 4, title: "Cuenta creada, sin actividad", goal: "Cuenta activa" },
  { key: "activa-sin-pago", step: 5, title: "Cuenta activa, sin pago", goal: "Cliente pago" },
] as const;
export type StageKey = (typeof FOLLOWUP_STAGES)[number]["key"];
export const STAGE_KEYS = FOLLOWUP_STAGES.map((s) => s.key) as StageKey[];
export const isStageKey = (v: unknown): v is StageKey => typeof v === "string" && (STAGE_KEYS as string[]).includes(v);
export const stageInfo = (key: StageKey) => FOLLOWUP_STAGES.find((s) => s.key === key)!;
/** Las etapas en que el mensaje es un contacto de la secuencia de Prospección (saludo, demo, seguimiento). */
export const TOUCH_STAGES: readonly StageKey[] = ["sin-saludo", "saludo-sin-demo", "demo-sin-abrir"];

export type Channel = "whatsapp" | "tarea";
export const CTA_KEYS = ["whatsapp", "demo", "panel", "copy"] as const;
export type Cta = (typeof CTA_KEYS)[number];
export const CTA_LABEL: Record<Cta, string> = { whatsapp: "Abrir WhatsApp", demo: "Link demo", panel: "Link panel", copy: "Copiar mensaje" };
/** Las variables de los mensajes de Prospección, más {panel}. */
export const VARIABLES = [
  ["{saludo}", "nombre de pila"],
  ["{nombre}", "nombre completo"],
  ["{destinatario}", "«la Dra. Pérez» o el nombre completo"],
  ["{consultorio}", "nombre del consultorio en la demo"],
  ["{link}", "su demo /p/<código>"],
  ["{panel}", "el ingreso al panel"],
  ["{zona}", "ciudad"],
] as const;

export type VersionStatus = "active" | "test" | "archived";
export type FollowupVersion = {
  id: string;
  stage: StageKey;
  version: number;
  channel: Channel;
  trigger_label: string;
  body: string;
  ctas: Cta[];
  status: VersionStatus;
  created_at: string;
  status_at: string;
};
export type ExecutionStatus = "opened" | "sent" | "failed";
export type FollowupExecution = {
  id: string;
  version_id: string;
  stage: StageKey;
  outreach_id: string;
  from_step: number;
  status: ExecutionStatus;
  reason: string | null;
  updated_at: string;
  /** Quién la ejecutó (desde Chapa Labs: Facu, Axel); null desde el panel. */
  actor?: string | null;
  sent_at?: string | null;
};

/** Lo que se sabe de cada persona para ubicarla en el embudo, con las definiciones de EMBUDO.md. */
export type FunnelFacts = {
  greeted: boolean;
  touches: number;
  opened: boolean;
  converso: boolean;
  account: boolean;
  active: boolean;
  client: boolean;
};

/** El paso más alto al que llegó (no se exige haber pasado por el anterior, como en EMBUDO.md). */
export function stepOf(f: FunnelFacts): number {
  if (f.client) return 6;
  if (f.active) return 5;
  if (f.account) return 4;
  if (f.converso) return 3;
  if (f.opened) return 2;
  if (f.touches >= 1) return 1;
  if (f.greeted) return 0;
  return -1;
}

/**
 * Su etapa de Follow-up, o null: los cerrados (no le interesa, sin WhatsApp, baja), los que tienen
 * la baja, los fijos sin respuesta (no cuentan en el embudo) y los clientes no tienen. Sin saludar
 * solo entra quien se puede saludar (`contactable`: celular, sin baja y sin que otro del mismo número
 * ya haya recibido el mensaje), como en «Para hoy».
 */
export function stageOf(f: FunnelFacts & { closed: boolean; suppressed: boolean; landline: boolean; contactable: boolean }): StageKey | null {
  if (f.closed || f.suppressed || f.landline) return null;
  const step = stepOf(f);
  if (step === -1 && !f.contactable) return null;
  return FOLLOWUP_STAGES.find((s) => s.step === step)?.key ?? null;
}

/** FNV-1a: el reparto A/B es estable para cada persona. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * La versión que le toca: la que ya empezó (abierta, enviada o no salió) mientras siga vigente;
 * si no, la activa o, con una prueba en curso, la mitad recibe la de prueba.
 */
export function versionFor(outreachId: string, versions: FollowupVersion[], previous: FollowupExecution[] = []) {
  const live = versions.filter((v) => v.status !== "archived");
  const active = live.find((v) => v.status === "active") ?? null;
  const test = live.find((v) => v.status === "test") ?? null;
  const started = [...previous].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).find((e) => live.some((v) => v.id === e.version_id));
  if (started) return live.find((v) => v.id === started.version_id)!;
  if (test && active) return hash(`${outreachId}:${active.stage}`) % 2 ? test : active;
  return active ?? test;
}

/**
 * Los números de cada versión. Ejecuciones: envíos confirmados, una vez por persona. Conversiones:
 * de esos, quienes hoy están en un paso más alto que al recibirla. Con menos de `small` ejecuciones
 * la muestra es chica.
 */
export function versionStats(versions: FollowupVersion[], executions: FollowupExecution[], stepNow: Map<string, number>, small = 30) {
  return versions.map((v) => {
    const sent = executions.filter((e) => e.version_id === v.id && e.status === "sent");
    const conversions = sent.filter((e) => (stepNow.get(e.outreach_id) ?? -1) > e.from_step).length;
    return {
      id: v.id,
      executions: sent.length,
      conversions,
      rate: sent.length ? conversions / sent.length : null,
      smallSample: sent.length > 0 && sent.length < small,
    };
  });
}
export type VersionStats = ReturnType<typeof versionStats>[number];

/** «12 %», «4,5 %» debajo del 10 %, «—» sin ejecuciones. */
export const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(r < 0.1 && r > 0 ? 1 : 0).replace(".", ",")} %`);

const KNOWN = new Set<string>(VARIABLES.map(([v]) => v));

/** Valida una versión nueva del panel: los campos limpios o el error. */
export function cleanVersion(input: { stage?: unknown; channel?: unknown; trigger?: unknown; body?: unknown; ctas?: unknown; status?: unknown }) {
  if (!isStageKey(input.stage)) return { error: "Etapa desconocida." } as const;
  const channel: Channel | null = input.channel === "tarea" ? "tarea" : input.channel === "whatsapp" ? "whatsapp" : null;
  if (!channel) return { error: "El canal es WhatsApp o tarea." } as const;
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { error: "Escribí la next best action." } as const;
  if (body.length > 1500) return { error: "El mensaje tiene que tener menos de 1500 caracteres." } as const;
  const unknown = [...body.matchAll(/\{[a-z]+\}/g)].map((m) => m[0]).find((v) => !KNOWN.has(v));
  if (unknown) return { error: `Variable desconocida: ${unknown}. Se pueden usar ${[...KNOWN].join(", ")}.` } as const;
  const trigger = typeof input.trigger === "string" ? input.trigger.trim().slice(0, 120) : "";
  const ctas = Array.isArray(input.ctas) ? CTA_KEYS.filter((k) => (input.ctas as unknown[]).includes(k)) : [];
  const status: "active" | "test" = input.status === "test" ? "test" : "active";
  return { stage: input.stage, channel, trigger, body, ctas, status } as const;
}
