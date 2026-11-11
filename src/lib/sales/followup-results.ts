// Resultados de Follow-up de Turnia, como los de habita. (amoblaia src/lib/followup/results.ts):
// la ejecución de la cola día por día y la tendencia de cada acción. Puro: lo comparten el servidor
// y los tests. Conversión con la definición de Turnia: la persona pasó del paso en que estaba al
// recibir el mensaje (stepNow > from_step); Turnia no guarda cuándo, así que no hay ventana.

export type QueueDayRow = { day: string; outreach_id: string; stage: string; state: "lista" | "bloqueada" | "programada" };
export type DayExecution = {
  outreach_id: string;
  stage: string;
  from_step: number;
  status: "opened" | "sent" | "failed";
  sent_at?: string | null;
  updated_at: string;
  executed_by?: "humano" | "bot" | null;
};
export type DayTypeCount = {
  type: string;
  stages: string[];
  pending: number;
  human: number;
  bot: number;
  successHuman: number;
  successBot: number;
  blocked: number;
  unclaimed: number;
  failed: number;
  scheduled: number;
};
/** La misma cuenta por etapa técnica de la cola: para cruzar la ejecución de cada etapa con el paso del embudo al que lleva. */
export type DayStageCount = { stage: string; pending: number; executed: number; success: number };
export type ExecutionDay = { day: string; captured: boolean; types: DayTypeCount[]; stages: DayStageCount[] };

const DAY = 86_400_000;
/** YYYY-MM-DD en Buenos Aires (UTC-3 todo el año). */
export const artDay = (t: number | string | Date) => new Date(new Date(t).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
export function lastDays(n: number, now = new Date()) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(artDay(now.getTime() - i * DAY));
  return out;
}
const converted = (e: DayExecution, stepNow: Map<string, number>) => (stepNow.get(e.outreach_id) ?? -1) > e.from_step;

/** Qué estuvo pendiente cada día (la foto más lo ejecutado ese día), cuánto se ejecutó, quién y cuánto convirtió, por tipo de acción. */
export function executionDays(rows: QueueDayRow[], executions: DayExecution[], stepNow: Map<string, number>, label: (stage: string) => string, n = 35, now = new Date()): ExecutionDay[] {
  const days = lastDays(n, now);
  const inRange = new Set(days);
  type Cell = { stage: string; state?: QueueDayRow["state"]; sent?: DayExecution; failed?: boolean };
  const byDay = new Map<string, Map<string, Cell>>();
  const cell = (day: string, id: string, stage: string) => {
    if (!byDay.has(day)) byDay.set(day, new Map());
    const m = byDay.get(day)!;
    const k = `${id}:${stage}`;
    if (!m.has(k)) m.set(k, { stage });
    return m.get(k)!;
  };
  const captured = new Set<string>();
  for (const r of rows) {
    if (!inRange.has(r.day)) continue;
    captured.add(r.day);
    cell(r.day, r.outreach_id, r.stage).state = r.state;
  }
  for (const e of executions) {
    if (e.status === "sent" && e.sent_at) {
      const d = artDay(e.sent_at);
      if (inRange.has(d)) cell(d, e.outreach_id, e.stage).sent = e;
    } else if (e.status === "failed") {
      const d = artDay(e.updated_at);
      if (inRange.has(d)) cell(d, e.outreach_id, e.stage).failed = true;
    }
  }
  return days.map((day) => {
    const types = new Map<string, DayTypeCount>();
    const stages = new Map<string, DayStageCount>();
    for (const c of byDay.get(day)?.values() ?? []) {
      const type = label(c.stage);
      if (!types.has(type)) types.set(type, { type, stages: [], pending: 0, human: 0, bot: 0, successHuman: 0, successBot: 0, blocked: 0, unclaimed: 0, failed: 0, scheduled: 0 });
      const t = types.get(type)!;
      if (!t.stages.includes(c.stage)) t.stages.push(c.stage);
      if (!c.sent && !c.failed && c.state === "programada") { t.scheduled++; continue; }
      t.pending++;
      if (!stages.has(c.stage)) stages.set(c.stage, { stage: c.stage, pending: 0, executed: 0, success: 0 });
      const st = stages.get(c.stage)!;
      st.pending++;
      if (c.sent) st.executed++;
      if (c.sent) {
        const bot = c.sent.executed_by === "bot";
        if (bot) t.bot++; else t.human++;
        if (converted(c.sent, stepNow)) { st.success++; if (bot) t.successBot++; else t.successHuman++; }
      } else if (c.failed) t.failed++;
      else if (c.state === "bloqueada") t.blocked++;
      else t.unclaimed++;
    }
    return { day, captured: captured.has(day), types: [...types.values()].sort((a, b) => b.pending - a.pending || a.type.localeCompare(b.type)), stages: [...stages.values()] };
  });
}

/** Viernes de cierre de la semana (sábado a viernes) de un instante, en Buenos Aires: las mismas semanas que habita. */
export function weekOf(iso: string) {
  const t = new Date(Date.parse(iso) - 3 * 3_600_000);
  t.setUTCDate(t.getUTCDate() + ((5 - t.getUTCDay() + 7) % 7));
  return t.toISOString().slice(0, 10);
}
export function lastWeeks(n: number, now = new Date()) {
  const start = Date.parse(`${weekOf(now.toISOString())}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(start - (n - 1 - i) * 7 * DAY).toISOString().slice(0, 10));
}

/** Ejecutadas y conversiones por semana de envío, para cada tipo de acción. */
export function weeklyByType(executions: DayExecution[], stepNow: Map<string, number>, label: (stage: string) => string, weeks = 8, now = new Date()) {
  const sent = executions.filter((e) => e.status === "sent" && e.sent_at);
  const out: Record<string, { week: string; executed: number; conversions: number }[]> = {};
  for (const t of new Set(sent.map((e) => label(e.stage)))) {
    const own = sent.filter((e) => label(e.stage) === t);
    out[t] = lastWeeks(weeks, now).map((w) => ({
      week: w,
      executed: own.filter((e) => weekOf(e.sent_at!) === w).length,
      conversions: own.filter((e) => weekOf(e.sent_at!) === w && converted(e, stepNow)).length,
    }));
  }
  return out;
}

// ── Cohortes con el embudo de Follow-up ────────────────────────────────────
// Como en habita.: cada cohorte (semana del saludo o versión del saludo) contada con las etapas
// comerciales de Follow-up desde Saludado, con el paso del embudo de hoy (placeOf).

export type CohortPerson = { firstContact: string | null; step: number; greetingVersion: number | null };
export type FunnelCohortRow = { cohort: string; size: number; reached: number[] };

/** `thresholds[i]`: el primer paso del embudo de la etapa i (quien está en ese paso o más adelante llegó). */
export function funnelCohorts(people: CohortPerson[], thresholds: readonly number[], by: "contacto" | "version", weeks = 8, now = new Date()): FunnelCohortRow[] {
  const count = (own: CohortPerson[]) => thresholds.map((t) => own.filter((p) => p.step >= t).length);
  if (by === "version") {
    const keys = [...new Set(people.filter((p) => p.firstContact).map((p) => p.greetingVersion))].sort((a, b) => (a ?? 0) - (b ?? 0));
    return keys.map((k) => {
      const own = people.filter((p) => p.firstContact && p.greetingVersion === k);
      return { cohort: k === null ? "Antes de Follow-up" : `Saludo V${k}`, size: own.length, reached: count(own) };
    });
  }
  return lastWeeks(weeks, now).map((w) => {
    const own = people.filter((p) => p.firstContact && weekOf(p.firstContact) === w);
    return { cohort: w, size: own.length, reached: count(own) };
  });
}

// ── Qué le corresponde a hoy ────────────────────────────────────────────────
// Igual que habita.: pendiente de hoy es lo que la cola le asigna a hoy. No cuenta («programada»): lo que
// excede el tope diario de saludos, lo programado o reprogramado para otro día, lo que espera que la
// persona conteste y lo de un día no hábil. Lo trabado por un dato a corregir sí cuenta («bloqueada»).

export type QueueDayInput = { dueAt?: string | null; snoozedUntil?: string | null; blocked?: string | null };
const NOT_TODAY = [/^Sin cupo para primer contacto/i, /^Tope de \d+ contactos nuevos/i, /esper(á|ando) que (conteste|responda)/i, /los domingos no se escribe/i, /^D[ií]a no habilitado/i];
export function queueDayState(q: QueueDayInput, now = new Date()): QueueDayRow["state"] {
  const endOfToday = Date.parse(`${artDay(now)}T00:00:00-03:00`) + DAY;
  if (q.dueAt && Date.parse(q.dueAt) >= endOfToday) return "programada";
  if (q.snoozedUntil && Date.parse(q.snoozedUntil) >= endOfToday) return "programada";
  const b = q.blocked;
  if (!b) return "lista";
  if (NOT_TODAY.some((r) => r.test(b))) return "programada";
  if (/^(Programada para|Reprogramada|Fuera de horario|Fuera de la ventana)/i.test(b)) return new Date(now.getTime() - 3 * 3_600_000).getUTCDay() === 0 ? "programada" : "lista";
  return "bloqueada";
}

/** El tope diario de saludos: de los primeros contactos listos, solo los que entran en el cupo que queda hoy. */
export function capFirstContacts<T extends { stage: string }>(rows: Array<T & { state: QueueDayRow["state"] }>, firstStage: string, remaining: number) {
  let left = Math.max(0, remaining);
  // Un prospecto trabado por un dato (sin WhatsApp, posible duplicado) nunca se asigna a hoy: tampoco cuenta.
  return rows.map((r) => (r.stage !== firstStage ? r : r.state === "lista" ? (left-- > 0 ? r : { ...r, state: "programada" as const }) : r.state === "bloqueada" ? { ...r, state: "programada" as const } : r));
}
