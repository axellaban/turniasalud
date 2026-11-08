import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { DEFAULT_TZ } from "@/lib/time";
import { CLOSED, displayOutreachPhone, renderTemplate, whatsappLinks, type OutreachPerson, type OutreachStatus } from "./outreach-messages";
import { OutreachError, addOutreachNote, conversoSql, fijoSinRespuesta, outreachDemoUrl, recordTouch } from "./outreach";
import {
  FOLLOWUP_STAGES,
  TOUCH_STAGES,
  cleanVersion,
  isStageKey,
  stageInfo,
  stageOf,
  stepOf,
  versionFor,
  versionStats,
  type ExecutionStatus,
  type FollowupExecution,
  type FollowupVersion,
  type StageKey,
  type VersionStats,
} from "./followup-stages";

// Follow-up (Panel → Follow-up): cada etapa del embudo con su next best action, las personas que
// esperan en ella y los números de cada versión. Las etapas salen de los mismos datos que EMBUDO.md
// y `npm run embudo`: saludo, demo enviada, demo abierta, conversación con Sofi, cuenta (acceso del
// consultorio sin revocar), cuenta activa en la semana y cliente.

export class FollowupError extends Error {}

const TZ = DEFAULT_TZ;
// Los umbrales de cuenta activa de EMBUDO.md (scripts/embudo.mjs: ACTIVE_MIN_PATIENTS y ACTIVE_MIN_APPOINTMENTS).
const ACTIVE_MIN_PATIENTS = 3;
const ACTIVE_MIN_APPOINTMENTS = 1;

export type Row = OutreachPerson & {
  id: string;
  status: OutreachStatus;
  priority: number;
  touches: number;
  next_action_on: string | null;
  signals: string;
  opened_at: string | null;
  demo_at: string | null;
  last_contact_at: string | null;
  first_contact_at: string | null;
  created_at: string;
  suppressed: boolean;
  landline: boolean;
  contactable: boolean;
  converso: boolean;
  account: boolean;
  active: boolean;
};

const facts = (r: Row) => ({
  greeted: Boolean(r.greeted_at),
  touches: r.touches,
  opened: Boolean(r.opened_at),
  converso: r.converso,
  account: r.account,
  active: r.active,
  client: r.status === "cliente",
});
export const placeOf = (r: Row) => ({
  step: stepOf(facts(r)),
  stage: stageOf({ ...facts(r), closed: CLOSED.includes(r.status) && r.status !== "cliente", suppressed: r.suppressed, landline: r.landline, contactable: r.contactable }),
});

/** Cada persona de la prospección con lo que hace falta para ubicarla en el embudo. */
export async function rows(id?: string) {
  const weekStart = sql`(date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ})`;
  const account = sql`(o.clinic_id is not null and exists (select 1 from clinic_access a where a.clinic_id = o.clinic_id and a.revoked_at is null))`;
  return sql<Row[]>`
    select o.id, o.code, o.name, o.greeting, o.title, o.business_name, o.zone, o.address, o.specialty, o.phone, o.phone_kind, o.instagram,
      o.website, o.touches, o.greeted_at, o.status, o.priority, o.next_action_on::text as next_action_on, o.signals, o.opened_at, o.demo_at, o.last_contact_at, o.first_contact_at, o.created_at,
      exists (select 1 from sales_suppressions s where s.phone = o.phone) as suppressed,
      ${fijoSinRespuesta()} as landline,
      (o.phone is not null and o.phone_kind is distinct from 'fijo'
        and not exists (select 1 from sales_outreach x where x.phone = o.phone and x.id <> o.id and (x.touches > 0 or x.status <> 'por_contactar'))) as contactable,
      ${conversoSql()} as converso,
      ${account} as account,
      (${account}
        and (select count(distinct v.patient_id) from conversations v where v.clinic_id = o.clinic_id and v.patient_id is not null and v.started_at >= ${weekStart}) >= ${ACTIVE_MIN_PATIENTS}
        and (select count(*) from appointments a where a.clinic_id = o.clinic_id and a.source <> 'panel' and a.created_at >= ${weekStart}) >= ${ACTIVE_MIN_APPOINTMENTS}) as active
    from sales_outreach o
    ${id ? sql`where o.id = ${id}` : sql``}`;
}

export const versions = () =>
  sql<FollowupVersion[]>`select id, stage, version, channel, trigger_label, body, ctas, status, created_at, status_at from sales_followup_versions order by stage, version`;
export const executions = (outreachId?: string) =>
  sql<FollowupExecution[]>`
    select id, version_id, stage, outreach_id, from_step, status, reason, updated_at, actor, sent_at from sales_followup_executions
    ${outreachId ? sql`where outreach_id = ${outreachId}` : sql``}`;

export type QueueItem = {
  id: string;
  code: string;
  name: string;
  business: string;
  zone: string;
  phone: string | null;
  whatsapp: boolean;
  priority: number;
  since: string;
  versionId: string | null;
  execution: { status: ExecutionStatus; at: string; reason: string | null } | null;
};
export type StageView = {
  key: StageKey;
  title: string;
  goal: string;
  versions: Array<FollowupVersion & { stats: VersionStats }>;
  queue: QueueItem[];
};

/** La página: cada etapa con sus versiones medidas y quienes esperan (primero los pendientes con WhatsApp, los que esperan hace más). */
export async function followupOverview(): Promise<StageView[]> {
  const [people, vs, ex] = await Promise.all([rows(), versions(), executions()]);
  const stepNow = new Map<string, number>();
  const byStage = new Map<StageKey, QueueItem[]>(FOLLOWUP_STAGES.map((s) => [s.key, []]));
  const exOf = new Map<string, FollowupExecution[]>();
  for (const e of ex) exOf.set(e.outreach_id, [...(exOf.get(e.outreach_id) ?? []), e]);
  for (const r of people) {
    const { step, stage } = placeOf(r);
    stepNow.set(r.id, step);
    if (!stage) continue;
    const mine = (exOf.get(r.id) ?? []).filter((e) => e.stage === stage);
    const v = versionFor(r.id, vs.filter((x) => x.stage === stage), mine);
    const done = v ? mine.find((e) => e.version_id === v.id) : undefined;
    byStage.get(stage)!.push({
      id: r.id,
      code: r.code,
      name: r.name,
      business: r.business_name,
      zone: r.zone,
      phone: r.phone ? displayOutreachPhone(r.phone) : null,
      whatsapp: Boolean(r.phone && r.phone_kind !== "fijo"),
      priority: r.priority,
      since: String(r.last_contact_at ?? r.first_contact_at ?? r.created_at),
      versionId: v?.id ?? null,
      execution: done ? { status: done.status, at: String(done.updated_at), reason: done.reason } : null,
    });
  }
  const order = (q: QueueItem) => (q.execution?.status === "sent" ? 2 : q.whatsapp ? 0 : 1);
  return FOLLOWUP_STAGES.map((s) => {
    const own = vs.filter((v) => v.stage === s.key);
    const stats = versionStats(own, ex.filter((e) => e.stage === s.key), stepNow);
    const queue = byStage.get(s.key)!;
    // «Sin saludar»: por prioridad, como «Para hoy». El resto: los que esperan hace más.
    queue.sort((a, b) => order(a) - order(b) || (s.key === "sin-saludo" ? a.priority - b.priority : 0) || a.since.localeCompare(b.since));
    return { key: s.key, title: s.title, goal: s.goal, versions: own.map((v, i) => ({ ...v, stats: stats[i] })), queue };
  });
}

/** Una persona como está ahora, en la etapa que dice el panel (si cambió, se avisa). */
async function current(id: string, stage: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new FollowupError("No encontramos ese contacto.");
  if (!isStageKey(stage)) throw new FollowupError("Etapa desconocida.");
  const [[row], vs, mine] = await Promise.all([rows(id), versions(), executions(id)]);
  if (!row) throw new FollowupError("No encontramos ese contacto.");
  const at = placeOf(row);
  if (at.stage !== stage)
    throw new FollowupError(at.stage ? `Ya no está en «${stageInfo(stage).title}»: pasó a «${stageInfo(at.stage).title}». Actualizá la lista.` : `Ya no está en «${stageInfo(stage).title}». Actualizá la lista.`);
  const own = vs.filter((v) => v.stage === stage);
  const started = mine.filter((e) => e.stage === stage);
  return { row, step: at.step, versions: own, mine: started, version: versionFor(id, own, started) };
}

export const panelUrl = () => `${env.appUrl().replace(/\/$/, "")}/panel`;

/** El mensaje de la versión para esta persona, con sus variables. */
export function renderFollowup(body: string, person: OutreachPerson) {
  return renderTemplate(body, person, outreachDemoUrl(person.code)).replace(/\{panel\}/g, panelUrl());
}

/** «Ejecutar»: el mensaje armado, su WhatsApp y sus links. Todavía no se registra nada. */
export async function prepareFollowup(id: string, stage: unknown) {
  const c = await current(id, stage);
  const v = c.version;
  if (!v) throw new FollowupError("Esta etapa no tiene una versión activa: creá una arriba.");
  const message = renderFollowup(v.body, c.row);
  const canWrite = Boolean(c.row.phone && c.row.phone_kind !== "fijo");
  const warnings: string[] = [];
  if (v.channel === "whatsapp" && !canWrite) warnings.push("No tiene un celular con WhatsApp: cargalo en su ficha de Prospección.");
  if (TOUCH_STAGES.includes(v.stage) && c.row.touches >= 3) warnings.push("Ya se le escribió tres veces: el envío no suma otro contacto en Prospección.");
  const links = v.channel === "whatsapp" && canWrite ? whatsappLinks(c.row.phone!, message) : null;
  const previous = c.mine.find((e) => e.version_id === v.id);
  return {
    id,
    stage: v.stage,
    versionId: v.id,
    version: v.version,
    channel: v.channel,
    ctas: v.ctas,
    name: c.row.name,
    phone: c.row.phone ? displayOutreachPhone(c.row.phone) : null,
    message,
    ready: v.channel === "tarea" || canWrite,
    warnings,
    whatsapp: links,
    links: { demo: outreachDemoUrl(c.row.code), panel: panelUrl() },
    execution: previous ? { status: previous.status, at: String(previous.updated_at) } : null,
  };
}

/**
 * Registra qué pasó: «opened» (abrió WhatsApp con el mensaje), «sent» (confirmó: cuenta como
 * ejecución) o «failed» (no salió, con motivo). Un envío confirmado en las tres primeras etapas es
 * un contacto de Prospección (recordTouch: saludo, demo o seguimiento, con sus eventos de PostHog);
 * en las demás queda como nota en su historia. Si eso falla, la ejecución cuenta igual y se avisa.
 * Una ejecución enviada no vuelve atrás.
 */
export async function markFollowup(input: { id: string; stage: unknown; versionId: unknown; status: unknown; reason?: unknown; actor?: string }) {
  const status = input.status === "opened" || input.status === "sent" || input.status === "failed" ? (input.status as ExecutionStatus) : null;
  if (!status) throw new FollowupError("Estado desconocido.");
  const c = await current(input.id, input.stage);
  const v = c.versions.find((x) => x.id === input.versionId);
  if (!v) throw new FollowupError("Esa versión ya no está en esta etapa. Actualizá la lista.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (status === "failed" && !reason) throw new FollowupError("Contá por qué no salió.");
  const [saved] = await sql<FollowupExecution[]>`
    insert into sales_followup_executions (version_id, stage, outreach_id, from_step, status, reason, sent_at, actor)
    values (${v.id}, ${v.stage}, ${input.id}, ${c.step}, ${status}, ${reason || null}, ${status === "sent" ? sql`now()` : null}, ${input.actor?.slice(0, 80) || null})
    on conflict (version_id, outreach_id) do update set status = excluded.status, reason = excluded.reason, from_step = excluded.from_step,
      sent_at = excluded.sent_at, actor = coalesce(excluded.actor, sales_followup_executions.actor), updated_at = now()
    where sales_followup_executions.status <> 'sent'
    returning id, version_id, stage, outreach_id, from_step, status, reason, updated_at, actor, sent_at`;
  const [execution] = saved ? [saved] : await sql<FollowupExecution[]>`
    select id, version_id, stage, outreach_id, from_step, status, reason, updated_at, actor, sent_at from sales_followup_executions
    where version_id = ${v.id} and outreach_id = ${input.id}`;
  let warning: string | null = null;
  if (status === "sent" && saved) {
    try {
      if (TOUCH_STAGES.includes(v.stage) && v.channel === "whatsapp") {
        await recordTouch(input.id, "whatsapp", { properties: { followup_stage: v.stage, followup_version: v.version, ...(input.actor ? { operator: input.actor } : {}) } });
      } else {
        await addOutreachNote(input.id, `Follow-up «${stageInfo(v.stage).title}» V${v.version}: ${v.channel === "tarea" ? "tarea hecha" : "mensaje enviado por WhatsApp"}.`);
      }
    } catch (e) {
      if (!(e instanceof OutreachError)) throw e;
      warning = `La ejecución quedó registrada, pero no el contacto en Prospección: ${e.message}`;
    }
  }
  return { execution: { status: execution.status, at: String(execution.updated_at) }, warning, replayed: status === "sent" && !saved };
}

/** Una versión nueva: activa (la anterior activa se archiva) o a prueba (reemplaza a la que estaba a prueba). */
export async function createFollowupVersion(input: Record<string, unknown>) {
  const v = cleanVersion(input);
  if ("error" in v) throw new FollowupError(v.error);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`followup:${v.stage}`}))`;
    if (v.status === "test" && !(await tx`select 1 from sales_followup_versions where stage = ${v.stage} and status = 'active'`).length)
      throw new FollowupError("Para probar 50/50 hace falta una versión activa.");
    const [{ next }] = await tx<Array<{ next: number }>>`select coalesce(max(version), 0) + 1 as next from sales_followup_versions where stage = ${v.stage}`;
    await tx`update sales_followup_versions set status = 'archived', status_at = now() where stage = ${v.stage} and status = ${v.status}`;
    const [row] = await tx<FollowupVersion[]>`
      insert into sales_followup_versions (stage, version, channel, trigger_label, body, ctas, status)
      values (${v.stage}, ${next}, ${v.channel}, ${v.trigger}, ${v.body}, ${tx.array([...v.ctas])}, ${v.status})
      returning id, stage, version, channel, trigger_label, body, ctas, status, created_at, status_at`;
    return row;
  });
}

/** «Hacerla la activa», «Detener prueba», «Probar 50/50». La activa no se archiva sola: la etapa quedaría sin acción. */
export async function setFollowupVersionStatus(id: unknown, status: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new FollowupError("No encontramos esa versión.");
  if (status !== "active" && status !== "test" && status !== "archived") throw new FollowupError("Estado desconocido.");
  return sql.begin(async (tx) => {
    const [row] = await tx<FollowupVersion[]>`select id, stage, status from sales_followup_versions where id = ${id}`;
    if (!row) throw new FollowupError("No encontramos esa versión.");
    await tx`select pg_advisory_xact_lock(hashtext(${`followup:${row.stage}`}))`;
    if (row.status === status) return;
    if (row.status === "active") throw new FollowupError("La versión activa no se archiva sola: activá otra primero.");
    if (status !== "archived") await tx`update sales_followup_versions set status = 'archived', status_at = now() where stage = ${row.stage} and status = ${status}`;
    await tx`update sales_followup_versions set status = ${status}, status_at = now() where id = ${id}`;
  });
}

