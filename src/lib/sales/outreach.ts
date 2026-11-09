import "server-only";
import { randomBytes } from "node:crypto";
import { captureLater } from "@/lib/analytics-server";
import { prospectDistinctId } from "@/lib/analytics-shared";
import { json, sql } from "@/lib/db";
import { env } from "@/lib/env";
import { DEFAULT_TZ, localDateKey } from "@/lib/time";
import type { OutreachImportRow } from "./outreach-import";
import { FORWARD_NOTE, TALK_PLACES, type TalkPlace } from "./outreach-places";
import {
  CLOSED,
  DEFAULT_TEMPLATES,
  MAX_TOUCHES,
  OUTREACH_STATUSES,
  TEMPLATE_KEYS,
  addBusinessDays,
  demoUrl,
  mergeTemplates,
  nextFollowUp,
  renderTemplate,
  splitMessages,
  weekStart,
  type OutreachChannel,
  type OutreachPerson,
  type OutreachStatus,
  type Templates,
} from "./outreach-messages";

// Prospección a odontólogos: la lista, la cola del día, cada contacto y su historia.
// Axel escribe a mano desde su WhatsApp o Instagram; acá queda registrado y se programa el seguimiento.

export class OutreachError extends Error {}

export type Outreach = OutreachPerson & {
  id: string;
  greeted_at: string | null;
  permission_at: string | null;
  last_reply_at: string | null;
  email: string | null;
  priority: number;
  signals: string;
  source: string;
  status: OutreachStatus;
  last_channel: OutreachChannel | null;
  first_contact_at: string | null;
  last_contact_at: string | null;
  next_action_on: string | null;
  opened_at: string | null;
  opens: number;
  demo_at: string | null;
  lead_id: string | null;
  notes: string;
  /** Qué software de agenda usa el consultorio (para saber qué integrar primero). */
  agenda_software: string | null;
  created_at: string;
  /** Otras personas con el mismo teléfono (un consultorio con varios odontólogos). */
  shared: Array<{ name: string; touched: boolean }>;
  suppressed: boolean;
};

export type OutreachEvent = { id: string; kind: string; channel: string | null; detail: string; created_at: string };

/**
 * Un fijo no sirve para prospectar: no tiene WhatsApp. Sale de la cola, de las cuentas y de las
 * listas (solo se ve con el filtro «Teléfono fijo»), aunque se le haya intentado escribir. Si igual
 * respondió o abrió su demo, sigue contando como cualquiera.
 */
export const fijoSinRespuesta = () => sql`(o.phone_kind is not distinct from 'fijo' and o.status in ('por_contactar', 'contactado', 'sin_canal') and o.opened_at is null and o.demo_at is null)`;

/** Se le puede escribir por WhatsApp: tiene celular (propio o del consultorio). */
const conWhatsApp = () => sql`(o.phone is not null and o.phone_kind is distinct from 'fijo')`;

export type OutreachSettings = { templates: Templates; daily_goal: number; weekly_goal: number };

const TZ = DEFAULT_TZ;
export const todayKey = () => localDateKey(new Date(), TZ);
export const outreachDemoUrl = (code: string) => demoUrl(env.appUrl(), code);

/** Quien registra las respuestas que lee la lectura diaria de WhatsApp (src/lib/sales/whatsapp-sync.ts). */
export const WHATSAPP_SYNC_ACTOR = "WhatsApp (lectura diaria)";

/**
 * Cuándo respondió por última vez (`o` es la persona): el último mensaje suyo que leyó la lectura de
 * WhatsApp, con su hora real, o una respuesta registrada a mano (en Follow-up o con «Respondió» en el
 * panel). Lo que anota la propia lectura no cuenta: llega horas después y su hora no es la de la respuesta.
 */
export const lastReplySql = () => sql`greatest(
  (select max(c.last_received_at) from sales_whatsapp_chats c where c.outreach_id = o.id),
  (select max(a.created_at) from sales_followup_audit a where a.outreach_id = o.id and a.subject = 'reply' and a.actor <> ${WHATSAPP_SYNC_ACTOR}),
  (select max(e.created_at) from sales_outreach_events e where e.outreach_id = o.id and e.kind = 'estado'
    and split_part(e.detail, ':', 1) = 'respondio' and position(${WHATSAPP_SYNC_ACTOR} in e.detail) = 0))`;

/** Respondió después de ese momento (una columna de `o`, como `o.greeted_at`). */
export const repliedSinceSql = (since: ReturnType<typeof sql>) => sql`coalesce(${lastReplySql()} > ${since}, false)`;

// Se arma en cada consulta: el cliente de la base se conecta recién en la primera.
const withExtras = () => sql`
  o.*,
  ${lastReplySql()} as last_reply_at,
  coalesce((select json_agg(json_build_object('name', x.name, 'touched', x.touches > 0 or x.status <> 'por_contactar') order by x.name)
            from sales_outreach x where x.phone = o.phone and x.id <> o.id), '[]'::json) as shared,
  exists (select 1 from sales_suppressions s where s.phone = o.phone) as suppressed`;

export async function outreachSettings(): Promise<OutreachSettings> {
  const [row] = await sql<Array<{ outreach_templates: unknown; outreach_daily_goal: number; outreach_weekly_goal: number }>>`
    select outreach_templates, outreach_daily_goal, outreach_weekly_goal from sales_settings where id = 1`;
  return { templates: mergeTemplates(row?.outreach_templates), daily_goal: row?.outreach_daily_goal ?? 50, weekly_goal: row?.outreach_weekly_goal ?? 250 };
}

export async function saveOutreachSettings(input: { templates: Partial<Templates>; daily_goal: number; weekly_goal: number }): Promise<void> {
  if (!Number.isInteger(input.daily_goal) || input.daily_goal < 1 || input.daily_goal > 200) throw new OutreachError("La meta diaria va de 1 a 200.");
  if (!Number.isInteger(input.weekly_goal) || input.weekly_goal < 1 || input.weekly_goal > 2000) throw new OutreachError("La meta semanal va de 1 a 2000.");
  const templates: Record<string, string> = {};
  for (const key of TEMPLATE_KEYS) {
    const value = input.templates[key]?.trim();
    // Los que quedan como el original no se guardan: así toman las mejoras que se hagan después.
    if (!value || value === DEFAULT_TEMPLATES[key]) continue;
    if (value.length > 1500) throw new OutreachError("Cada mensaje tiene que tener menos de 1500 caracteres.");
    templates[key] = value;
  }
  await sql`update sales_settings set outreach_templates = ${json(templates)}, outreach_daily_goal = ${input.daily_goal},
            outreach_weekly_goal = ${input.weekly_goal}, updated_at = now() where id = 1`;
}

export type OutreachStats = {
  total: number;
  today_new: number;
  today_followups: number;
  week_new: number;
  contacted: number;
  replied: number;
  opened: number;
  demos: number;
  /** Hablaron con Sofi en su demo (escribieron o hablaron): la conversión de la demo en las dos versiones. */
  talked: number;
  meetings: number;
  clients: number;
  due_followups: number;
  pending: number;
  interested: number;
};

export async function outreachStats(): Promise<OutreachStats> {
  const today = todayKey();
  const monday = weekStart(today);
  const [row] = await sql<OutreachStats[]>`
    select
      count(*)::int as total,
      count(*) filter (where (first_contact_at at time zone ${TZ})::date = ${today}::date)::int as today_new,
      (select count(*)::int from sales_outreach_events e join sales_outreach o on o.id = e.outreach_id
         where e.kind = 'mensaje' and e.detail in ('seguimiento', 'último') and (e.created_at at time zone ${TZ})::date = ${today}::date
           and not ${fijoSinRespuesta()}) as today_followups,
      count(*) filter (where (first_contact_at at time zone ${TZ})::date >= ${monday}::date)::int as week_new,
      count(*) filter (where first_contact_at is not null)::int as contacted,
      count(*) filter (where status in ('respondio', 'reunion', 'cliente', 'no_interesa', 'baja'))::int as replied,
      count(*) filter (where opened_at is not null)::int as opened,
      count(*) filter (where demo_at is not null)::int as demos,
      count(*) filter (where ${conversoSql()})::int as talked,
      count(*) filter (where status = 'reunion')::int as meetings,
      count(*) filter (where status = 'cliente')::int as clients,
      count(*) filter (where status = 'contactado' and touches < ${MAX_TOUCHES} and next_action_on <= ${today}::date)::int as due_followups,
      count(*) filter (where status = 'por_contactar' and ${conWhatsApp()})::int as pending,
      count(*) filter (where status in ('respondio', 'reunion') or (status = 'contactado' and (opened_at is not null or demo_at is not null)))::int as interested
    from sales_outreach o where not ${fijoSinRespuesta()}`;
  return row;
}

export type OutreachView = "hoy" | "seguimientos" | "interesados" | "todos";
export type OutreachFilter = { view: OutreachView; zone?: string | null; q?: string | null; channel?: string | null; status?: string | null; page?: number };
export const PAGE_SIZE = 50;

/** Contactable: con WhatsApp (los fijos y los que solo tienen Instagram no entran), sin baja y sin que otra persona del mismo número ya haya recibido el mensaje. */
const contactable = () => sql`
  ${conWhatsApp()}
  and not exists (select 1 from sales_suppressions s where s.phone = o.phone)
  and not exists (select 1 from sales_outreach x where x.phone = o.phone and x.id <> o.id and (x.touches > 0 or x.status <> 'por_contactar'))`;

function filters(f: OutreachFilter) {
  const zone = f.zone ? (f.zone === "otras" ? sql`and o.zone not in ('Mar del Plata', 'Miramar')` : sql`and o.zone = ${f.zone}`) : sql``;
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const search = q
    ? sql`and (o.name ilike ${q} or o.business_name ilike ${q} or o.address ilike ${q} or coalesce(o.phone, '') ilike ${q}
               or coalesce(o.instagram, '') ilike ${q} or o.specialty ilike ${q} or o.signals ilike ${q})`
    : sql``;
  const channel =
    f.channel === "celular" ? sql`and o.phone_kind = 'movil'`
    : f.channel === "consultorio" ? sql`and o.phone_kind = 'consultorio'`
    : f.channel === "fijo" ? sql`and o.phone_kind = 'fijo'`
    : f.channel === "instagram" ? sql`and o.instagram is not null`
    : f.channel === "sin" ? sql`and o.phone is null and o.instagram is null`
    : sql``;
  const status = f.status && (OUTREACH_STATUSES as readonly string[]).includes(f.status) ? sql`and o.status = ${f.status}` : sql``;
  return sql`${zone} ${search} ${channel} ${status}`;
}

/**
 * La cola de hoy: primero los seguimientos que vencieron (y quien probó la demo), después los
 * nuevos por prioridad hasta completar la meta del día.
 */
export async function outreachQueue(f: Omit<OutreachFilter, "view">, remainingNew: number): Promise<{ followups: Outreach[]; fresh: Outreach[] }> {
  const today = todayKey();
  const followups = await sql<Outreach[]>`
    select ${withExtras()} from sales_outreach o
    where o.status = 'contactado' and o.touches < ${MAX_TOUCHES} and o.next_action_on <= ${today}::date and not ${fijoSinRespuesta()}
      and not exists (select 1 from sales_suppressions s where s.phone = o.phone) ${filters({ ...f, view: "hoy" })}
    order by (o.demo_at is not null) desc, o.next_action_on, o.priority, o.name
    limit 200`;
  // Un número compartido entra una sola vez: por la persona de mejor prioridad.
  const fresh = remainingNew > 0
    ? await sql<Outreach[]>`
        with candidates as (
          select distinct on (coalesce(o.phone, o.id::text)) o.id from sales_outreach o
          where o.status = 'por_contactar' and ${contactable()} ${filters({ ...f, view: "hoy" })}
          order by coalesce(o.phone, o.id::text), o.priority, o.name
        )
        select ${withExtras()} from sales_outreach o join candidates c on c.id = o.id
        order by o.priority, (o.phone_kind = 'movil') desc nulls last, o.created_at, o.name
        limit ${Math.min(remainingNew, 200)}`
    : [];
  return { followups, fresh };
}

export async function listOutreach(f: OutreachFilter): Promise<{ rows: Outreach[]; total: number }> {
  const today = todayKey();
  const view =
    f.view === "seguimientos" ? sql`and o.status = 'contactado' and (o.next_action_on > ${today}::date or o.touches >= ${MAX_TOUCHES})`
    : f.view === "interesados" ? sql`and (o.status in ('respondio', 'reunion', 'cliente') or (o.status = 'contactado' and (o.opened_at is not null or o.demo_at is not null)))`
    : sql``;
  // Los fijos sin respuesta solo aparecen si se los busca.
  const fijos = f.channel === "fijo" ? sql`` : sql`and not ${fijoSinRespuesta()}`;
  const order =
    f.view === "interesados" ? sql`order by greatest(o.last_contact_at, o.opened_at, o.demo_at, o.updated_at) desc nulls last`
    : f.view === "seguimientos" ? sql`order by o.next_action_on nulls last, o.name`
    : sql`order by o.priority, o.status <> 'por_contactar', o.name`;
  const page = Math.max(0, (f.page ?? 1) - 1);
  const [{ count }] = await sql<Array<{ count: number }>>`select count(*)::int as count from sales_outreach o where true ${view} ${fijos} ${filters(f)}`;
  const rows = await sql<Outreach[]>`
    select ${withExtras()} from sales_outreach o where true ${view} ${fijos} ${filters(f)}
    ${order} limit ${PAGE_SIZE} offset ${page * PAGE_SIZE}`;
  return { rows, total: count };
}

export async function outreachZones(): Promise<Array<{ zone: string; count: number }>> {
  return sql<Array<{ zone: string; count: number }>>`
    select zone, count(*)::int as count from sales_outreach o where zone <> '' and not ${fijoSinRespuesta()} group by zone order by count(*) desc`;
}

export async function getOutreach(id: string): Promise<Outreach | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<Outreach[]>`select ${withExtras()} from sales_outreach o where o.id = ${id}`;
  return row ?? null;
}

/**
 * La persona escribió o habló en la conversación `v`. Sofi saluda primero: si abre la llamada o el chat
 * y se va sin decir nada, la conversación queda guardada solo con el saludo, y eso no es conversar.
 */
export const userSpokeSql = () => sql`jsonb_path_exists(coalesce(v.transcript, '[]'::jsonb), '$[*] ? (@.role == "user" && @.message != null && @.message != "")')`;

/**
 * Conversó con Sofi en su demo (no solo tocó «Probar la demo»): en la clínica de alguna demo de su pedido
 * hubo una conversación en la que escribió o habló. Es «Conversó en la demo» de la planilla y «Hablaron
 * con Sofi» en Chapa Labs.
 */
export const conversoSql = () => sql`exists (
  select 1 from demo_sessions s join conversations v on v.clinic_id = s.clinic_id
  where o.lead_id is not null and s.lead_id = o.lead_id and ${userSpokeSql()})`;

/** Lo que muestra la página pública de su demo: sin teléfono, notas ni estado. `converso`: ya habló con Sofi. */
export type PublicOutreach = Pick<Outreach, "code" | "name" | "greeting" | "title" | "business_name" | "zone" | "address" | "specialty" | "website" | "priority" | "phone_kind" | "status"> & {
  converso: boolean;
};

export async function publicOutreach(code: string): Promise<PublicOutreach | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code)) return null;
  const [row] = await sql<PublicOutreach[]>`
    select o.code, o.name, o.greeting, o.title, o.business_name, o.zone, o.address, o.specialty, o.website, o.priority, o.phone_kind, o.status,
      ${conversoSql()} as converso
    from sales_outreach o where o.code = ${code}`;
  return row ?? null;
}


/**
 * Tocó «Escribirle a Axel» desde su demo: queda en su historia y su seguimiento pasa a hoy (si
 * no mandó el mensaje, igual conviene escribirle). Uno cada 6 horas: los toques repetidos no suman.
 */
export async function recordTalkRequest(code: string, place: TalkPlace): Promise<boolean> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code) || !Object.hasOwn(TALK_PLACES, place)) return false;
  const today = todayKey();
  const [row] = await sql<Array<{ id: string }>>`
    update sales_outreach set next_action_on = case when status = 'contactado' then ${today}::date else next_action_on end, updated_at = now()
    where code = ${code} returning id`;
  if (!row) return false;
  const inserted = await sql`
    insert into sales_outreach_events (outreach_id, kind, channel, detail)
    select ${row.id}, 'pidio_hablar', 'whatsapp', ${TALK_PLACES[place]} where not exists (
      select 1 from sales_outreach_events where outreach_id = ${row.id} and kind = 'pidio_hablar' and created_at > now() - interval '6 hours')
    returning id`;
  return inserted.length > 0;
}

/**
 * El mensaje para reenviarles a los doctores desde su demo: el último del Seguimiento 3 («Hola Doc! Nos
 * armaron esta prueba…»), el de Panel → Prospección → Mensajes, con el link de su demo.
 */
export async function doctorsMessage(p: PublicOutreach): Promise<string> {
  const { templates } = await outreachSettings();
  const last = (text: string) => {
    const parts = splitMessages(text);
    return parts.length > 1 ? parts[parts.length - 1] : "";
  };
  const template = last(templates.whatsapp_reenviable) || last(DEFAULT_TEMPLATES.whatsapp_reenviable);
  return renderTemplate(template, { ...p, phone: null, instagram: null, website: p.website ?? null, touches: 0 }, outreachDemoUrl(p.code));
}

/**
 * Tocó «Reenviárselo a los doctores» en su demo (el mensaje del Seguimiento 3, listo para reenviar).
 * No se sabe si lo mandó: queda como nota en su ficha, una vez cada 6 horas.
 */
export async function recordForward(code: string): Promise<boolean> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code)) return false;
  const inserted = await sql`
    insert into sales_outreach_events (outreach_id, kind, channel, detail)
    select o.id, 'nota', 'whatsapp', ${FORWARD_NOTE} from sales_outreach o
    where o.code = ${code} and not exists (
      select 1 from sales_outreach_events e where e.outreach_id = o.id and e.kind = 'nota' and e.detail = ${FORWARD_NOTE}
        and e.created_at > now() - interval '6 hours')
    returning id`;
  return inserted.length > 0;
}

export async function outreachEvents(id: string): Promise<OutreachEvent[]> {
  return sql<OutreachEvent[]>`select id, kind, channel, detail, created_at from sales_outreach_events where outreach_id = ${id} order by created_at desc limit 100`;
}

/**
 * Lo que PostHog sabe de cada persona de la prospección: sin nombre ni teléfono, solo lo que sirve
 * para comparar (prioridad, zona, tipo de teléfono, estado). Ver ANALITICA.md.
 */
type ProspectFacts = Pick<Outreach, "code" | "priority" | "zone" | "specialty" | "phone_kind" | "status" | "touches">;
const prospectPerson = (o: ProspectFacts) => ({
  set: {
    prospect_priority: o.priority,
    prospect_zone: o.zone || null,
    prospect_specialty: o.specialty.slice(0, 80) || null,
    prospect_phone_kind: o.phone_kind ?? null,
    prospect_status: o.status,
    prospect_touches: o.touches,
  },
  setOnce: { prospect_code: o.code },
});
const prospectEvent = (event: string, o: ProspectFacts, properties: Record<string, string | number | boolean | null> = {}) =>
  captureLater(event, prospectDistinctId(o.code), { ...properties, prospect_priority: o.priority, prospect_phone_kind: o.phone_kind ?? null }, prospectPerson(o));

const TOUCH_DETAIL = ["primero", "seguimiento", "último"];
/** El Paso 1 (el saludo sin link) y el Paso 2 (el gancho que pide permiso) quedan en la historia como mensajes, pero no son toques. */
const GREETING = "saludo";
const PERMISSION = "permiso";

/**
 * Registra un contacto. El primer WhatsApp es el Paso 1, el saludo sin link: no suma un toque. El
 * segundo es el Paso 2, el gancho que pide permiso para pasar el link (cuando responde el saludo):
 * tampoco suma, y si no responde, el Seguimiento 1 toca al día hábil siguiente. Después, cada mensaje
 * (WhatsApp, Instagram, email) suma un toque y programa el seguimiento; una llamada o una visita
 * quedan en la historia sin consumir los mensajes. `before`: le había escrito antes de usar el panel
 * (no cuenta para la meta de hoy). `touch`: es uno de los tres mensajes aunque no haya salido el
 * Paso 2 (lleva el link: se registra un envío en lote o desde Chapa con su paso).
 */
export async function recordTouch(
  id: string,
  channel: OutreachChannel,
  opts: { before?: boolean; touch?: boolean; properties?: Record<string, string | number | boolean | null> } = {},
): Promise<Outreach> {
  const today = todayKey();
  const message = channel === "whatsapp" || channel === "instagram" || channel === "email";
  const updated = await sql.begin(async (tx) => {
    const [row] = await tx<Array<{ touches: number; status: OutreachStatus; phone: string | null; greeted_at: string | null; permission_at: string | null }>>`
      select touches, status, phone, greeted_at, permission_at from sales_outreach where id = ${id} for update`;
    if (!row) throw new OutreachError("No encontramos ese contacto.");
    if (row.status === "baja") throw new OutreachError("Pidió no recibir más mensajes.");
    if (row.phone) {
      const [blocked] = await tx`select 1 from sales_suppressions where phone = ${row.phone}`;
      if (blocked) throw new OutreachError("Ese número pidió no recibir más mensajes.");
    }
    if (message && row.touches >= MAX_TOUCHES) throw new OutreachError("Ya le escribiste tres veces: mejor esperar a que responda.");
    const open = row.status === "por_contactar" || row.status === "contactado";
    if (channel === "whatsapp" && !opts.before && !opts.touch && row.touches === 0 && !row.greeted_at) {
      const [out] = await tx<Array<{ id: string }>>`
        update sales_outreach set greeted_at = now(), first_contact_at = coalesce(first_contact_at, now()), last_contact_at = now(),
          last_channel = ${channel}, status = case when status = 'por_contactar' then 'contactado' else status end,
          next_action_on = ${open ? today : tx`next_action_on`}, updated_at = now()
        where id = ${id} returning id`;
      await tx`insert into sales_outreach_events (outreach_id, kind, channel, detail) values (${id}, 'mensaje', ${channel}, ${GREETING})`;
      return { id: out.id, event: "prospect_greeting_sent" };
    }
    if (channel === "whatsapp" && !opts.before && !opts.touch && row.touches === 0 && !row.permission_at) {
      const [out] = await tx<Array<{ id: string }>>`
        update sales_outreach set permission_at = now(), last_contact_at = now(), last_channel = ${channel},
          next_action_on = ${open ? addBusinessDays(today, 1) : tx`next_action_on`}, updated_at = now()
        where id = ${id} returning id`;
      await tx`insert into sales_outreach_events (outreach_id, kind, channel, detail) values (${id}, 'mensaje', ${channel}, ${PERMISSION})`;
      return { id: out.id, event: "prospect_permission_sent" };
    }
    const touches = message ? row.touches + 1 : row.touches;
    const next = !open ? undefined : message ? nextFollowUp(today, touches) : row.status === "por_contactar" ? nextFollowUp(today, 1) : undefined;
    const [out] = await tx<Array<{ id: string }>>`
      update sales_outreach set
        touches = ${touches},
        first_contact_at = coalesce(first_contact_at, ${opts.before ? tx`now() - interval '7 days'` : tx`now()`}),
        last_contact_at = now(),
        last_channel = ${channel},
        status = case when status = 'por_contactar' then 'contactado' else status end,
        next_action_on = ${opts.before ? today : next === undefined ? tx`next_action_on` : next},
        updated_at = now()
      where id = ${id} returning id`;
    const detail = opts.before ? "ya le había escrito" : message ? TOUCH_DETAIL[touches - 1] : "";
    await tx`insert into sales_outreach_events (outreach_id, kind, channel, detail)
             values (${id}, ${message ? "mensaje" : channel === "telefono" ? "llamada" : "visita"}, ${channel}, ${detail})`;
    // Para PostHog: la demo (el primer mensaje: el Paso 3 o el Seguimiento 1), un seguimiento o un contacto sin mensaje.
    const event = opts.before ? "prospect_prior_contact_logged" : !message ? "prospect_offline_contact_logged" : touches === 1 ? "prospect_pitch_sent" : "prospect_followup_sent";
    return { id: out.id, event };
  });
  const person = (await getOutreach(updated.id))!;
  prospectEvent(updated.event, person, {
    channel,
    touch_number: person.touches,
    opened_demo: Boolean(person.opened_at),
    tried_demo: Boolean(person.demo_at),
    ...opts.properties,
  });
  return person;
}

export async function setOutreachStatus(id: string, status: OutreachStatus, detail = ""): Promise<void> {
  if (!(OUTREACH_STATUSES as readonly string[]).includes(status)) throw new OutreachError("Estado desconocido.");
  const today = todayKey();
  const changed = await sql.begin(async (tx) => {
    const [row] = await tx<Array<ProspectFacts & { phone: string | null }>>`
      select code, priority, zone, specialty, phone, phone_kind, status, touches from sales_outreach where id = ${id} for update`;
    if (!row) throw new OutreachError("No encontramos ese contacto.");
    if (row.status === status) return null;
    // Al responder, se le contesta hoy; al cerrarse, sale de la cola.
    const next =
      status === "respondio" ? tx`${today}::date`
      : CLOSED.includes(status) ? tx`null`
      : status === "contactado" && row.touches < MAX_TOUCHES ? tx`coalesce(next_action_on, ${today}::date)`
      : tx`next_action_on`;
    await tx`update sales_outreach set status = ${status}, next_action_on = ${next}, updated_at = now() where id = ${id}`;
    await tx`insert into sales_outreach_events (outreach_id, kind, detail) values (${id}, 'estado', ${[status, detail].filter(Boolean).join(": ")})`;
    // La baja vale para todo Turnia: tampoco lo llama Sofi.
    if (status === "baja" && row.phone) {
      await tx`insert into sales_suppressions (phone, reason) values (${row.phone}, 'Pidió no recibir más mensajes (prospección)') on conflict (phone) do nothing`;
    }
    return row;
  });
  if (changed) prospectEvent("prospect_status_changed", { ...changed, status }, { status_from: changed.status, status_to: status, touch_number: changed.touches });
}

export type OutreachEdit = Partial<Pick<Outreach, "name" | "greeting" | "title" | "business_name" | "zone" | "address" | "specialty" | "phone" | "phone_kind" | "instagram" | "email" | "website" | "notes" | "next_action_on" | "agenda_software">> & { priority?: number };

export async function updateOutreach(id: string, edit: OutreachEdit): Promise<void> {
  if (edit.name !== undefined && edit.name.trim().length < 2) throw new OutreachError("Falta el nombre.");
  if (edit.priority !== undefined && ![1, 2, 3].includes(edit.priority)) throw new OutreachError("La prioridad va de 1 a 3.");
  const fields = Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== undefined));
  if (!Object.keys(fields).length) return;
  const [row] = await sql<Array<{ id: string }>>`update sales_outreach set ${sql(fields)}, updated_at = now() where id = ${id} returning id`;
  if (!row) throw new OutreachError("No encontramos ese contacto.");
}

/**
 * Deshace el último contacto registrado (una prueba, o un chat que se abrió y no se mandó): borra
 * ese mensaje, llamada o visita y recalcula el seguimiento. Sin contactos, vuelve a «Por contactar»
 * y deja de contar para la meta.
 */
export async function undoLastTouch(id: string): Promise<void> {
  const undone = await sql.begin(async (tx) => {
    const [row] = await tx<Array<ProspectFacts>>`select code, priority, zone, specialty, phone_kind, status, touches from sales_outreach where id = ${id} for update`;
    if (!row) throw new OutreachError("No encontramos ese contacto.");
    const contacts = () => tx<Array<{ id: string; kind: string; channel: string | null; detail: string; created_at: string }>>`
      select id, kind, channel, detail, created_at from sales_outreach_events
      where outreach_id = ${id} and kind in ('mensaje', 'llamada', 'visita') order by created_at desc`;
    const [last] = await contacts();
    if (!last) throw new OutreachError("No hay contactos para deshacer.");
    await tx`delete from sales_outreach_events where id = ${last.id}`;
    const left = await contacts();
    const isTouch = (e: (typeof left)[number]) => e.kind === "mensaje" && e.detail !== GREETING && e.detail !== PERMISSION;
    const touches = left.filter(isTouch).length;
    const greeting = left.find((e) => e.kind === "mensaje" && e.detail === GREETING);
    const permission = left.find((e) => e.kind === "mensaje" && e.detail === PERMISSION);
    if (!left.length) {
      await tx`
        update sales_outreach set touches = 0, greeted_at = null, permission_at = null, first_contact_at = null, last_contact_at = null, last_channel = null, next_action_on = null,
          status = case when status = 'contactado' then 'por_contactar' else status end, updated_at = now()
        where id = ${id}`;
    } else {
      // El seguimiento se cuenta desde el último mensaje que quedó (o desde la llamada, si no hubo mensajes).
      // Si solo quedó el saludo, el Paso 2 vuelve a tocar desde ese día; si quedó el Paso 2, el Seguimiento 1 al día hábil siguiente.
      const base = left.find(isTouch) ?? permission ?? greeting ?? left[0];
      const from = localDateKey(new Date(base.created_at), TZ);
      const next = row.status !== "contactado" ? undefined
        : touches ? nextFollowUp(from, touches)
        : permission ? addBusinessDays(from, 1)
        : greeting ? from
        : nextFollowUp(from, 1);
      await tx`
        update sales_outreach set touches = ${touches}, greeted_at = ${greeting?.created_at ?? null}, permission_at = ${permission?.created_at ?? null},
          last_contact_at = ${left[0].created_at}, last_channel = ${left[0].channel},
          next_action_on = ${next === undefined ? tx`next_action_on` : next}, updated_at = now()
        where id = ${id}`;
    }
    await tx`insert into sales_outreach_events (outreach_id, kind, detail) values (${id}, 'nota', 'Se deshizo un contacto (prueba o error).')`;
    return { row: { ...row, touches }, kind: last.kind, greeting: last.detail === GREETING ? "saludo" : last.detail === PERMISSION ? "permiso" : null };
  });
  // PostHog no borra eventos: queda registrado que el anterior fue una prueba o un error.
  prospectEvent("prospect_contact_undone", undone.row, { contact_kind: undone.greeting ?? undone.kind, touch_number: undone.row.touches });
}

/**
 * Desmarca el último audio de seguimiento (se tocó por error). Si ese audio sumó uno de los tres mensajes
 * (no había salido otro ese día), también se deshace ese contacto, siempre que siga siendo el último.
 */
export async function undoAudio(id: string): Promise<void> {
  const counted = await sql.begin(async (tx) => {
    const [audio] = await tx<Array<{ id: string; detail: string; created_at: string }>>`
      select id, detail, created_at from sales_outreach_events
      where outreach_id = ${id} and kind = 'nota' and detail like 'Audio de seguimiento%' order by created_at desc limit 1 for update`;
    if (!audio) throw new OutreachError("No hay un audio para desmarcar.");
    await tx`delete from sales_outreach_events where id = ${audio.id}`;
    await tx`insert into sales_outreach_events (outreach_id, kind, detail) values (${id}, 'nota', 'Se desmarcó un audio (error).')`;
    if (audio.detail.includes("con el mensaje del día")) return false;
    // El contacto del audio se registra justo antes que su nota: es el último contacto y salió en esos segundos.
    const [last] = await tx<Array<{ created_at: string }>>`
      select created_at from sales_outreach_events
      where outreach_id = ${id} and kind in ('mensaje', 'llamada', 'visita') order by created_at desc limit 1`;
    if (!last) return false;
    const gap = new Date(audio.created_at).getTime() - new Date(last.created_at).getTime();
    return gap >= 0 && gap <= 30_000;
  });
  if (counted) await undoLastTouch(id);
  await sql`update sales_outreach set updated_at = now() where id = ${id}`;
}

export async function addOutreachNote(id: string, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  if (clean.length > 2000) throw new OutreachError("La nota es demasiado larga.");
  await sql`insert into sales_outreach_events (outreach_id, kind, detail) values (${id}, 'nota', ${clean})`;
  await sql`update sales_outreach set updated_at = now() where id = ${id}`;
}

/** Abrió su link de demo (lo avisa el navegador; los robots de las vistas previas no corren JavaScript). */
export async function recordOpen(code: string): Promise<boolean> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code)) return false;
  const [row] = await sql<Array<{ id: string }>>`
    update sales_outreach set opens = opens + 1, opened_at = coalesce(opened_at, now()), updated_at = now()
    where code = ${code} returning id`;
  if (!row) return false;
  await sql`
    insert into sales_outreach_events (outreach_id, kind)
    select ${row.id}, 'abrio' where not exists (
      select 1 from sales_outreach_events where outreach_id = ${row.id} and kind = 'abrio' and created_at > now() - interval '6 hours')`;
  return true;
}

/** Empezó la demo desde su link: queda el pedido de demo y el seguimiento pasa a hoy. */
export async function recordDemo(code: string, leadId: string | null): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code)) return;
  const today = todayKey();
  const [row] = await sql<Array<{ id: string }>>`
    update sales_outreach set demo_at = coalesce(demo_at, now()), lead_id = coalesce(lead_id, ${leadId}),
      next_action_on = case when status = 'contactado' then ${today}::date else next_action_on end, updated_at = now()
    where code = ${code} returning id`;
  if (row) await sql`insert into sales_outreach_events (outreach_id, kind) values (${row.id}, 'demo')`;
}

const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "consultorio";

function newCode(name: string): string {
  const surname = name.split(/\s+/).filter((w) => w.length > 2).slice(-1)[0] ?? name;
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const suffix = [...randomBytes(5)].map((b) => alphabet[b % alphabet.length]).join("");
  return `${slug(surname)}-${suffix}`;
}

/**
 * Importa la lista. Las personas que ya estaban (mismo código, o mismo nombre y teléfono) solo
 * completan los datos que les faltan y suman las notas nuevas: no se pisa lo que se corrigió en el
 * panel. Con `overwrite`, lo que trae el archivo reemplaza a lo cargado. El nombre, el estado y los
 * contactos no cambian nunca.
 */
export async function importOutreach(
  rows: OutreachImportRow[],
  { overwrite = false } = {},
): Promise<{ created: number; updated: number; codes: string[] }> {
  if (!rows.length) return { created: 0, updated: 0, codes: [] };
  const existing = await sql<Array<{ code: string; name: string; phone: string | null }>>`select code, lower(name) as name, phone from sales_outreach`;
  const byCode = new Set(existing.map((e) => e.code));
  const byPerson = new Map(existing.map((e) => [`${e.name}|${e.phone ?? ""}`, e.code]));
  const seen = new Set<string>();
  const records: Array<Omit<OutreachImportRow, "line">> = [];
  for (const r of rows) {
    const code = (r.code && byCode.has(r.code) ? r.code : null) ?? byPerson.get(`${r.name.toLowerCase()}|${r.phone ?? ""}`) ?? r.code ?? newCode(r.name);
    if (seen.has(code)) continue;
    seen.add(code);
    records.push({
      code, name: r.name, greeting: r.greeting, title: r.title, business_name: r.business_name, zone: r.zone, address: r.address,
      specialty: r.specialty, phone: r.phone, phone_kind: r.phone_kind, instagram: r.instagram, email: r.email, website: r.website,
      priority: r.priority, signals: r.signals, source: r.source, notes: r.notes,
    });
  }
  const created: string[] = [];
  const updated: string[] = [];
  await sql.begin(async (tx) => {
    for (let i = 0; i < records.length; i += 500) {
      // A quien se crea: su primer nombre como saludo y prioridad 2 si el archivo no dice otra cosa.
      const chunk = records.slice(i, i + 500).map((r) => ({ ...r, greeting: r.greeting || r.name.split(" ")[0], priority: r.priority ?? 2 }));
      const result = await tx<Array<{ code: string; inserted: boolean }>>`
        insert into sales_outreach ${tx(chunk)}
        on conflict (code) do update set
          name = sales_outreach.name,
          greeting = case when sales_outreach.greeting = '' then excluded.greeting else sales_outreach.greeting end,
          title = case when sales_outreach.title = '' then excluded.title else sales_outreach.title end,
          business_name = case when sales_outreach.business_name = '' then excluded.business_name else sales_outreach.business_name end,
          zone = case when sales_outreach.zone = '' then excluded.zone else sales_outreach.zone end,
          address = case when sales_outreach.address = '' then excluded.address else sales_outreach.address end,
          specialty = case when sales_outreach.specialty = '' then excluded.specialty else sales_outreach.specialty end,
          phone = coalesce(sales_outreach.phone, excluded.phone),
          phone_kind = case when sales_outreach.phone is null then excluded.phone_kind else sales_outreach.phone_kind end,
          instagram = coalesce(sales_outreach.instagram, excluded.instagram),
          email = coalesce(sales_outreach.email, excluded.email),
          website = coalesce(sales_outreach.website, excluded.website),
          signals = case when sales_outreach.signals = '' then excluded.signals else sales_outreach.signals end,
          source = case when sales_outreach.source = '' then excluded.source else sales_outreach.source end,
          notes = case
            when excluded.notes = '' or position(excluded.notes in sales_outreach.notes) > 0 then sales_outreach.notes
            when sales_outreach.notes = '' then excluded.notes
            else sales_outreach.notes || E'\n' || excluded.notes end,
          updated_at = now()
        returning code, (xmax = 0) as inserted`;
      created.push(...result.filter((r) => r.inserted).map((r) => r.code));
      updated.push(...result.filter((r) => !r.inserted).map((r) => r.code));
    }
    if (overwrite) {
      const byRecord = new Map(records.map((r) => [r.code, r]));
      for (const code of updated) {
        const fields = fromFile(byRecord.get(code)!);
        if (Object.keys(fields).length) await tx`update sales_outreach set ${tx(fields)}, updated_at = now() where code = ${code}`;
      }
    }
  });
  return { created: created.length, updated: updated.length, codes: [...created, ...updated] };
}

/** Lo que el archivo trae con dato, para reemplazar a lo cargado (el nombre no se toca). */
function fromFile(r: Omit<OutreachImportRow, "line">) {
  const keys = ["greeting", "title", "business_name", "zone", "address", "specialty", "instagram", "email", "website", "priority", "signals", "source"] as const;
  const fields = Object.fromEntries(keys.filter((key) => r[key]).map((key) => [key, r[key]]));
  return r.phone ? { ...fields, phone: r.phone, phone_kind: r.phone_kind } : fields;
}
