import "server-only";
import { json, sql } from "@/lib/db";
import { DEFAULT_TZ } from "@/lib/time";
import { AXEL_WHATSAPP } from "./contacto-axel";
import { incomingReply } from "./followup-queue";
import { listProspectChats, prospectWaha, voiceChannelStatus, waha, type ProspectWaha } from "./voice-outreach";

// La lectura diaria de WhatsApp: los chats de las dos líneas de la prospección (WAHA_PROSPECCION y
// WAHA_PROSPECCION_5483), cruzados con la base. Por cada persona con chat se guarda qué se le mandó y
// qué contestó (sales_whatsapp_chats) y, si contestó algo nuevo, pasa a «Respuestas para atender» con
// su texto. Solo lee: no manda, no marca como leído y no cambia nada en WAHA.
// La dispara Chapa Labs una vez por día (y su botón «Leer WhatsApp ahora»).

export const SYNC_ACTOR = "WhatsApp (lectura diaria)";
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

export type ChatSummary = {
  sent: number;
  received: number;
  firstSentAt: number | null;
  lastSentAt: number | null;
  repliedAt: number | null;
  lastReceivedAt: number | null;
  lastReceivedText: string | null;
  lastFromMe: boolean | null;
  /** Lo que contestó después de `since` (segundos), del más viejo al más nuevo. */
  newReplies: Array<{ at: number; text: string }>;
};

/**
 * Qué pasó en un chat. Solo cuenta como respuesta lo que llegó después de nuestro primer mensaje
 * (si escribió antes por otra cosa, no es una respuesta a la prospección). `hadSent`: en una lectura
 * anterior ya había mensajes nuestros que ahora quedaron fuera de los últimos 50.
 */
export function summarizeChat(messages: Message[], since: number | null, hadSent = false): ChatSummary {
  const list = messages
    .map((m) => ({ at: seconds(m.timestamp), fromMe: Boolean(m.fromMe), text: messageText(m) }))
    .filter((m) => m.at > 0 && (m.text || m.fromMe))
    .sort((a, b) => a.at - b.at);
  const mine = list.filter((m) => m.fromMe);
  const firstSent = mine[0]?.at ?? null;
  const replies = list.filter((m) => !m.fromMe && m.text && (firstSent !== null ? m.at > firstSent : hadSent));
  const last = list.at(-1);
  return {
    sent: mine.length,
    received: replies.length,
    firstSentAt: firstSent,
    lastSentAt: mine.at(-1)?.at ?? null,
    repliedAt: replies[0]?.at ?? null,
    lastReceivedAt: replies.at(-1)?.at ?? null,
    lastReceivedText: replies.at(-1)?.text ?? null,
    lastFromMe: last ? last.fromMe : null,
    newReplies: replies.filter((m) => since === null || m.at > since),
  };
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

type Person = { id: string; code: string; name: string; status: string; phone: string };
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
    totals: { conversaciones: 0, respondieron: 0, esperanRespuesta: 0, nuevas: 0, abiertas: 0 },
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
    select id, code, name, status, phone from sales_outreach
    where phone is not null and regexp_replace(phone, '[^0-9]', '', 'g') = any(${digits}::text[])`;
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
    await sql`
      insert into sales_whatsapp_chats (outreach_id, sender_phone, chat_id, sent, received, first_sent_at, last_sent_at, replied_at, last_received_at, last_received_text, last_from_me, synced_at)
      values (${person.id}, ${sender}, ${chatId}, ${s.sent}, ${s.received}, ${at(s.firstSentAt)}, ${at(s.lastSentAt)}, ${at(s.repliedAt)}, ${at(s.lastReceivedAt)}, ${s.lastReceivedText}, ${s.lastFromMe}, now())
      on conflict (outreach_id, sender_phone) do update set
        chat_id = excluded.chat_id,
        sent = greatest(sales_whatsapp_chats.sent, excluded.sent),
        received = greatest(sales_whatsapp_chats.received, excluded.received),
        first_sent_at = coalesce(least(sales_whatsapp_chats.first_sent_at, excluded.first_sent_at), sales_whatsapp_chats.first_sent_at, excluded.first_sent_at),
        last_sent_at = coalesce(greatest(sales_whatsapp_chats.last_sent_at, excluded.last_sent_at), sales_whatsapp_chats.last_sent_at, excluded.last_sent_at),
        replied_at = coalesce(least(sales_whatsapp_chats.replied_at, excluded.replied_at), sales_whatsapp_chats.replied_at, excluded.replied_at),
        last_received_at = coalesce(excluded.last_received_at, sales_whatsapp_chats.last_received_at),
        last_received_text = coalesce(excluded.last_received_text, sales_whatsapp_chats.last_received_text),
        last_from_me = coalesce(excluded.last_from_me, sales_whatsapp_chats.last_from_me),
        synced_at = now()`;
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
