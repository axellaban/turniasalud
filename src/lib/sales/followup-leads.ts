// «Leads» de Follow-up para Chapa Labs, igual que la de habita. (amoblaia src/lib/followup/leads.ts),
// adaptada a Turnia: una regla por etapa, sus etapas y sus estados. Dónde está cada consultorio hoy,
// en qué estado de la cola, por qué no sale y qué reglas activas dejaron de ejecutarse. No decide
// nada: lee la cola que ya arma followup-queue.ts. Puro: lo usan el servidor y los tests.
import { queueDayState, type QueueDayRow } from "./followup-results";

export type LeadState = "lista" | "tomada" | "programada" | "reprogramada" | "equipo" | "respuesta" | "bloqueada" | "hecha" | "sin_accion";

export type LeadInput = {
  id: string;
  name: string;
  stage: string;
  situation: string;
  action: string | null;
  actionReason: string | null;
  blocked: string | null;
  dueAt: string | null;
  snoozedUntil: string | null;
  claim: { by: string; until: string } | null;
  execution: { status: string; at: string } | null;
};
export type LeadExecution = { outreach_id: string; stage: string; status: string; sent_at?: string | null };
export type LeadRule = { key: string; stage: string; name: string; enabled: boolean };
export type LeadStage = { key: string; title: string; goal: string };

export type LeadRow = {
  /** El id del consultorio (el mismo nombre de campo que habita., para Chapa). */
  agencyId: string;
  name: string;
  stage: string;
  situation: string;
  state: LeadState;
  reason: string;
  who: string | null;
  days: number;
  next: string | null;
  ruleKey: string;
  lastRule: { label: string; stage: string; at: string } | null;
};
export type RuleHealth = LeadRule & { lastSentAt: string | null; sent21: number; states: Partial<Record<LeadState, number>>; pending: number };
export type LeadAlert =
  | { kind: "regla"; ruleKey: string; name: string; stage: string; days: number | null; pending: number; states: Partial<Record<LeadState, number>> }
  | { kind: "listas"; stage: string; count: number; oldest: number };

const DAY = 86_400_000;
const artDay = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
const TEAM = /^(Asignada a Facu|Pasada a (Facu|Axel))/;
/** Una regla activa con consultorios esperándola que no sale hace más de esto se avisa (igual que habita.). */
export const STALE_DAYS = 3;
/** Una tarea lista que nadie mandó durante estos días seguidos se avisa. */
export const READY_DAYS = 2;

export function leadStateOf(q: LeadInput, now = new Date()): { state: LeadState; reason: string; who: string | null } {
  if (!q.action) return { state: "sin_accion", reason: q.actionReason ?? "Ninguna regla le corresponde ahora.", who: null };
  if (q.execution?.status === "sent") return { state: "hecha", reason: `Ya salió «${q.action}»: espera que avance o que conteste.`, who: null };
  const b = q.blocked;
  if (b && TEAM.test(b)) return { state: "equipo", reason: b, who: /Axel/.test(b) ? "Axel" : "Facu" };
  if (b?.startsWith("Tiene una respuesta sin clasificar")) return { state: "respuesta", reason: b, who: null };
  if (q.claim && Date.parse(q.claim.until) > now.getTime()) return { state: "tomada", reason: `La está ejecutando ${q.claim.by}.`, who: q.claim.by };
  if (q.snoozedUntil && Date.parse(q.snoozedUntil) > now.getTime()) return { state: "reprogramada", reason: b ?? "Reprogramada.", who: null };
  if (!b) return { state: "lista", reason: "Puede salir ahora.", who: null };
  const day = queueDayState({ dueAt: q.dueAt, snoozedUntil: q.snoozedUntil, blocked: b }, now);
  if (day === "programada" || q.dueAt) return { state: "programada", reason: b, who: null };
  if (day === "lista") return { state: "lista", reason: b, who: null };
  return { state: "bloqueada", reason: b, who: null };
}

const dayStateOf = (s: LeadState): QueueDayRow["state"] | null =>
  s === "lista" || s === "tomada" ? "lista" : s === "programada" || s === "reprogramada" ? "programada" : s === "hecha" || s === "sin_accion" ? null : "bloqueada";

function daysIn(history: Map<string, QueueDayRow[]>, id: string, stage: string, state: LeadState, today: string) {
  const want = dayStateOf(state);
  const rows = history.get(id);
  if (!want || !rows?.length) return 1;
  const byDay = new Map(rows.filter((r) => r.stage === stage).map((r) => [r.day, r.state]));
  let n = 0;
  let cursor = Date.parse(`${today}T12:00:00Z`);
  for (let first = true; n <= 120; first = false) {
    const seen = byDay.get(new Date(cursor).toISOString().slice(0, 10));
    if (seen === want || (first && seen === undefined)) n++;
    else break;
    cursor -= DAY;
  }
  return Math.max(1, n);
}

export function leadsView(input: { items: LeadInput[]; executions: LeadExecution[]; rules: LeadRule[]; queueDays: QueueDayRow[] | null; stages: LeadStage[]; now?: Date }) {
  const now = input.now ?? new Date();
  const today = artDay(now.getTime());
  const history = new Map<string, QueueDayRow[]>();
  for (const r of input.queueDays ?? []) history.set(r.outreach_id, [...(history.get(r.outreach_id) ?? []), r]);
  const sent = input.executions.filter((e) => e.status === "sent" && e.sent_at);
  const lastOf = new Map<string, LeadExecution>();
  for (const e of sent) {
    const prev = lastOf.get(e.outreach_id);
    if (!prev || Date.parse(e.sent_at!) > Date.parse(prev.sent_at!)) lastOf.set(e.outreach_id, e);
  }
  const ruleOf = new Map(input.rules.map((r) => [r.stage, r]));
  const rows: LeadRow[] = input.items.map((q) => {
    const { state, reason, who } = leadStateOf(q, now);
    const last = lastOf.get(q.id);
    return {
      agencyId: q.id, name: q.name, stage: q.stage, situation: q.situation, state, reason, who,
      days: daysIn(history, q.id, q.stage, state, today),
      next: q.action, ruleKey: q.stage,
      lastRule: last ? { label: ruleOf.get(last.stage)?.name ?? last.stage, stage: last.stage, at: new Date(last.sent_at!).toISOString() } : null,
    };
  });
  const count = (list: LeadRow[]) => list.reduce<Partial<Record<LeadState, number>>>((o, r) => ((o[r.state] = (o[r.state] ?? 0) + 1), o), {});
  const active = (r: LeadRow) => r.state !== "hecha" && r.state !== "sin_accion";
  const rules: RuleHealth[] = input.rules.map((rule) => {
    const own = sent.filter((e) => e.stage === rule.stage);
    const lastSentAt = own.reduce<string | null>((m, e) => (!m || Date.parse(e.sent_at!) > Date.parse(m) ? new Date(e.sent_at!).toISOString() : m), null);
    const mine = rows.filter((r) => r.ruleKey === rule.key && active(r));
    return { ...rule, lastSentAt, sent21: own.filter((e) => now.getTime() - Date.parse(e.sent_at!) <= 21 * DAY).length, states: count(mine), pending: mine.length };
  });
  const stages = input.stages.map((s) => {
    const own = rows.filter((r) => r.stage === s.key);
    return { ...s, count: own.length, states: count(own), rules: rules.filter((r) => r.stage === s.key) };
  });
  const alerts: LeadAlert[] = [];
  for (const r of rules) {
    if (!r.enabled || !r.pending) continue;
    const days = r.lastSentAt ? Math.round((Date.parse(today) - Date.parse(artDay(Date.parse(r.lastSentAt)))) / DAY) : null;
    if (days === null || days > STALE_DAYS) alerts.push({ kind: "regla", ruleKey: r.key, name: r.name, stage: r.stage, days, pending: r.pending, states: r.states });
  }
  for (const s of input.stages) {
    const ready = rows.filter((r) => r.stage === s.key && r.state === "lista" && r.days >= READY_DAYS);
    if (ready.length) alerts.push({ kind: "listas", stage: s.key, count: ready.length, oldest: Math.max(...ready.map((r) => r.days)) });
  }
  alerts.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "regla" ? -1 : 1) || (a.kind === "regla" && b.kind === "regla" ? (b.days ?? 999) - (a.days ?? 999) : 0));
  return { stages, rows, alerts, staleDays: STALE_DAYS };
}
