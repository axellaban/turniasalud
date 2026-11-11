import "server-only";
import { json, sql } from "@/lib/db";
import { DEFAULT_TZ, localDateKey } from "@/lib/time";
import { AXEL_WHATSAPP } from "./contacto-axel";
import { addBusinessDays, nextFollowUp } from "./outreach-messages";
import { WHATSAPP_SYNC_ACTOR, todayKey } from "./outreach";
import { incomingReply } from "./followup-queue";
import { listProspectChats, phoneFromChatId, prospectWaha, voiceChannelStatus, waha, type ProspectWaha } from "./voice-outreach";

// La lectura diaria de WhatsApp: los chats de las dos líneas de la prospección (WAHA_PROSPECCION y
// WAHA_PROSPECCION_5483), cruzados con la base. Por cada persona con chat se guarda qué se le mandó y
// qué contestó (sales_whatsapp_chats) y, si contestó algo nuevo, pasa a «Respuestas para atender» con
// su texto. Solo lee: no manda, no marca como leído y no cambia nada en WAHA.
// La dispara Chapa Labs una vez por día (y su botón «Leer WhatsApp ahora»).

export const SYNC_ACTOR = WHATSAPP_SYNC_ACTOR;
/** Entre dos lecturas: si se pide antes, se devuelve la última. */
const MIN_MINUTES = 10;
const MESSAGES = 50;
const PARALLEL = 8;
/** Para no pasar el tiempo de la función (300 s) con la lista de chats y los @lid incluidos. */
const BUDGET_MS = 150_000;

type Message = {
  id?: string | { _serialized?: string };
  timestamp?: number;
  fromMe?: boolean;
  body?: string | null;
  hasMedia?: boolean;
  media?: { mimetype?: string | null } | null;
  type?: string;
  _data?: { type?: string } | null;
};

export type LineReport = {
  line: string;
  status: "ok" | "sin_configurar" | "error";
  problem?: string;
  chats?: number;
  prospects?: number;
  read?: number;
  unread?: number;
};

export type PendingReply = { code: string; name: string; line: string; at: string; text: string; status: string };

export type SyncReport = {
  at: string;
  trigger: string;
  reused?: boolean;
  lines: LineReport[];
  totals: {
    /** Personas de la base con chat en alguna línea donde les escribimos. */
    conversaciones: number;
    /** De esas, cuántas contestaron alguna vez. */
    respondieron: number;
    /** Contestaron y el último mensaje es de ellas: falta contestarles. */
    esperanRespuesta: number;
    /** Respuestas que no estaban leídas en la lectura anterior. */
    nuevas: number;
    /** Personas que pasaron a «Respuestas para atender» con esta lectura. */
    abiertas: number;
    /** Personas que una lectura anterior abrió por una respuesta automática y volvieron a como estaban. */
    corregidas: number;
    /** Personas sin nada registrado a las que ya les habíamos escrito por fuera del panel (quedaron registradas). */
    registradas?: number;
  };
  /** Las que esperan respuesta, de la más vieja a la más nueva (hasta 60). */
  pending: PendingReply[];
};

const seconds = (t: number | undefined) => (!t ? 0 : t > 1e12 ? Math.floor(t / 1000) : t);
const iso = (s: number) => new Date(s * 1000).toISOString();

/** Lo que se ve de un mensaje: su texto, o qué era si no tiene («Audio», «Imagen», «Archivo»). */
export function messageText(m: Message): string {
  const body = (m.body ?? "").trim();
  if (body) return body.slice(0, 2000);
  if (!m.hasMedia) return "";
  const kind = `${m.media?.mimetype ?? ""} ${m.type ?? ""} ${m._data?.type ?? ""}`.toLowerCase();
  if (/audio|ptt|voice/.test(kind)) return "Audio";
  if (/image|sticker/.test(kind)) return "Imagen";
  if (/video/.test(kind)) return "Video";
  return "Archivo";
}

// Las respuestas automáticas de WhatsApp Business («Gracias por comunicarte…», «fuera del horario de
// atención») y los avisos del sistema («Esta empresa usa un servicio seguro de Meta…») no son una
// respuesta de la persona: no abren nada ni cuentan como «respondió».
// Chapa Labs tiene una copia en prospecting/core.js (isAutomaticReply): si cambia una, cambiar la otra.
const AUTOMATIC = /respuesta autom[aá]tica|mensaje autom[aá]tico|fuera (del|de) (nuestro )?horario|(este|[eé]ste|ese) momento no (podemos|nos es posible|estamos)|no (podemos|pudimos) (atender|responder|contestar)|(te|le|les) (responderemos|contestaremos|responderé|contestaré)|horarios? de atenci[oó]n|nuestros? horarios?\b|a la brevedad|lo antes posible|dej[aá](nos|me|n) (tu|su) (consulta|mensaje|nombre)|nos encontramos (fuera|cerrados)|para (pedir |solicitar )?turnos?,? (comunicate|comuníquese|llam)|gracias por (comunicar(te|se|nos)|contactar(te|se|nos)|escribir(nos)?) (con|a)\b|esta empresa (usa|utiliza|trabaja con)|servicio seguro de meta|nos (comunicaremos|pondremos en contacto)/i;
const AUTOMATIC_OPENER = /^\W*(hola\W+)?(muchas )?gracias por (tu |su )?(comunicar|escrib|contact|mensaje)/i;
const WELCOME = /^\W*(hola\W+)?bienvenid[oa]s?\b/i;
/** ¿Es una respuesta automática (de bienvenida o de ausencia) de WhatsApp Business, o un aviso del sistema? */
export const isAutomaticReply = (text: string) =>
  AUTOMATIC.test(text) || (AUTOMATIC_OPENER.test(text) && text.length > 60) || (WELCOME.test(text) && text.length > 25);

export type ChatSummary = {
  sent: number;
  received: number;
  /** Respuestas automáticas (no cuentan en nada más). */
  automatic: number;
  firstSentAt: number | null;
  lastSentAt: number | null;
  repliedAt: number | null;
  lastReceivedAt: number | null;
  lastReceivedText: string | null;
  lastFromMe: boolean | null;
  /** Lo que contestó después de `since` (segundos), del más viejo al más nuevo. */
  newReplies: Array<{ at: number; text: string }>;
  /** Nuestros mensajes, del más viejo al más nuevo (para reconstruir los pasos que salieron por fuera del panel). */
  ours: Array<{ at: number; text: string }>;
};

/**
 * Qué pasó en un chat. Solo cuenta como respuesta lo que llegó después de nuestro primer mensaje
 * (si escribió antes por otra cosa, no es una respuesta a la prospección). `hadSent`: en una lectura
 * anterior ya había mensajes nuestros que ahora quedaron fuera de los últimos 50.
 */
export function summarizeChat(messages: Message[], since: number | null, hadSent = false): ChatSummary {
  const all = messages
    .map((m) => ({ at: seconds(m.timestamp), fromMe: Boolean(m.fromMe), text: messageText(m) }))
    .filter((m) => m.at > 0 && (m.text || m.fromMe));
  const automatic = all.filter((m) => !m.fromMe && isAutomaticReply(m.text)).length;
  const list = all.filter((m) => m.fromMe || !isAutomaticReply(m.text)).sort((a, b) => a.at - b.at);
  const mine = list.filter((m) => m.fromMe);
  const firstSent = mine[0]?.at ?? null;
  const replies = list.filter((m) => !m.fromMe && m.text && (firstSent !== null ? m.at > firstSent : hadSent));
  const last = list.at(-1);
  return {
    sent: mine.length,
    received: replies.length,
    automatic,
    firstSentAt: firstSent,
    lastSentAt: mine.at(-1)?.at ?? null,
    repliedAt: replies[0]?.at ?? null,
    lastReceivedAt: replies.at(-1)?.at ?? null,
    lastReceivedText: replies.at(-1)?.text ?? null,
    lastFromMe: last ? last.fromMe : null,
    newReplies: replies.filter((m) => since === null || m.at > since),
    ours: mine.map((m) => ({ at: m.at, text: m.text })),
  };
}

/** El link de la demo personal (/p/<código>): desde ese mensaje empiezan los tres que cuentan. */
const DEMO_LINK = /\/p\/[a-z0-9-]{3,}/i;

export type ChatSteps = { greetingAt: number | null; permissionAt: number | null; touches: number[] };

/**
 * Los pasos de la secuencia que ya salieron en un chat, para quien no tiene nada registrado: antes del
 * link, el primero es el saludo (Paso 1) y el segundo el pedido de permiso (Paso 2); el mensaje con el
 * link es el primero de los tres y cada uno de los siguientes, un seguimiento (hasta tres).
 */
export function stepsFromChat(ours: Array<{ at: number; text: string }>): ChatSteps {
  const link = ours.findIndex((m) => DEMO_LINK.test(m.text));
  const before = link === -1 ? ours : ours.slice(0, link);
  return {
    greetingAt: before[0]?.at ?? null,
    permissionAt: before[1]?.at ?? null,
    touches: link === -1 ? [] : ours.slice(link, link + 3).map((m) => m.at),
  };
}

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** ¿El mensaje nombra a esta persona (su apellido o su consultorio)? Para elegir entre dos que comparten el número. */
export function mentions(text: string, p: { name: string; business_name?: string | null }): boolean {
  const t = fold(text);
  const surname = fold(p.name.trim().split(/\s+/).at(-1) ?? "");
  const business = fold(p.business_name ?? "");
  return (surname.length >= 4 && t.includes(surname)) || (business.length >= 5 && t.includes(business));
}

async function inParallel<T>(items: T[], n: number, fn: (item: T) => Promise<void>, deadline: number): Promise<number> {
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length && Date.now() < deadline) {
      const item = items[next++];
      await fn(item);
      done++;
    }
  }));
  return done;
}

type Person = { id: string; code: string; name: string; status: string; phone: string; business_name: string | null; touches: number; greeted: boolean };
type Prev = { outreach_id: string; sent: number; last_received_at: string | null };

/** Las líneas de la prospección configuradas, sin repetir el número. */
function lines(): Array<{ ending: string | undefined; label: string }> {
  const out: Array<{ ending: string | undefined; label: string }> = [];
  const seen = new Set<string>();
  for (const ending of [undefined, AXEL_WHATSAPP.slice(-4)]) {
    let phone: string | undefined;
    try { phone = prospectWaha(ending)?.phone; } catch { /* el estado de la línea explica el error */ }
    const label = phone ? phone.slice(-4) : ending ?? "WAHA_PROSPECCION";
    if (phone && seen.has(phone)) continue;
    if (phone) seen.add(phone);
    out.push({ ending, label });
  }
  return out;
}

export async function lastWhatsappSync(): Promise<SyncReport | null> {
  const [row] = await sql<Array<{ report: SyncReport }>>`
    select report from sales_whatsapp_syncs where finished_at is not null order by started_at desc limit 1`;
  return row?.report ?? null;
}

/** Lee los chats de las dos líneas y registra las respuestas nuevas. */
export async function syncWhatsappReplies(trigger: string): Promise<SyncReport> {
  const [recent] = await sql<Array<{ report: SyncReport; finished: boolean }>>`
    select report, finished_at is not null as finished from sales_whatsapp_syncs
    where started_at > now() - make_interval(mins => ${MIN_MINUTES}) order by started_at desc limit 1`;
  if (recent?.finished) return { ...recent.report, reused: true };
  if (recent) throw new Error("Ya se están leyendo los chats: probá en unos minutos.");
  const [run] = await sql<Array<{ id: string }>>`insert into sales_whatsapp_syncs (trigger) values (${trigger.slice(0, 80)}) returning id`;

  const deadline = Date.now() + BUDGET_MS;
  const report: SyncReport = {
    at: new Date().toISOString(),
    trigger,
    lines: [],
    totals: { conversaciones: 0, respondieron: 0, esperanRespuesta: 0, nuevas: 0, abiertas: 0, corregidas: 0, registradas: 0 },
    pending: [],
  };
  try {
    for (const { ending, label } of lines()) {
      const status = await voiceChannelStatus(ending);
      if (!status.configured) { report.lines.push({ line: label, status: "sin_configurar" }); continue; }
      if (!status.ok) { report.lines.push({ line: label, status: "error", problem: status.problem ?? "WAHA no está listo." }); continue; }
      try {
        report.lines.push(await syncLine(prospectWaha(ending)!, label, deadline, report));
      } catch (e) {
        report.lines.push({ line: label, status: "error", problem: e instanceof Error ? e.message : String(e) });
      }
    }
    await totals(report);
  } finally {
    await sql`update sales_whatsapp_syncs set finished_at = now(), report = ${json(report)} where id = ${run.id}`;
  }
  return report;
}

async function syncLine(config: ProspectWaha, label: string, deadline: number, report: SyncReport): Promise<LineReport> {
  const sender = config.phone!;
  const contacted = async () => (await sql<Array<{ phone: string }>>`
    select distinct phone from sales_outreach
    where phone is not null and phone_kind is distinct from 'fijo' and last_contact_at is not null
    order by phone limit 1500`).map((r) => r.phone);
  const chats = await listProspectChats(config, contacted);
  const digits = [...chats.byPhone.keys()].map((p) => p.replace(/\D/g, ""));
  const people = await sql<Person[]>`
    select id, code, name, status, phone, business_name, touches, (greeted_at is not null or permission_at is not null) as greeted from sales_outreach
    where phone is not null and regexp_replace(phone, '[^0-9]', '', 'g') = any(${digits}::text[])`;
  const samePhone = new Map<string, Person[]>();
  for (const p of people) samePhone.set(p.phone, [...(samePhone.get(p.phone) ?? []), p]);
  const prev = new Map((await sql<Prev[]>`
    select outreach_id, sent, last_received_at::text from sales_whatsapp_chats where sender_phone = ${sender}`).map((p) => [p.outreach_id, p]));
  const session = encodeURIComponent(config.session);

  const read = await inParallel(people, PARALLEL, async (person) => {
    const chatId = chats.byPhone.get(person.phone);
    if (!chatId) return;
    let messages: Message[];
    try {
      const res = await waha(config, `/api/${session}/chats/${encodeURIComponent(chatId)}/messages?limit=${MESSAGES}&downloadMedia=false`, { signal: AbortSignal.timeout(15000) });
      messages = (await res.json()) as Message[];
    } catch (e) {
      console.error("mensajes de un chat de la prospección", e instanceof Error ? e.message.slice(0, 160) : e);
      return;
    }
    const before = prev.get(person.id);
    const since = before?.last_received_at ? Math.floor(Date.parse(before.last_received_at) / 1000) : null;
    const s = summarizeChat(Array.isArray(messages) ? messages : [], since, (before?.sent ?? 0) > 0);
    if (!s.sent && !before) return; // un chat donde nunca le escribimos desde esta línea
    const at = (v: number | null) => (v === null ? null : iso(v));
    // Con menos de 50 mensajes se ve el chat entero: lo leído reemplaza lo guardado. Si no, se suma.
    const complete = Array.isArray(messages) && messages.length < MESSAGES;
    await sql`
      insert into sales_whatsapp_chats (outreach_id, sender_phone, chat_id, sent, received, first_sent_at, last_sent_at, replied_at, last_received_at, last_received_text, last_from_me, synced_at)
      values (${person.id}, ${sender}, ${chatId}, ${s.sent}, ${s.received}, ${at(s.firstSentAt)}, ${at(s.lastSentAt)}, ${at(s.repliedAt)}, ${at(s.lastReceivedAt)}, ${s.lastReceivedText}, ${s.lastFromMe}, now())
      on conflict (outreach_id, sender_phone) do update set
        chat_id = excluded.chat_id,
        sent = greatest(sales_whatsapp_chats.sent, excluded.sent),
        received = case when ${complete} then excluded.received else greatest(sales_whatsapp_chats.received, excluded.received) end,
        first_sent_at = coalesce(least(sales_whatsapp_chats.first_sent_at, excluded.first_sent_at), sales_whatsapp_chats.first_sent_at, excluded.first_sent_at),
        last_sent_at = coalesce(greatest(sales_whatsapp_chats.last_sent_at, excluded.last_sent_at), sales_whatsapp_chats.last_sent_at, excluded.last_sent_at),
        replied_at = case when ${complete} then excluded.replied_at else coalesce(least(sales_whatsapp_chats.replied_at, excluded.replied_at), sales_whatsapp_chats.replied_at, excluded.replied_at) end,
        last_received_at = case when ${complete} then excluded.last_received_at else coalesce(excluded.last_received_at, sales_whatsapp_chats.last_received_at) end,
        last_received_text = case when ${complete} then excluded.last_received_text else coalesce(excluded.last_received_text, sales_whatsapp_chats.last_received_text) end,
        last_from_me = case when ${complete} then excluded.last_from_me else coalesce(excluded.last_from_me, sales_whatsapp_chats.last_from_me) end,
        synced_at = now()`;
    // Lo que se le mandó por fuera del panel (desde el celular o WhatsApp Web) queda registrado, así no
    // vuelve a la cola como si nunca le hubiéramos escrito. Solo con el chat entero y si no tiene nada
    // registrado; si comparten el número, solo a quien nombra el saludo y si nadie más fue contactado.
    if (complete && s.ours.length && !person.touches && !person.greeted && (person.status === "por_contactar" || person.status === "contactado")) {
      const others = (samePhone.get(person.phone) ?? []).filter((p) => p.id !== person.id);
      const first = s.ours[0].text;
      const mine = !others.length || (!others.some((p) => p.touches || p.greeted) && mentions(first, person) && !others.some((p) => mentions(first, p)));
      if (mine) {
        try {
          if (await registerFromChat(person.id, person.phone, sender, stepsFromChat(s.ours))) report.totals.registradas = (report.totals.registradas ?? 0) + 1;
        } catch (e) {
          console.error("pasos leídos de WhatsApp", e instanceof Error ? e.message.slice(0, 160) : e);
        }
      }
    }
    if (complete && !s.received && (await undoAutomaticOpen(person.id))) report.totals.corregidas++;
    if (s.newReplies.length) {
      report.totals.nuevas += s.newReplies.length;
      const text = s.newReplies.map((r) => r.text).join("\n").slice(0, 2000);
      try {
        if ((await incomingReply(person.id, text, SYNC_ACTOR)) === "abierta") report.totals.abiertas++;
      } catch (e) {
        console.error("respuesta leída de WhatsApp", e instanceof Error ? e.message.slice(0, 160) : e);
      }
    }
  }, deadline);

  return { line: label, status: "ok", chats: chats.ids.length, prospects: people.length, read, unread: people.length - read };
}

/**
 * Registra los pasos que salieron por fuera del panel (ver stepsFromChat), con su fecha, a quien no
 * tiene nada registrado. Confirma la línea para su número. Devuelve si registró algo.
 */
async function registerFromChat(id: string, phone: string, sender: string, steps: ChatSteps): Promise<boolean> {
  const all = [steps.greetingAt, steps.permissionAt, ...steps.touches].filter((v): v is number => v !== null);
  if (!all.length) return false;
  const first = Math.min(...all);
  const last = Math.max(...all);
  const lastDay = localDateKey(new Date(last * 1000), DEFAULT_TZ);
  const today = todayKey();
  const n = steps.touches.length;
  const next = n ? nextFollowUp(lastDay, n) : steps.permissionAt ? addBusinessDays(lastDay, 1) : today;
  return sql.begin(async (tx) => {
    const [row] = await tx<Array<{ touches: number; status: string; greeted: boolean }>>`
      select touches, status, (greeted_at is not null or permission_at is not null) as greeted from sales_outreach where id = ${id} for update`;
    if (!row || row.touches || row.greeted || (row.status !== "por_contactar" && row.status !== "contactado")) return false;
    await tx`
      update sales_outreach set
        greeted_at = ${steps.greetingAt === null ? null : iso(steps.greetingAt)},
        permission_at = ${steps.permissionAt === null ? null : iso(steps.permissionAt)},
        touches = ${n},
        first_contact_at = coalesce(first_contact_at, ${iso(first)}),
        last_contact_at = greatest(coalesce(last_contact_at, ${iso(last)}), ${iso(last)}),
        last_channel = 'whatsapp',
        status = case when status = 'por_contactar' then 'contactado' else status end,
        next_action_on = ${next === null ? null : next < today ? today : next},
        updated_at = now()
      where id = ${id}`;
    const events: Array<[number, string]> = [
      ...(steps.greetingAt === null ? [] : [[steps.greetingAt, "saludo"] as [number, string]]),
      ...(steps.permissionAt === null ? [] : [[steps.permissionAt, "permiso"] as [number, string]]),
      ...steps.touches.map((at, i) => [at, ["primero", "seguimiento", "último"][i]] as [number, string]),
    ];
    for (const [at, detail] of events) {
      await tx`insert into sales_outreach_events (outreach_id, kind, channel, detail, created_at) values (${id}, 'mensaje', 'whatsapp', ${detail}, ${iso(at)})`;
    }
    await tx`insert into sales_outreach_events (outreach_id, kind, detail) values (${id}, 'nota', ${`La lectura de WhatsApp encontró mensajes nuestros en la línea ${sender.slice(-4)} que no estaban registrados: quedaron con su fecha.`})`;
    await tx`insert into sales_outreach_whatsapp_senders (outreach_id, phone, sender_phone) values (${id}, ${phone}, ${sender}) on conflict do nothing`;
    return true;
  });
}

/**
 * Deshace lo que hizo la lectura cuando el chat no tiene ninguna respuesta de verdad (la que la abrió
 * era automática): vuelve a «Contactado» con su próximo seguimiento y se borra lo que anotó la lectura.
 * Solo si nadie la tocó después (la situación y el último cambio de estado son de la lectura).
 */
async function undoAutomaticOpen(id: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [p] = await tx<Array<{ touches: number; greeted_at: string | null; last_contact_at: string | null }>>`
      select o.touches, o.greeted_at, o.last_contact_at from sales_outreach o
      join sales_followup_state s on s.outreach_id = o.id
      where o.id = ${id} and o.status = 'respondio' and s.updated_by = ${SYNC_ACTOR}
        and (select e.detail from sales_outreach_events e where e.outreach_id = o.id and e.kind = 'estado' order by e.created_at desc limit 1)
          like ${`respondio:%(Follow-up, ${SYNC_ACTOR})`}
      for update of o`;
    if (!p) return false;
    const base = p.last_contact_at ?? p.greeted_at;
    const from = base ? localDateKey(new Date(base), DEFAULT_TZ) : todayKey();
    const next = p.touches === 0 ? from : nextFollowUp(from, p.touches);
    await tx`update sales_outreach set status = 'contactado', next_action_on = ${next}, updated_at = now() where id = ${id}`;
    await tx`delete from sales_followup_state where outreach_id = ${id} and updated_by = ${SYNC_ACTOR}`;
    await tx`delete from sales_followup_audit where outreach_id = ${id} and actor = ${SYNC_ACTOR}`;
    await tx`
      delete from sales_outreach_events where outreach_id = ${id}
        and ((kind = 'estado' and detail like ${`%(Follow-up, ${SYNC_ACTOR})`}) or (kind = 'nota' and detail like ${`%(${SYNC_ACTOR})`}))`;
    return true;
  });
}

/** Quienes ya no esperan nada de nosotros aunque lo último sea de ellos. */
const CLOSED = ["no_interesa", "baja", "sin_canal", "cliente"];

/** Los totales por persona (una persona puede tener chat en las dos líneas) y quiénes esperan respuesta. */
async function totals(report: SyncReport) {
  const [t] = await sql<Array<{ conversaciones: number; respondieron: number; esperan: number }>>`
    with p as (
      select c.outreach_id, bool_or(c.sent > 0) as written, bool_or(c.received > 0) as replied,
        bool_or(c.received > 0 and c.last_from_me = false and o.status not in ${sql(CLOSED)}) as waiting
      from sales_whatsapp_chats c join sales_outreach o on o.id = c.outreach_id group by c.outreach_id
    )
    select count(*) filter (where written)::int as conversaciones,
      count(*) filter (where written and replied)::int as respondieron,
      count(*) filter (where written and waiting)::int as esperan
    from p`;
  report.totals.conversaciones = t?.conversaciones ?? 0;
  report.totals.respondieron = t?.respondieron ?? 0;
  report.totals.esperanRespuesta = t?.esperan ?? 0;
  report.pending = await sql<PendingReply[]>`
    select distinct on (o.id) o.code, o.name, right(c.sender_phone, 4) as line,
      to_char(c.last_received_at at time zone ${DEFAULT_TZ}, 'YYYY-MM-DD HH24:MI') as at,
      left(coalesce(c.last_received_text, ''), 280) as text, o.status
    from sales_whatsapp_chats c join sales_outreach o on o.id = c.outreach_id
    where c.received > 0 and c.last_from_me = false and o.status not in ${sql(CLOSED)}
    order by o.id, c.last_received_at desc`;
  report.pending.sort((a, b) => a.at.localeCompare(b.at));
  report.pending = report.pending.slice(0, 60);
}

/** Un chat de una persona en una línea, como lo dejó la última lectura (horas de Argentina, «AAAA-MM-DD HH:MM»). */
export type InboxChat = {
  /** Los últimos 4 números de la línea (0022, 5483). */
  line: string;
  /** Lo último que escribió la persona (sin las respuestas automáticas) y cuándo. */
  inAt: string | null;
  inText: string | null;
  /** Nuestro último mensaje en ese chat (también los que salieron a mano desde el celular). */
  outAt: string | null;
  /** ¿El último mensaje del chat es nuestro? null si no se sabe. */
  lastFromMe: boolean | null;
  received: number;
  sent: number;
  /** El último texto guardado es una respuesta automática (una lectura vieja no la distinguía). */
  automatic: boolean;
  readAt: string;
};
export type InboxEntry = { chats: InboxChat[]; manual: { at: string; text: string; by: string } | null };

/**
 * Para «Responder» de Chapa Labs: por código, cada chat que leyó la lectura diaria (línea, lo último que
 * escribió la persona, nuestro último mensaje y quién escribió último) y la última respuesta registrada a
 * mano (la de las líneas que no se leen, o la que se cargó en Follow-up). No incluye chats de otro número
 * (si se cambió el teléfono, por ejemplo por una derivación).
 */
export async function whatsappInbox(): Promise<{ readAt: string | null; byCode: Record<string, InboxEntry> }> {
  const local = (col: ReturnType<typeof sql>) => sql`to_char(${col} at time zone ${DEFAULT_TZ}, 'YYYY-MM-DD HH24:MI')`;
  const [chats, manual, last] = await Promise.all([
    sql<Array<{ code: string; phone: string; chat_id: string | null; line: string; in_at: string | null; in_text: string | null; out_at: string | null; last_from_me: boolean | null; received: number; sent: number; read_at: string }>>`
      select o.code, o.phone, c.chat_id, right(c.sender_phone, 4) as line, ${local(sql`c.last_received_at`)} as in_at, c.last_received_text as in_text,
        ${local(sql`c.last_sent_at`)} as out_at, c.last_from_me, c.received, c.sent, ${local(sql`c.synced_at`)} as read_at
      from sales_whatsapp_chats c join sales_outreach o on o.id = c.outreach_id
      where (c.sent > 0 or c.received > 0) and o.phone is not null
      order by o.code, c.sender_phone`,
    sql<Array<{ code: string; at: string; text: string; by: string }>>`
      select distinct on (a.outreach_id) o.code, ${local(sql`a.created_at`)} as at, coalesce(a.new_value, '') as text, a.actor as by
      from sales_followup_audit a join sales_outreach o on o.id = a.outreach_id
      where a.subject = 'reply' and a.actor <> ${SYNC_ACTOR}
      order by a.outreach_id, a.created_at desc`,
    sql<Array<{ at: string | null }>>`select ${local(sql`max(finished_at)`)} as at from sales_whatsapp_syncs`,
  ]);
  const byCode: Record<string, InboxEntry> = {};
  const entry = (code: string) => (byCode[code] ??= { chats: [], manual: null });
  for (const c of chats) {
    const chatPhone = phoneFromChatId(c.chat_id);
    if (chatPhone && chatPhone !== c.phone) continue;
    entry(c.code).chats.push({
      line: c.line, inAt: c.in_at, inText: c.in_text, outAt: c.out_at, lastFromMe: c.last_from_me,
      received: c.received, sent: c.sent, automatic: Boolean(c.in_text && isAutomaticReply(c.in_text)), readAt: c.read_at,
    });
  }
  for (const m of manual) entry(m.code).manual = { at: m.at, text: m.text.slice(0, 2000), by: m.by };
  return { readAt: last[0]?.at ?? null, byCode };
}

/** Lo que encontró la búsqueda en el historial: un mensaje de la persona (no las respuestas automáticas). */
export type ChatMatch = { code: string; name: string; line: string; at: string; text: string };
export type ChatSearch = {
  query: string;
  terms: string[];
  lines: Array<{ line: string; status: LineReport["status"]; chats?: number; read?: number; problem?: string }>;
  matches: ChatMatch[];
};

const HISTORY = 100;
/** Las palabras de la búsqueda (sin tildes ni mayúsculas; separadas por espacios, comas o «|»). */
export const searchTerms = (query: string) =>
  [...new Set(fold(query.slice(0, 200)).split(/[\s,|]+/).filter((t) => t.length >= 3))].slice(0, 12);

/**
 * Busca en el historial de las dos líneas (los últimos 100 mensajes de cada chat con una persona de la base
 * a la que le escribimos)
 * lo que escribió la persona con alguna de las palabras, por ejemplo «precio costo cuanto». La lectura
 * diaria solo guarda el último mensaje de cada chat; esto lee el resto. Solo lee: no guarda ni cambia nada.
 */
export async function searchWhatsappChats(query: string): Promise<ChatSearch> {
  const terms = searchTerms(query);
  const out: ChatSearch = { query: query.slice(0, 200), terms, lines: [], matches: [] };
  if (!terms.length) return out;
  const deadline = Date.now() + BUDGET_MS;
  const local = (s: number) => new Date(s * 1000).toLocaleString("sv-SE", { timeZone: DEFAULT_TZ }).slice(0, 16);
  for (const { ending, label } of lines()) {
    const status = await voiceChannelStatus(ending);
    if (!status.configured) { out.lines.push({ line: label, status: "sin_configurar" }); continue; }
    if (!status.ok) { out.lines.push({ line: label, status: "error", problem: status.problem ?? "WAHA no está listo." }); continue; }
    const config = prospectWaha(ending)!;
    const session = encodeURIComponent(config.session);
    // Como la lectura diaria: la lista de chats de la línea, cruzada con las personas por su número actual
    // (así sirve también para una línea que todavía no se leyó, y no trae el chat de un número anterior).
    let list: Awaited<ReturnType<typeof listProspectChats>>;
    try {
      list = await listProspectChats(config, async () => (await sql<Array<{ phone: string }>>`
        select distinct phone from sales_outreach
        where phone is not null and phone_kind is distinct from 'fijo' and last_contact_at is not null
        order by phone limit 1500`).map((r) => r.phone));
    } catch (e) {
      out.lines.push({ line: label, status: "error", problem: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const digits = [...list.byPhone.keys()].map((p) => p.replace(/\D/g, ""));
    const people = await sql<Array<{ code: string; name: string; phone: string }>>`
      select code, name, phone from sales_outreach
      where phone is not null and regexp_replace(phone, '[^0-9]', '', 'g') = any(${digits}::text[])
      order by code`;
    const chats = people.flatMap((p) => { const chat_id = list.byPhone.get(p.phone); return chat_id ? [{ ...p, chat_id }] : []; });
    const read = await inParallel(chats, PARALLEL, async (c) => {
      let messages: Message[];
      try {
        const res = await waha(config, `/api/${session}/chats/${encodeURIComponent(c.chat_id)}/messages?limit=${HISTORY}&downloadMedia=false`, { signal: AbortSignal.timeout(15000) });
        messages = (await res.json()) as Message[];
      } catch (e) {
        console.error("búsqueda en un chat de la prospección", e instanceof Error ? e.message.slice(0, 160) : e);
        return;
      }
      const all = Array.isArray(messages) ? messages : [];
      if (!all.some((m) => m.fromMe)) return; // un chat donde nunca le escribimos desde esta línea
      for (const m of all) {
        const text = m.fromMe ? "" : messageText(m);
        if (!text || isAutomaticReply(text)) continue;
        const folded = fold(text);
        if (terms.some((t) => folded.includes(t))) out.matches.push({ code: c.code, name: c.name, line: label, at: local(seconds(m.timestamp)), text });
      }
    }, deadline);
    out.lines.push({ line: label, status: "ok", chats: chats.length, read });
  }
  out.matches.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out;
}
