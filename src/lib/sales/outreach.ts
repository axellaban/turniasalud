import "server-only";
import { randomBytes } from "node:crypto";
import { json, sql } from "@/lib/db";
import { env } from "@/lib/env";
import { DEFAULT_TZ, localDateKey } from "@/lib/time";
import type { OutreachImportRow } from "./outreach-import";
import {
  CLOSED,
  DEFAULT_TEMPLATES,
  MAX_TOUCHES,
  OUTREACH_STATUSES,
  TEMPLATE_KEYS,
  demoUrl,
  mergeTemplates,
  nextFollowUp,
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
  created_at: string;
  /** Otras personas con el mismo teléfono (un consultorio con varios odontólogos). */
  shared: Array<{ name: string; touched: boolean }>;
  suppressed: boolean;
};

export type OutreachEvent = { id: string; kind: string; channel: string | null; detail: string; created_at: string };

export type OutreachSettings = { templates: Templates; daily_goal: number; weekly_goal: number };

const TZ = DEFAULT_TZ;
export const todayKey = () => localDateKey(new Date(), TZ);
export const outreachDemoUrl = (code: string) => demoUrl(env.appUrl(), code);

// Se arma en cada consulta: el cliente de la base se conecta recién en la primera.
const withExtras = () => sql`
  o.*,
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
      (select count(*)::int from sales_outreach_events e where e.kind = 'mensaje' and e.detail in ('seguimiento', 'último')
         and (e.created_at at time zone ${TZ})::date = ${today}::date) as today_followups,
      count(*) filter (where (first_contact_at at time zone ${TZ})::date >= ${monday}::date)::int as week_new,
      count(*) filter (where first_contact_at is not null)::int as contacted,
      count(*) filter (where status in ('respondio', 'reunion', 'cliente', 'no_interesa', 'baja'))::int as replied,
      count(*) filter (where opened_at is not null)::int as opened,
      count(*) filter (where demo_at is not null)::int as demos,
      count(*) filter (where status = 'reunion')::int as meetings,
      count(*) filter (where status = 'cliente')::int as clients,
      count(*) filter (where status = 'contactado' and touches < ${MAX_TOUCHES} and next_action_on <= ${today}::date)::int as due_followups,
      count(*) filter (where status = 'por_contactar')::int as pending,
      count(*) filter (where status in ('respondio', 'reunion') or (status = 'contactado' and (opened_at is not null or demo_at is not null)))::int as interested
    from sales_outreach`;
  return row;
}

export type OutreachView = "hoy" | "seguimientos" | "interesados" | "todos";
export type OutreachFilter = { view: OutreachView; zone?: string | null; q?: string | null; channel?: string | null; status?: string | null; page?: number };
export const PAGE_SIZE = 50;

/** Contactable: con WhatsApp o Instagram, sin baja y sin que otra persona del mismo número ya haya recibido el mensaje. */
const contactable = () => sql`
  (o.phone is not null or o.instagram is not null)
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
    where o.status = 'contactado' and o.touches < ${MAX_TOUCHES} and o.next_action_on <= ${today}::date
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
  const order =
    f.view === "interesados" ? sql`order by greatest(o.last_contact_at, o.opened_at, o.demo_at, o.updated_at) desc nulls last`
    : f.view === "seguimientos" ? sql`order by o.next_action_on nulls last, o.name`
    : sql`order by o.priority, o.status <> 'por_contactar', o.name`;
  const page = Math.max(0, (f.page ?? 1) - 1);
  const [{ count }] = await sql<Array<{ count: number }>>`select count(*)::int as count from sales_outreach o where true ${view} ${filters(f)}`;
  const rows = await sql<Outreach[]>`
    select ${withExtras()} from sales_outreach o where true ${view} ${filters(f)}
    ${order} limit ${PAGE_SIZE} offset ${page * PAGE_SIZE}`;
  return { rows, total: count };
}

export async function outreachZones(): Promise<Array<{ zone: string; count: number }>> {
  return sql<Array<{ zone: string; count: number }>>`
    select zone, count(*)::int as count from sales_outreach where zone <> '' group by zone order by count(*) desc`;
}

export async function getOutreach(id: string): Promise<Outreach | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<Outreach[]>`select ${withExtras()} from sales_outreach o where o.id = ${id}`;
  return row ?? null;
}

/** Lo que muestra la página pública de su demo: sin teléfono, notas ni estado. */
export type PublicOutreach = Pick<Outreach, "code" | "name" | "greeting" | "title" | "business_name" | "zone" | "address" | "website">;

export async function publicOutreach(code: string): Promise<PublicOutreach | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code)) return null;
  const [row] = await sql<PublicOutreach[]>`
    select code, name, greeting, title, business_name, zone, address, website from sales_outreach where code = ${code}`;
  return row ?? null;
}

export async function outreachEvents(id: string): Promise<OutreachEvent[]> {
  return sql<OutreachEvent[]>`select id, kind, channel, detail, created_at from sales_outreach_events where outreach_id = ${id} order by created_at desc limit 100`;
}

const TOUCH_DETAIL = ["primero", "seguimiento", "último"];

/**
 * Registra un contacto. Un mensaje (WhatsApp, Instagram, email) suma un toque y programa el
 * seguimiento; una llamada o una visita quedan en la historia sin consumir los mensajes.
 * `before`: le había escrito antes de usar el panel (no cuenta para la meta de hoy).
 */
export async function recordTouch(id: string, channel: OutreachChannel, opts: { before?: boolean } = {}): Promise<Outreach> {
  const today = todayKey();
  const message = channel === "whatsapp" || channel === "instagram" || channel === "email";
  const updated = await sql.begin(async (tx) => {
    const [row] = await tx<Array<{ touches: number; status: OutreachStatus; phone: string | null }>>`
      select touches, status, phone from sales_outreach where id = ${id} for update`;
    if (!row) throw new OutreachError("No encontramos ese contacto.");
    if (row.status === "baja") throw new OutreachError("Pidió no recibir más mensajes.");
    if (row.phone) {
      const [blocked] = await tx`select 1 from sales_suppressions where phone = ${row.phone}`;
      if (blocked) throw new OutreachError("Ese número pidió no recibir más mensajes.");
    }
    if (message && row.touches >= MAX_TOUCHES) throw new OutreachError("Ya le escribiste tres veces: mejor esperar a que responda.");
    const touches = message ? row.touches + 1 : row.touches;
    const open = row.status === "por_contactar" || row.status === "contactado";
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
    return out;
  });
  return (await getOutreach(updated.id))!;
}

export async function setOutreachStatus(id: string, status: OutreachStatus, detail = ""): Promise<void> {
  if (!(OUTREACH_STATUSES as readonly string[]).includes(status)) throw new OutreachError("Estado desconocido.");
  const today = todayKey();
  await sql.begin(async (tx) => {
    const [row] = await tx<Array<{ phone: string | null; status: OutreachStatus; touches: number }>>`
      select phone, status, touches from sales_outreach where id = ${id} for update`;
    if (!row) throw new OutreachError("No encontramos ese contacto.");
    if (row.status === status) return;
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
  });
}

export type OutreachEdit = Partial<Pick<Outreach, "name" | "greeting" | "title" | "business_name" | "zone" | "address" | "specialty" | "phone" | "phone_kind" | "instagram" | "email" | "website" | "notes" | "next_action_on">> & { priority?: number };

export async function updateOutreach(id: string, edit: OutreachEdit): Promise<void> {
  if (edit.name !== undefined && edit.name.trim().length < 2) throw new OutreachError("Falta el nombre.");
  if (edit.priority !== undefined && ![1, 2, 3].includes(edit.priority)) throw new OutreachError("La prioridad va de 1 a 3.");
  const fields = Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== undefined));
  if (!Object.keys(fields).length) return;
  const [row] = await sql<Array<{ id: string }>>`update sales_outreach set ${sql(fields)}, updated_at = now() where id = ${id} returning id`;
  if (!row) throw new OutreachError("No encontramos ese contacto.");
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
 * completan los datos que les faltan: no se pisa lo que se corrigió en el panel ni su estado.
 */
export async function importOutreach(rows: OutreachImportRow[]): Promise<{ created: number; updated: number }> {
  if (!rows.length) return { created: 0, updated: 0 };
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
  let created = 0;
  let updated = 0;
  await sql.begin(async (tx) => {
    for (let i = 0; i < records.length; i += 500) {
      const result = await tx<Array<{ inserted: boolean }>>`
        insert into sales_outreach ${tx(records.slice(i, i + 500))}
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
          notes = case when sales_outreach.notes = '' then excluded.notes else sales_outreach.notes end,
          updated_at = now()
        returning (xmax = 0) as inserted`;
      created += result.filter((r) => r.inserted).length;
      updated += result.filter((r) => !r.inserted).length;
    }
  });
  return { created, updated };
}
