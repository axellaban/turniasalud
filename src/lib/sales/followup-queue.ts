import "server-only";
import { sql } from "@/lib/db";
import { DEFAULT_TZ } from "@/lib/time";
import { displayOutreachPhone, type OutreachStatus } from "./outreach-messages";
import { OutreachError, addOutreachNote, outreachDemoUrl, outreachSettings, setOutreachStatus, todayKey } from "./outreach";
import {
  FollowupError,
  createFollowupVersion,
  executions,
  markFollowup,
  placeOf,
  prepareFollowup,
  rows,
  setFollowupVersionStatus,
  versions,
  type Row,
} from "./followup";
import { capFirstContacts, executionDays, funnelCohorts, queueDayState, weeklyByType, type QueueDayRow } from "./followup-results";
import { FOLLOWUP_STAGES, isStageKey, stageInfo, versionFor, versionStats, type FollowupExecution, type StageKey } from "./followup-stages";
import { TURNIA_COMMERCIAL, commercialCatalog, createCommercialStage, saveCommercialSituation, deleteCommercialSituation, toggleCommercialSituation, ruleControls, saveRuleControl, type RuleControl } from "./followup-catalog";
import {
  CLAIM_SECONDS,
  CLOSED_SITUATIONS,
  GROUP_LABEL,
  SITUATIONS,
  actionLabel,
  byPriority,
  currentSituation,
  defaultPriority,
  derivedSituation,
  groupOf,
  isPriority,
  isSituation,
  planFor,
  type Group,
  type Priority,
  type Situation,
} from "./followup-plan";

// La cola de Follow-up de Turnia, como la de habita. (amoblaia src/lib/followup/server.ts): una sola
// lista con lo que se puede ejecutar ahora, lo programado y lo bloqueado con su motivo; las tomas
// de 10 minutos para que Facu y Axel no le escriban a la misma persona; situación, reprogramación,
// prioridad y responsable; y los resultados por versión y por quien ejecutó. Se opera desde Chapa
// Labs por /api/prospeccion. Las etapas, las versiones y el registro del envío son los del Follow-up
// de Turnia (followup.ts), así los números coinciden con Panel → Follow-up.

/** Otra sesión la tiene tomada, o la acción cambió: 409. */
export class FollowupConflict extends FollowupError {}

type State = {
  outreach_id: string;
  situation: string | null;
  situation_step: number | null;
  situation_note: string | null;
  priority: string | null;
  snooze_until: string | null;
  snooze_reason: string | null;
  owner: string | null;
};
type Claim = { outreach_id: string; actor: string; stage: string; locked_until: string };

export type QueueItem = {
  id: string;
  code: string;
  name: string;
  business: string;
  zone: string;
  phone: string | null;
  whatsapp: boolean;
  demoUrl: string;
  stage: StageKey;
  stageTitle: string;
  step: number;
  situation: Situation;
  situationLabel: string;
  situationManual: boolean;
  situationNote: string | null;
  action: string | null;
  actionReason: string | null;
  group: Group;
  groupLabel: string;
  priority: Priority;
  priorityManual: boolean;
  /** La prioridad de la lista de Prospección (1 a 3). */
  rank: number;
  ads: boolean;
  owner: string | null;
  touches: number;
  opened: boolean;
  lastContactAt: string | null;
  since: string;
  snoozedUntil: string | null;
  dueAt: string | null;
  blocked: string | null;
  claim: { by: string; until: string } | null;
  versionId: string | null;
  version: number | null;
  execution: { status: string; at: string; reason: string | null; by: string | null } | null;
};

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
const UUID = /^[0-9a-f-]{36}$/i;

async function board(now = new Date()) {
  const [people, vs, ex, states, claims, settings, [{ n: newToday }], controls] = await Promise.all([
    rows(),
    versions(),
    executions(),
    sql<State[]>`select outreach_id, situation, situation_step, situation_note, priority, snooze_until, snooze_reason, owner from sales_followup_state`,
    sql<Claim[]>`select outreach_id, actor, stage, locked_until from sales_followup_claims where locked_until > ${now}`,
    outreachSettings(),
    sql<Array<{ n: number }>>`select count(*)::int as n from sales_outreach where greeted_at is not null and (greeted_at at time zone ${DEFAULT_TZ})::date = ${todayKey()}::date`,
    ruleControls(),
  ]);
  const controlOf = new Map(controls.map((rule) => [rule.stage, rule]));
  const stateOf = new Map(states.map((s) => [s.outreach_id, s]));
  const claimOf = new Map(claims.map((c) => [c.outreach_id, c]));
  const exOf = new Map<string, FollowupExecution[]>();
  for (const e of ex) exOf.set(e.outreach_id, [...(exOf.get(e.outreach_id) ?? []), e]);
  const stepNow = new Map<string, number>();
  const items = new Map<string, QueueItem>();
  const cap = Math.max(1, Number(settings.daily_goal) || 50);
  for (const r of people) {
    const { step, stage } = placeOf(r);
    stepNow.set(r.id, step);
    if (!stage) continue;
    items.set(r.id, itemOf(r, stage, step, { vs, mine: exOf.get(r.id) ?? [], state: stateOf.get(r.id), claim: claimOf.get(r.id), rule: controlOf.get(stage), newToday, cap }, now));
  }
  return { people, vs, ex, items, stepNow, newToday, cap, states, controls };
}

function itemOf(
  r: Row,
  stage: StageKey,
  step: number,
  ctx: { vs: Awaited<ReturnType<typeof versions>>; mine: FollowupExecution[]; state?: State; claim?: Claim; rule?: RuleControl; newToday: number; cap: number },
  now: Date,
): QueueItem {
  const whatsapp = Boolean(r.phone && r.phone_kind !== "fijo");
  const derived = derivedSituation({ status: r.status, touches: r.touches, suppressed: r.suppressed, whatsapp });
  const { situation, manual } = currentSituation(derived, ctx.state ? { situation: ctx.state.situation, step: ctx.state.situation_step } : null, step);
  const group = groupOf(stage, situation);
  const own = ctx.vs.filter((v) => v.stage === stage);
  const mineHere = ctx.mine.filter((e) => e.stage === stage);
  const v = versionFor(r.id, own, mineHere);
  const done = v ? mineHere.find((e) => e.version_id === v.id) : undefined;
  const plan = planFor(
    {
      stage,
      situation,
      touches: r.touches,
      whatsapp,
      contactable: r.contactable,
      permission: Boolean(r.permission_at),
      nextActionOn: r.next_action_on,
      lastContactAt: iso(r.last_contact_at),
      snoozedUntil: iso(ctx.state?.snooze_until),
      hasVersion: Boolean(v),
      sentThisVersion: done?.status === "sent",
      newToday: ctx.newToday,
      dailyCap: ctx.cap,
    },
    group,
    now,
  );
  // Cada configuración nueva solo puede restringir el plan original.
  // Jamás reabre bajas, adelanta el link, excede el límite de contactos o saltea los horarios.
  const policy = ctx.rule;
  let pending = plan.pending;
  let actionReason = plan.actionReason;
  let blocked = plan.blocked;
  let dueAt = plan.dueAt;
  if (pending && policy) {
    if (!policy.enabled || (policy.situations.length > 0 && !policy.situations.includes(situation))) {
      pending = false;
      actionReason = !policy.enabled ? "Regla pausada por el equipo." : "Esta situación no habilita una acción.";
    } else {
      const art = new Date(now.getTime() - 3 * 3600_000);
      const day = art.getUTCDay();
      const hour = art.getUTCHours() * 60 + art.getUTCMinutes();
      if (!policy.days.includes(day)) blocked ??= "Día no habilitado para esta regla.";
      if (hour < policy.hours_from * 60 || hour >= policy.hours_to * 60)
        blocked ??= "Fuera de la ventana restringida de la regla.";
      if (policy.after_hours > 0 && r.last_contact_at) {
        const restrictiveDue = new Date(Date.parse(String(r.last_contact_at)) + policy.after_hours * 3600_000).toISOString();
        if (!dueAt || restrictiveDue > dueAt) dueAt = restrictiveDue;
      }
    }
  }
  const manualPriority = isPriority(ctx.state?.priority) ? (ctx.state!.priority as Priority) : null;
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    business: r.business_name,
    zone: r.zone,
    phone: r.phone ? displayOutreachPhone(r.phone) : null,
    whatsapp,
    demoUrl: outreachDemoUrl(r.code),
    stage,
    stageTitle: stageInfo(stage).title,
    step,
    situation,
    situationLabel: SITUATIONS[situation],
    situationManual: manual,
    situationNote: manual ? ctx.state?.situation_note ?? null : null,
    action: pending ? actionLabel(stage) : null,
    actionReason,
    group,
    groupLabel: GROUP_LABEL[group],
    priority: manualPriority ?? defaultPriority(group),
    priorityManual: Boolean(manualPriority),
    rank: r.priority,
    ads: /google ads|meta ads|anuncios en (instagram|facebook)/i.test(r.signals || ""),
    owner: ctx.state?.owner ?? null,
    touches: r.touches,
    opened: Boolean(r.opened_at),
    lastContactAt: iso(r.last_contact_at),
    since: String(iso(r.last_contact_at) ?? iso(r.first_contact_at) ?? iso(r.created_at)),
    snoozedUntil: iso(ctx.state?.snooze_until) && Date.parse(String(ctx.state!.snooze_until)) > now.getTime() ? iso(ctx.state!.snooze_until) : null,
    dueAt,
    blocked,
    claim: ctx.claim ? { by: ctx.claim.actor, until: iso(ctx.claim.locked_until)! } : null,
    versionId: v?.id ?? null,
    version: v?.version ?? null,
    execution: done ? { status: done.status, at: String(iso(done.updated_at)), reason: done.reason, by: done.actor ?? null } : null,
  };
}

const ready = (q: QueueItem) => Boolean(q.action) && !q.blocked && !q.dueAt;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ── La foto diaria de la cola (supabase/schema.sql, sales_followup_queue_days) ──
// Lo pendiente de cada día, para «¿Se ejecutó la cola?» en los Resultados de Chapa. Se guarda al
// calcular la cola para Chapa (como mucho una vez cada 10 minutos por instancia). Nunca bloquea: si
// falta la tabla, Resultados avisa que todavía no hay foto.
const QUEUE_DAYS = 35;
/** El paso del embudo de un cliente pago: la etapa «Cliente», que no tiene cola. */
const CLIENT_STEP = 6;
let queueDayWrittenAt = 0;
async function recordQueueDay(all: QueueItem[], now: Date, cap: { cap: number; newToday: number }) {
  if (now.getTime() - queueDayWrittenAt < 10 * 60_000) return;
  queueDayWrittenAt = now.getTime();
  const day = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  // Solo lo que la cola le asigna a hoy (followup-results.ts → queueDayState), con el tope diario de saludos.
  const rows = capFirstContacts(
    all.filter((q) => q.action && q.execution?.status !== "sent").sort(byPriority).map((q) => ({
      day, outreach_id: q.id, stage: q.stage as string, state: queueDayState({ dueAt: q.dueAt, snoozedUntil: q.snoozedUntil, blocked: q.blocked }, now), last_seen_at: now,
    })),
    "sin-saludo",
    cap.cap - cap.newToday,
  );
  for (let i = 0; i < rows.length; i += 500)
    await sql`insert into sales_followup_queue_days ${sql(rows.slice(i, i + 500), "day", "outreach_id", "stage", "state", "last_seen_at")}
      on conflict (day, outreach_id, stage) do update set state = excluded.state, last_seen_at = excluded.last_seen_at`;
}
async function queueDays(now: Date): Promise<QueueDayRow[] | null> {
  try {
    const since = new Date(now.getTime() - 3 * 3_600_000 - (QUEUE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    return await sql<QueueDayRow[]>`select day::text as day, outreach_id, stage, state from sales_followup_queue_days where day >= ${since}::date`;
  } catch {
    return null;
  }
}

/** Lo que Chapa muestra: la cola, lo programado, lo bloqueado, las respuestas, el embudo y los resultados. */
export async function followupSnapshot(now = new Date()) {
  const b = await board(now);
  const all = [...b.items.values()];
  await recordQueueDay(all, now, { cap: b.cap, newToday: b.newToday }).catch(() => console.error("followup_queue_day_failed"));
  const [days, bots] = await Promise.all([
    queueDays(now),
    // Quién ejecutó: hasta que el esquema tenga executed_by (o si nunca hubo un bot), todo es humano.
    sql<Array<{ id: string }>>`select id from sales_followup_executions where executed_by = 'bot'`.catch(() => []),
  ]);
  const botIds = new Set(bots.map((x) => x.id));
  const dayExecutions = b.ex.map((e) => ({ ...e, sent_at: iso(e.sent_at), updated_at: String(iso(e.updated_at)), executed_by: botIds.has(e.id) ? ("bot" as const) : ("humano" as const) }));
  const label = (stage: string) => (isStageKey(stage) ? actionLabel(stage) : stage);
  const catalog = await commercialCatalog();
  const stageFor = (technical: string) => TURNIA_COMMERCIAL.find(s => (s.technical as readonly string[]).includes(technical))?.key ?? "";
  const customFor = (q: QueueItem) => catalog.states.filter(s => s.active && s.source === "product" && s.product_stage === q.stage && s.commercial_stage === stageFor(q.stage)).map(s => s.key);
  const decorate = (q: QueueItem) => ({
    ...q,
    productSituations: customFor(q),
    catalogSituation: catalog.states.find(s => s.active && s.source !== "product" && s.maps_to === q.situation && s.commercial_stage === stageFor(q.stage))?.key ?? null,
  });
  const live = now.toISOString();
  const queue = all.filter(ready).sort(byPriority);
  const counted = b.people.filter((r) => placeOf(r).stage || placeOf(r).step >= 0);
  const reach = (step: number) => counted.filter((r) => (b.stepNow.get(r.id) ?? -1) >= step).length;
  const funnel = FOLLOWUP_STAGES.map((s) => {
    const here = reach(s.step);
    return { key: s.key, title: s.title, goal: s.goal, waiting: all.filter((q) => q.stage === s.key).length, reached: here, rate: here ? reach(s.step + 1) / here : null };
  });
  const hours = (from: unknown, to: unknown) => (from && to ? (Date.parse(String(to)) - Date.parse(String(from))) / 3600_000 : null);
  const gaps = (pairs: Array<number | null>) => median(pairs.filter((x): x is number => x !== null && x >= 0));
  const timing = [
    { from: "Saludo", to: "Demo enviada", medianHours: gaps(b.people.map((r) => hours(r.greeted_at, r.first_contact_at))) },
    { from: "Demo enviada", to: "Demo visitada", medianHours: gaps(b.people.map((r) => hours(r.first_contact_at, r.opened_at))) },
    // De punta a punta, igual en las dos versiones de la demo (src/lib/demo-version.ts): «Probó la demo»
    // ya no es un paso propio desde que tocar la esfera empieza la charla.
    { from: "Demo visitada", to: "Habló con Sofi", medianHours: gaps(b.people.map((r) => hours(r.opened_at, r.converso_at))) },
  ];
  const controlByStage = new Map(b.controls.map(c => [c.stage, c]));
  const sent = b.ex.filter((e) => e.status === "sent");
  const byActor = new Map<string, { executions: number; conversions: number }>();
  for (const e of sent) {
    const k = e.actor || "Panel de Turnia";
    const cur = byActor.get(k) ?? { executions: 0, conversions: 0 };
    cur.executions++;
    if ((b.stepNow.get(e.outreach_id) ?? -1) > e.from_step) cur.conversions++;
    byActor.set(k, cur);
  }
  // Mostrar en Chapa el texto literal de la respuesta entrante, como en la bandeja de Habita.
  // La auditoría es la fuente de verdad y la lectura no crea ni modifica mensajes.
  const latestReplyRows = await sql<Array<{ outreach_id: string; new_value: string | null; created_at: string }>>`
    select distinct on (outreach_id) outreach_id, new_value, created_at
      from sales_followup_audit
     where subject = 'reply'
     order by outreach_id, created_at desc
     limit 5000
  `.catch(() => []);
  const latestReply = new Map(latestReplyRows.map((row) => [row.outreach_id, row]));
  const changes = await sql<Array<{ outreach_id: string | null; subject: string; new_value: string | null; actor: string | null; created_at: string }>>`
    select outreach_id, subject, new_value, actor, created_at from sales_followup_audit order by created_at desc limit 20`;
  return {
    labels: { situations: SITUATIONS, groups: GROUP_LABEL },
    catalog: { ...catalog, stages: catalog.stages.map(s => ({
      ...s, waiting: all.filter(q => q.stage === s.technical_stage && q.situation === s.entry_situation).length,
    })) },
    summary: {
      ready: queue.filter((q) => !(q.claim && q.claim.until > live)).length,
      replies: all.filter((q) => ready(q) && q.group === "respuestas").length,
      demos: all.filter((q) => ready(q) && q.group === "demos").length,
      scheduled: all.filter((q) => q.action && q.dueAt).length,
      blocked: all.filter((q) => q.action && q.blocked).length,
      claimed: queue.filter((q) => q.claim && q.claim.until > live).length,
      doneToday: sent.filter((e) => e.sent_at && String(iso(e.sent_at)).slice(0, 10) === now.toISOString().slice(0, 10)).length,
      newToday: b.newToday,
      cap: b.cap,
    },
    queue: queue.map(decorate),
    scheduled: all.filter((q) => q.action && q.dueAt && !q.blocked).sort((x, y) => String(x.dueAt).localeCompare(String(y.dueAt))).map(decorate),
    blocked: all.filter((q) => q.action && q.blocked).sort(byPriority).map(decorate),
    // Igual que en Habita: la bandeja existe incluso si un horario bloquea el próximo envío.
    inbox: all.filter((q) => q.group === "respuestas" && q.action && !q.snoozedUntil).map((q) => ({
      ...decorate(q),
      latestReply: latestReply.get(q.id)?.new_value ?? q.situationNote ?? "",
      latestReplyAt: latestReply.get(q.id)?.created_at ?? q.lastContactAt ?? null,
    })),
    noInteresados: all.filter((q) => q.situation === "rechazo" && !q.action),

    funnel,
    timing,
    stages: FOLLOWUP_STAGES.map((s) => {
      const own = b.vs.filter((v) => v.stage === s.key);
      const stats = versionStats(own, b.ex.filter((e) => e.stage === s.key), b.stepNow);
      return { key: s.key, title: s.title, goal: s.goal, waiting: all.filter((q) => q.stage === s.key).length, versions: own.map((v, i) => ({ ...v, stats: stats[i] })) };
    }),
    rules: FOLLOWUP_STAGES.map((s) => ({
      key: s.key,
      stage: s.key,
      name: controlByStage.get(s.key)?.name || s.title,
      enabled: controlByStage.get(s.key)?.enabled !== false,
      situations: controlByStage.get(s.key)?.situations || [],
      after_hours: controlByStage.get(s.key)?.after_hours ?? 0,
      hours_from: controlByStage.get(s.key)?.hours_from ?? 8,
      hours_to: controlByStage.get(s.key)?.hours_to ?? 21,
      days: controlByStage.get(s.key)?.days ?? [1,2,3,4,5,6],
      action: actionLabel(s.key),
      action_key: "principal",
      action_label: actionLabel(s.key),
      title: s.title,
      wait:
        s.key === "sin-saludo"
          ? `Hasta ${b.cap} saludos por día, de lunes a sábado de 8:30 a 20`
          : s.key === "saludo-sin-demo"
            ? "Paso 2 apenas responde el saludo; el link (Paso 3 o, sin respuesta en 24 h, Seguimiento 1) desde «Audios y mensajes»"
            : s.key === "demo-sin-abrir"
              ? "Cadencia de Prospección: Seguimiento 2 al día hábil siguiente del link y el 3 (para reenviar) dos días hábiles después, 3 mensajes como máximo"
              : "48 h desde el último mensaje",
      exit: s.goal,
    })),
    results: {
      byActor: [...byActor].map(([actor, x]) => ({ actor, ...x, rate: x.executions ? x.conversions / x.executions : null })),
      totals: { executions: sent.length, failed: b.ex.filter((e) => e.status === "failed").length },
      // Lo mismo que habita. (amoblaia results.execution): la cola día por día y por tipo de acción.
      // Exitosa: con la definición de Turnia, la persona avanzó de paso después del envío.
      execution: {
        available: days !== null,
        stages: Object.fromEntries(FOLLOWUP_STAGES.map((s) => [s.key, s.title])),
        days: executionDays(days ?? [], dayExecutions, b.stepNow, label),
      },
      actionLabels: Object.fromEntries(FOLLOWUP_STAGES.map((s) => [s.key, actionLabel(s.key)])),
      // Las cohortes con las etapas comerciales de Follow-up desde Saludado (las del Embudo del panel).
      cohortFunnel: (() => {
        const stages = TURNIA_COMMERCIAL.filter((c) => c.key !== "prospectado").map((c) => ({
          key: c.key, title: c.label,
          from: c.technical.length ? Math.min(...c.technical.map((t) => stageInfo(t as StageKey).step)) : CLIENT_STEP,
        }));
        const greeting = new Map<string, number>();
        for (const e of b.ex) if (e.status === "sent" && e.stage === "sin-saludo") greeting.set(e.outreach_id, b.vs.find((v) => v.id === e.version_id)?.version ?? 0);
        const people = b.people.map((r) => ({ firstContact: iso(r.greeted_at), step: b.stepNow.get(r.id) ?? -1, greetingVersion: greeting.get(r.id) ?? null }));
        const t = stages.map((x) => x.from);
        return { stages: stages.map(({ key, title }) => ({ key, title })), contacto: funnelCohorts(people, t, "contacto"), version: funnelCohorts(people, t, "version") };
      })(),
      weeklyByType: weeklyByType(dayExecutions, b.stepNow, label),
    },
    changes,
  };
}

async function one(id: unknown, now = new Date()) {
  if (typeof id !== "string" || !UUID.test(id)) throw new FollowupError("No encontramos ese contacto.");
  const b = await board(now);
  const it = b.items.get(id);
  if (!it) throw new FollowupConflict("Ya no está en Follow-up (avanzó, se cerró o es un fijo). Actualizá la lista.");
  return it;
}

/** Que nadie más la tenga tomada. */
function mine(it: QueueItem, actor: string) {
  if (it.claim && it.claim.until > new Date().toISOString() && it.claim.by !== actor) throw new FollowupConflict(`${it.name} la está ejecutando ${it.claim.by}.`);
}

// La hora de las tomas es la del servidor de la app (la misma con que se leen), no la de la base.
async function lock(it: QueueItem, actor: string) {
  const now = new Date();
  const until = new Date(now.getTime() + CLAIM_SECONDS * 1000);
  const got = await sql<Array<{ actor: string }>>`
    insert into sales_followup_claims (outreach_id, actor, stage, claimed_at, locked_until)
    values (${it.id}, ${actor}, ${it.stage}, ${now}, ${until})
    on conflict (outreach_id) do update set actor = excluded.actor, stage = excluded.stage, locked_until = excluded.locked_until,
      claimed_at = case when sales_followup_claims.actor = excluded.actor then sales_followup_claims.claimed_at else excluded.claimed_at end
    where sales_followup_claims.actor = excluded.actor or sales_followup_claims.locked_until <= ${now}
    returning actor`;
  if (!got.length) throw new FollowupConflict(`${it.name} la está ejecutando otra persona.`);
}
const unlock = (id: string, actor: string) => sql`delete from sales_followup_claims where outreach_id = ${id} and actor = ${actor}`;

/** «Ejecutar»: la toma 10 minutos y devuelve el mensaje armado. Sin id, la próxima libre de la cola. */
export async function claim(id: unknown, actor: string) {
  if (id) {
    const it = await one(id);
    if (!it.action) throw new FollowupConflict(it.actionReason ?? "No hay nada para mandarle ahora.");
    if (it.blocked) throw new FollowupConflict(it.blocked);
    mine(it, actor);
    await lock(it, actor);
    return { item: it, ...(await prepareFollowup(it.id, it.stage)), lockedUntil: new Date(Date.now() + CLAIM_SECONDS * 1000).toISOString() };
  }
  const { queue } = await followupSnapshot();
  for (const it of queue) {
    if (it.claim && it.claim.until > new Date().toISOString() && it.claim.by !== actor) continue;
    try {
      await lock(it, actor);
      return { item: it, ...(await prepareFollowup(it.id, it.stage)), lockedUntil: new Date(Date.now() + CLAIM_SECONDS * 1000).toISOString() };
    } catch (e) {
      if (e instanceof FollowupConflict) continue;
      throw e;
    }
  }
  return null;
}

type Task = { id: unknown; stage?: unknown; versionId?: unknown };
async function sameTask(t: Task, actor: string) {
  const it = await one(t.id);
  if (t.stage !== undefined && t.stage !== it.stage)
    throw new FollowupConflict(`Ya no está en «${isStageKey(t.stage) ? stageInfo(t.stage).title : String(t.stage)}»: ahora está en «${it.stageTitle}». Actualizá la lista.`);
  if (t.versionId !== undefined && t.versionId !== it.versionId && it.execution?.status !== "sent") throw new FollowupConflict("Esa versión ya no corresponde a esta etapa. Actualizá la lista.");
  mine(it, actor);
  return it;
}

/** «Abrir WhatsApp»: queda abierta (no cuenta como enviada). */
export async function open(t: Task, actor: string) {
  const it = await sameTask(t, actor);
  await lock(it, actor);
  return markFollowup({ id: it.id, stage: it.stage, versionId: t.versionId ?? it.versionId, status: "opened", actor });
}

/** El mensaje salió: cuenta como ejecución (y como contacto de Prospección en las tres primeras etapas). Idempotente. */
export async function confirm(t: Task, actor: string, executedBy: "humano" | "bot" = "humano") {
  // Un reintento (o un doble clic) de un envío ya confirmado: aunque ya haya pasado de etapa, no suma nada.
  if (typeof t.id === "string" && UUID.test(t.id) && typeof t.versionId === "string" && UUID.test(t.versionId)) {
    const [done] = await sql<Array<{ status: string; updated_at: string; actor: string | null; reason: string | null }>>`
      select status, updated_at, actor, reason from sales_followup_executions where outreach_id = ${t.id} and version_id = ${t.versionId} and status = 'sent'`;
    if (done) return { execution: { status: done.status, at: String(iso(done.updated_at)), reason: done.reason, by: done.actor }, warning: null, replayed: true, item: await one(t.id).catch(() => null) };
  }
  const it = await sameTask(t, actor);
  const out = await markFollowup({ id: it.id, stage: it.stage, versionId: t.versionId ?? it.versionId, status: "sent", actor });
  // Confirmado desde el modo extensión de Chapa (?agente=1): lo ejecutó la extensión del navegador, no una persona.
  if (executedBy === "bot")
    await sql`update sales_followup_executions set executed_by = 'bot' where outreach_id = ${it.id} and version_id = ${String(t.versionId ?? it.versionId)} and status = 'sent'`.catch(() => null);
  await unlock(it.id, actor);
  const after = await one(it.id).catch(() => null);
  return { ...out, item: after };
}

/** No salió (con motivo). «sin_whatsapp» o «numero_incorrecto» también lo cierran. */
export async function fail(t: Task & { reason?: unknown; kind?: unknown }, actor: string) {
  const it = await sameTask(t, actor);
  const kind = t.kind === "sin_whatsapp" || t.kind === "numero_incorrecto" ? t.kind : null;
  const reason = (typeof t.reason === "string" ? t.reason.trim().slice(0, 300) : "") || (kind ? SITUATIONS[kind] : "");
  if (!reason) throw new FollowupError("Contá por qué no salió.");
  const out = await markFollowup({ id: it.id, stage: it.stage, versionId: t.versionId ?? it.versionId, status: "failed", reason, actor });
  if (kind) await setSituation(it.id, kind, reason, actor);
  await unlock(it.id, actor);
  return out;
}

export async function release(id: unknown, actor: string) {
  if (typeof id !== "string" || !UUID.test(id)) throw new FollowupError("No encontramos ese contacto.");
  await unlock(id, actor);
  return { released: true };
}

async function audit(id: string, subject: string, value: string | null, actor: string) {
  await sql`insert into sales_followup_audit (outreach_id, subject, new_value, actor) values (${id}, ${subject}, ${value?.slice(0, 2300) ?? null}, ${actor.slice(0, 80)})`;
}
async function saveState(id: string, fields: Partial<Omit<State, "outreach_id">>, actor: string) {
  const f = { situation: null, situation_step: null, situation_note: null, priority: null, snooze_until: null, snooze_reason: null, owner: null, ...fields };
  const keys = Object.keys(fields) as (keyof typeof f)[];
  await sql`
    insert into sales_followup_state (outreach_id, situation, situation_step, situation_note, situation_at, priority, snooze_until, snooze_reason, owner, updated_by)
    values (${id}, ${f.situation}, ${f.situation_step}, ${f.situation_note}, ${keys.includes("situation") ? sql`now()` : null}, ${f.priority}, ${f.snooze_until}, ${f.snooze_reason}, ${f.owner}, ${actor})
    on conflict (outreach_id) do update set ${sql(Object.fromEntries(keys.map((k) => [k, f[k]])))}, ${keys.includes("situation") ? sql`situation_at = now(),` : sql``} updated_by = ${actor}, updated_at = now()`;
}

/** Lo que cada situación cambia en Prospección, para que su panel y el embudo digan lo mismo. */
const STATUS_FOR: Partial<Record<Situation, OutreachStatus>> = {
  confirmo_numero: "respondio",
  interesado: "respondio",
  neutro: "respondio",
  pregunta_precios: "respondio",
  mas_adelante: "respondio",
  derivo: "respondio",
  rechazo: "no_interesa",
  no_contactar: "baja",
  sin_whatsapp: "sin_canal",
  numero_incorrecto: "sin_canal",
};

/** Qué pasó en la conversación (con el texto original). Vale mientras siga en el mismo paso del embudo. */
export async function setSituation(id: string, raw: unknown, note: unknown, actor: string) {
  if (!isSituation(raw)) throw new FollowupError("Situación desconocida.");
  const [person] = await rows(id);
  if (!person) throw new FollowupError("No encontramos ese contacto.");
  const text = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  const { step, stage } = placeOf(person);
  if ((raw === "recontactar_vacaciones" || raw === "recontactar_mas_adelante") && stage === "sin-saludo")
    throw new FollowupError("Recontactar se habilita desde Saludado/Contactado en adelante.");
  await saveState(id, { situation: raw, situation_step: step, situation_note: text || null }, actor);
  await audit(id, "situation", `${raw}${text ? ` · «${text.slice(0, 200)}»` : ""}`, actor);
  let warning: string | null = null;
  const status = STATUS_FOR[raw];
  const open = person.status === "por_contactar" || person.status === "contactado";
  try {
    if (status && (open || CLOSED_SITUATIONS.includes(raw)) && person.status !== status) await setOutreachStatus(id, status, `${SITUATIONS[raw]} (Follow-up, ${actor})`);
    if (text) await addOutreachNote(id, `${SITUATIONS[raw]}: «${text}» (${actor})`);
  } catch (e) {
    if (!(e instanceof OutreachError)) throw e;
    warning = `La situación quedó guardada, pero no en Prospección: ${e.message}`;
  }
  return { situation: raw, warning };
}

/** Una respuesta de WhatsApp: con clasificación se aplica como situación; sin ella, queda «Neutro» para resolver a mano. */
export async function registerReply(input: { id: unknown; text: unknown; classification?: unknown }, actor: string) {
  if (typeof input.id !== "string" || !UUID.test(input.id)) throw new FollowupError("No encontramos ese contacto.");
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 2000) : "";
  if (!text) throw new FollowupError("Falta el texto de la respuesta (en un audio: «Audio»).");
  const situation = input.classification === undefined || input.classification === null || input.classification === "" ? "neutro" : input.classification;
  await audit(input.id, "reply", text, actor);
  return setSituation(input.id, situation, text, actor);
}

/**
 * Una respuesta leída del WhatsApp (la lectura diaria de WAHA), sin clasificar. Si la persona estaba
 * esperando (por contactar, contactado, o «pide más adelante» / «sin respuesta»), pasa a «Respuestas
 * para atender» como Neutro; si ya se está hablando o está cerrada, solo queda en la historia.
 */
export async function incomingReply(id: string, text: string, actor: string): Promise<"abierta" | "registrada"> {
  const [p] = await sql<Array<{ status: string; situation: string | null }>>`
    select o.status, s.situation from sales_outreach o left join sales_followup_state s on s.outreach_id = o.id where o.id = ${id}`;
  if (!p) throw new FollowupError("No encontramos ese contacto.");
  const waiting = p.status === "por_contactar" || p.status === "contactado"
    || ((p.status === "respondio" || p.status === "reunion") && (p.situation === "mas_adelante" || p.situation === "sin_respuesta"));
  if (waiting) {
    await registerReply({ id, text }, actor);
    return "abierta";
  }
  await audit(id, "reply", text, actor);
  return "registrada";
}

const DAY_MS = 86_400_000;
/** Reprogramar: sale de la cola hasta esa fecha (sin fecha: mañana a las 9 de Argentina). */
export async function snooze(id: string, rawUntil: unknown, rawReason: unknown, actor: string) {
  if (!UUID.test(id)) throw new FollowupError("No encontramos ese contacto.");
  const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 300) : "";
  let until: Date;
  if (rawUntil === null || rawUntil === undefined || rawUntil === "") {
    until = new Date(Date.now() + DAY_MS);
    until.setUTCHours(12, 0, 0, 0);
  } else until = new Date(String(rawUntil));
  if (Number.isNaN(until.getTime())) throw new FollowupError("Fecha inválida.");
  if (until.getTime() < Date.now()) throw new FollowupError("La fecha ya pasó.");
  if (until.getTime() > Date.now() + 90 * DAY_MS) throw new FollowupError("Se reprograma hasta 90 días.");
  await saveState(id, { snooze_until: until.toISOString(), snooze_reason: reason || null }, actor);
  await unlock(id, actor);
  await audit(id, "snooze", `${until.toISOString()}${reason ? ` · ${reason}` : ""}`, actor);
  return { snoozedUntil: until.toISOString(), reason: reason || null };
}
export async function unsnooze(id: string, actor: string) {
  if (!UUID.test(id)) throw new FollowupError("No encontramos ese contacto.");
  await saveState(id, { snooze_until: null, snooze_reason: null }, actor);
  await audit(id, "snooze", "vuelve a la cola", actor);
  return { snoozedUntil: null };
}

export async function setPriority(id: string, raw: unknown, actor: string) {
  if (!UUID.test(id)) throw new FollowupError("No encontramos ese contacto.");
  if (raw !== null && raw !== "" && !isPriority(raw)) throw new FollowupError("La prioridad es alta, media o baja.");
  await saveState(id, { priority: isPriority(raw) ? raw : null }, actor);
  await audit(id, "priority", isPriority(raw) ? raw : "automática", actor);
  return { priority: isPriority(raw) ? raw : null };
}

/** El responsable de la persona (Facu, Axel); vacío lo saca. */
export async function setOwner(id: string, raw: unknown, actor: string) {
  if (!UUID.test(id)) throw new FollowupError("No encontramos ese contacto.");
  const owner = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
  await saveState(id, { owner: owner || null }, actor);
  await audit(id, "owner", owner || "sin responsable", actor);
  return { owner: owner || null };
}

/**
 * Una operación de Follow-up desde Chapa Labs, con los nombres de campo de habita. (`inmobiliaria`
 * es la persona: su id o su código). Quien opera (`actor`) queda en la toma, la ejecución y la auditoría.
 */
export async function runFollowupOp(op: unknown, b: Record<string, unknown>, actor: string) {
  const raw = b.inmobiliaria ?? b.id;
  const id = typeof raw === "string" && !UUID.test(raw) && raw ? await idOfCode(raw) : raw;
  const task = { id, stage: b.etapa, versionId: b.version };
  const need = () => {
    if (typeof id !== "string" || !UUID.test(id)) throw new FollowupError("Falta la persona.");
    return id;
  };
  switch (op) {
    case "queue": {
      const s = await followupSnapshot();
      const free = s.queue.filter((q) => !q.claim || q.claim.by === actor || q.claim.until <= new Date().toISOString());
      return { summary: s.summary, next: free[0] ?? null, queue: s.queue.slice(0, Math.max(1, Math.min(Number(b.limite) || 50, 500))), blocked: s.blocked.slice(0, 200) };
    }
    case "claim":
      return claim(id || null, actor);
    case "open":
      return open(task, actor);
    case "confirm":
      return confirm(task, actor, b.ejecutor === "bot" ? "bot" : "humano");
    case "fail":
      return fail({ ...task, reason: b.motivo, kind: b.tipo }, actor);
    case "release":
      return release(need(), actor);
    case "situation":
      return setSituation(need(), b.situacion, b.texto, actor);
    case "reply":
      return registerReply({ id: need(), text: b.texto, classification: b.clasificacion }, actor);
    case "replies":
      return { replies: (await followupSnapshot()).inbox };
    case "snooze":
      return b.volver === true ? unsnooze(need(), actor) : snooze(need(), b.hasta, b.motivo, actor);
    case "priority":
      return setPriority(need(), b.prioridad, actor);
    case "owner":
      return setOwner(need(), b.responsable, actor);
    case "version-create":
      return createFollowupVersion((b.valores as Record<string, unknown>) ?? {});
    case "version-status":
      return setFollowupVersionStatus(b.id, b.estado);
    case "stage-create":
      return createCommercialStage((b.valores as Record<string, unknown>) ?? {});
    case "state-save":
      return saveCommercialSituation((b.valores as Record<string, unknown>) ?? {}, actor);
    case "state-delete":
      return deleteCommercialSituation((b.valores as Record<string, unknown>) ?? {}, actor);
    case "state-toggle":
      return toggleCommercialSituation((b.valores as Record<string, unknown>) ?? {}, actor);
    case "rule-save":
      return saveRuleControl(b.key, (b.valores as Record<string, unknown>) ?? {}, actor);
    case "version-update":
      throw new FollowupError("Las versiones de Turnia son inmutables: creá una versión nueva para preservar las métricas históricas.");
    default:
      throw new FollowupError("Operación de Follow-up desconocida.");
  }
}

async function idOfCode(code: string) {
  const [row] = await sql<Array<{ id: string }>>`select id from sales_outreach where code = ${code.trim().toLowerCase()}`;
  if (!row) throw new FollowupError("Esa persona no está en la prospección de Turnia.");
  return row.id;
}
