import { AXEL_WHATSAPP } from "@/lib/sales/contacto-axel";
import "server-only";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { sql, type Sql, type TransactionSql } from "@/lib/db";
import { DEFAULT_TZ, zonedParts } from "@/lib/time";
import { MAX_TOUCHES, outreachPhone, renderTemplate, type OutreachPerson } from "./outreach-messages";
import { OutreachError, conversoSql, outreachDemoUrl, recordTouch } from "./outreach";
import { DEFAULT_VOICE_RULES, voiceRules } from "./voice-rules";

// Audios de seguimiento (MVP): Axel graba una vez y el panel lo manda como nota de voz nativa
// (sin «Reenviado») desde SU número, el mismo con el que prospectó, conectado a una sesión de
// WAHA propia (WAHA_PROSPECCION). Sale de a uno: la pausa entre envíos la lleva la página, y acá
// se controla el tope del día, el horario, la baja y que nadie reciba el mismo audio dos veces.
// No usa el WAHA de las clínicas ni el selector de canal de Sofi: es otra sesión, sin webhooks.

export const VOICE_DAILY_LIMIT = DEFAULT_VOICE_RULES.dailyLimit;
const VOICE_RESERVATION_TIMEOUT = 180;

export class VoicePaceError extends OutreachError {
  constructor(readonly retryAfter: number) {
    super("Esperando la pausa entre envíos.");
  }
}
export const VOICE_MAX_BYTES = 3 * 1024 * 1024;
/** De 8 a 21 en Buenos Aires: nunca un audio de un desconocido a la noche. */
const HOURS = { from: 8, to: 21 };

export const VOICE_GROUPS = ["no_abrio", "abrio", "hablo"] as const;
export type VoiceGroup = (typeof VOICE_GROUPS)[number];
export const VOICE_GROUP_LABEL: Record<VoiceGroup, string> = {
  no_abrio: "No abrieron la demo",
  abrio: "La abrieron sin hablar con Sofi",
  hablo: "Hablaron con Sofi",
};
/** El texto que va antes del audio: el nombre y el link, que una grabación sola no puede decir. */
export const VOICE_DEFAULT_TEXT: Record<VoiceGroup, string> = {
  no_abrio: "Hola {saludo}! Te dejo un audio cortito. Tu demo: {link}",
  abrio: "Hola {saludo}! Tu demo: {link}",
  hablo: "Hola {saludo}!",
};

// Mismas definiciones que el embudo de Chapa Labs: abrió = entró a su /p/… (o tocó «Probar»),
// habló con Sofi = conversó con ella (no alcanza con tocar «Probar la demo»).
const groupFilter = (g: VoiceGroup) =>
  g === "hablo" ? conversoSql()
  : g === "abrio" ? sql`(o.opened_at is not null or o.demo_at is not null) and not ${conversoSql()}`
  : sql`o.opened_at is null and o.demo_at is null and not ${conversoSql()}`;

/**
 * A quién se le puede mandar: ya recibió la demo (al menos un mensaje), sigue «Contactado» (quien
 * respondió lo atiende una persona), le queda alguno de los tres mensajes, tiene celular y no pidió la baja.
 */
const eligible = () => sql`
  o.status = 'contactado' and o.touches >= 1 and o.touches < ${MAX_TOUCHES}
  and o.phone is not null and o.phone_kind is distinct from 'fijo'
  and not exists (select 1 from sales_suppressions s where s.phone = o.phone)`;

export type VoiceCandidate = OutreachPerson & { id: string; opened_at: string | null; demo_at: string | null; sent: boolean; needs_review: boolean; senders: string[] };

export async function voiceGroupCounts(): Promise<Record<VoiceGroup, number>> {
  const [row] = await sql<Array<Record<VoiceGroup, number>>>`
    select count(*) filter (where ${groupFilter("no_abrio")})::int as no_abrio,
           count(*) filter (where ${groupFilter("abrio")})::int as abrio,
           count(*) filter (where ${groupFilter("hablo")})::int as hablo
    from sales_outreach o where ${eligible()}`;
  return row;
}

export async function voiceCandidates(group: VoiceGroup, noteId: string | null): Promise<VoiceCandidate[]> {
  return sql<VoiceCandidate[]>`
    select o.id, o.code, o.name, o.greeting, o.title, o.business_name, o.zone, o.address, o.specialty, o.phone, o.phone_kind,
      o.instagram, o.website, o.touches, o.greeted_at, o.opened_at, o.demo_at,
      coalesce(delivery.reserved, false) as sent, coalesce(delivery.needs_review, false) as needs_review,
      array(select w.sender_phone from sales_outreach_whatsapp_senders w where w.outreach_id = o.id and w.phone = o.phone order by w.sender_phone) as senders
    from sales_outreach o
    left join lateral (
      select bool_or(v.status <> 'error') as reserved,
        bool_or(v.status = 'enviando' and (v.error is not null or v.created_at < now() - ${VOICE_RESERVATION_TIMEOUT} * interval '1 second')) as needs_review
      from sales_voice_sends v
      where v.outreach_id is not null and v.voice_note_id = ${noteId} and (v.outreach_id = o.id or v.phone = o.phone)
    ) delivery on true
    where ${eligible()} and ${groupFilter(group)}
    order by o.priority, o.last_contact_at nulls first, o.name
    limit 300`;
}

// ---------------------------------------------------------------------------
// Las grabaciones
// ---------------------------------------------------------------------------

export type VoiceNote = { id: string; label: string; mimetype: string; size: number; created_at: string; sent: number };

export async function listVoiceNotes(): Promise<VoiceNote[]> {
  return sql<VoiceNote[]>`
    select n.id, n.label, n.mimetype, octet_length(n.audio)::int as size, n.created_at,
      (select count(*)::int from sales_voice_sends v where v.voice_note_id = n.id and v.outreach_id is not null and v.status = 'enviado') as sent
    from sales_voice_notes n order by n.created_at desc limit 30`;
}

export async function voiceNoteAudio(id: string): Promise<{ mimetype: string; audio: Buffer; label: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<Array<{ mimetype: string; audio: Buffer; label: string }>>`select mimetype, audio, label from sales_voice_notes where id = ${id}`;
  return row ?? null;
}

/** El tipo que declara el navegador, o el que corresponde a la extensión si no declara ninguno. */
export function audioMimetype(declared: string, filename: string): string | null {
  const type = declared.split(";")[0].trim().toLowerCase();
  if (type.startsWith("audio/") || type === "video/webm" || type === "video/mp4") return type.startsWith("video/") ? type.replace("video/", "audio/") : type;
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  const byExt: Record<string, string> = { ogg: "audio/ogg", opus: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", webm: "audio/webm", amr: "audio/amr" };
  return ext ? (byExt[ext] ?? null) : null;
}

/** Ogg ya es el formato de las notas de voz: sale tal cual. El resto lo convierte WAHA. */
export const isOgg = (mimetype: string) => mimetype === "audio/ogg" || mimetype === "audio/opus";

export async function saveVoiceNote(label: string, mimetype: string, audio: Buffer): Promise<string> {
  const name = label.trim().slice(0, 80);
  if (!name) throw new OutreachError("Ponele un nombre al audio (por ejemplo, «No abrieron · v1»).");
  if (!audio.length) throw new OutreachError("Elegí el archivo del audio.");
  if (audio.length > VOICE_MAX_BYTES) throw new OutreachError("El audio pesa más de 3 MB: tiene que ser una nota corta (15 a 30 segundos).");
  const [row] = await sql<Array<{ id: string }>>`insert into sales_voice_notes (label, mimetype, audio) values (${name}, ${mimetype}, ${audio}) returning id`;
  return row.id;
}

export async function deleteVoiceNote(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await sql`delete from sales_voice_notes where id = ${id}`;
}

// ---------------------------------------------------------------------------
// WAHA de la prospección
// ---------------------------------------------------------------------------

const configSchema = z.object({
  url: z.url().refine((s) => {
    const u = new URL(s);
    return (u.protocol === "https:" || u.hostname === "localhost") && !u.username && !u.password && !u.search && !u.hash;
  }),
  apiKey: z.string().min(8),
  session: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("default"),
  /** El número con el que se prospectó (549…): si la sesión tiene otro, no se manda nada. */
  phone: z.string().regex(/^\d{8,15}$/).optional(),
});
type ProspectWaha = z.infer<typeof configSchema>;

export function prospectWaha(ending?: string): ProspectWaha | null {
  const secondary = ending === AXEL_WHATSAPP.slice(-4);
  const variable = secondary ? "WAHA_PROSPECCION_5483" : "WAHA_PROSPECCION";
  const raw = process.env[variable];
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new OutreachError(`${variable} no contiene JSON válido.`); }
  const result = configSchema.safeParse(parsed);
  if (!result.success) throw new OutreachError(`Revisá ${variable}: necesita url (https), apiKey y, si no es «default», session.`);
  if ((ending && !result.data.phone?.endsWith(ending)) || (secondary && result.data.phone !== AXEL_WHATSAPP)) {
    throw new OutreachError(`El teléfono configurado en ${variable} no coincide con la línea seleccionada.`);
  }
  return result.data;
}

export function voiceSenderPhones(): string[] {
  let primary: string | undefined;
  try { primary = prospectWaha()?.phone; } catch { /* el estado del canal muestra el error de configuración */ }
  return [...new Set(primary ? [primary, AXEL_WHATSAPP] : [AXEL_WHATSAPP])];
}

export async function setVoiceSender(person: string, ending: string, confirmed: boolean): Promise<void> {
  const sender = voiceSenderPhones().find((phone) => phone.endsWith(ending));
  if (!sender) throw new OutreachError("No encontramos esa línea de prospección.");
  if (confirmed) {
    await sql`
      insert into sales_outreach_whatsapp_senders (outreach_id, phone, sender_phone)
      select id, phone, ${sender} from sales_outreach where id = ${person} and phone is not null and phone_kind is distinct from 'fijo'
      on conflict do nothing`;
  } else {
    await sql`
      delete from sales_outreach_whatsapp_senders w using sales_outreach o
      where w.outreach_id = o.id and o.id = ${person} and w.phone = o.phone and w.sender_phone = ${sender}`;
  }
}

export async function importVoiceSenders(ending: string, rows: Array<{ code: string; phone: string }>): Promise<{ matched: number; inserted: number }> {
  const sender = voiceSenderPhones().find((phone) => phone.endsWith(ending));
  if (!sender) throw new OutreachError("No encontramos esa línea de prospección.");
  const list = rows.flatMap(({ code, phone }) => {
    const mobile = outreachPhone(phone, "movil");
    return mobile ? [{ code, phone: mobile.phone }] : [];
  });
  const [result] = await sql<Array<{ matched: number; inserted: number }>>`
    with matched as (
      select distinct o.id, o.phone from sales_outreach o
      join jsonb_to_recordset(${sql.json(list)}::jsonb) as evidence(code text, phone text) on o.code = evidence.code and o.phone = evidence.phone
      where o.phone_kind is distinct from 'fijo'
    ), saved as (
      insert into sales_outreach_whatsapp_senders (outreach_id, phone, sender_phone)
      select id, phone, ${sender} from matched on conflict do nothing returning outreach_id
    )
    select (select count(*)::int from matched) as matched, (select count(*)::int from saved) as inserted`;
  return result;
}

async function waha(config: ProspectWaha, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${config.url.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { "X-Api-Key": config.apiKey, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new OutreachError(`WAHA respondió ${res.status} en ${path}${text ? `: ${text}` : ""}`);
  }
  return res;
}

const post = (config: ProspectWaha, path: string, body: Record<string, unknown>) =>
  waha(config, path, { method: "POST", body: JSON.stringify({ session: config.session, ...body }) });

export type VoiceChannelStatus =
  | { configured: false }
  | { configured: true; ok: boolean; status: string; me: string | null; problem: string | null };

export async function voiceChannelStatus(ending?: string): Promise<VoiceChannelStatus> {
  let config: ProspectWaha | null;
  try {
    config = prospectWaha(ending);
  } catch (e) {
    return { configured: true, ok: false, status: "CONFIG", me: null, problem: e instanceof Error ? e.message : String(e) };
  }
  if (!config) return { configured: false };
  try {
    const res = await waha(config, `/api/sessions/${encodeURIComponent(config.session)}`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as { status?: string; me?: { id?: string } | null };
    const me = body.me?.id ? body.me.id.split("@")[0].split(":")[0] : null;
    const status = body.status ?? "?";
    const problem =
      status !== "WORKING" ? `La sesión «${config.session}» está en ${status}: abrí el dashboard de WAHA y escaneá el QR con tu WhatsApp.`
      : config.phone && me !== config.phone ? `La sesión está conectada a ${me ?? "otro número"}, no al ${config.phone} configurado para esta línea.`
      : null;
    return { configured: true, ok: !problem, status, me, problem };
  } catch (e) {
    return { configured: true, ok: false, status: "ERROR", me: null, problem: e instanceof Error ? e.message : String(e) };
  }
}

async function requireChannel(ending?: string): Promise<ProspectWaha> {
  const status = await voiceChannelStatus(ending);
  if (!status.configured) throw new OutreachError(ending ? `Falta conectar el WhatsApp terminado en ${ending}.` : "Falta conectar tu número: cargá WAHA_PROSPECCION en Vercel.");
  if (!status.ok) throw new OutreachError(status.problem ?? "WAHA no está listo.");
  return prospectWaha(ending)!;
}

const between = (min: number, max: number) => min + Math.random() * (max - min);

/** El chat de WhatsApp de ese número, o null si no tiene WhatsApp. Si WAHA no sabe, se arma a mano. */
async function chatFor(config: ProspectWaha, digits: string): Promise<string | null> {
  try {
    const res = await waha(config, `/api/contacts/check-exists?phone=${digits}&session=${encodeURIComponent(config.session)}`, { signal: AbortSignal.timeout(10000) });
    const body = (await res.json()) as { numberExists?: boolean; chatId?: string | null };
    if (body.numberExists === false) return null;
    return body.chatId || `${digits}@c.us`;
  } catch {
    return `${digits}@c.us`;
  }
}

/**
 * Lo que ve la persona: el texto (si hay), unos segundos de «grabando audio…» como si se grabara en
 * el momento, y la nota de voz. La presencia es cosmética: si WAHA no la acepta, se sigue.
 */
async function deliver(config: ProspectWaha, chatId: string, note: { mimetype: string; audio: Buffer }, text: string, seconds: number, onOutbound?: () => void) {
  await post(config, "/api/sendSeen", { chatId }).catch(() => {});
  if (text) {
    onOutbound?.();
    await post(config, "/api/sendText", { chatId, text });
    await sleep(between(2000, 4000));
  }
  await post(config, `/api/${encodeURIComponent(config.session)}/presence`, { chatId, presence: "recording" }).catch(() => {});
  await sleep(Math.min(Math.max(seconds, 3), 15) * 1000 * between(0.6, 0.9));
  const ogg = isOgg(note.mimetype);
  onOutbound?.();
  await post(config, "/api/sendVoice", {
    chatId,
    file: { mimetype: ogg ? "audio/ogg; codecs=opus" : note.mimetype, filename: ogg ? "audio.ogg" : "audio", data: note.audio.toString("base64") },
    convert: !ogg,
  });
  await post(config, `/api/${encodeURIComponent(config.session)}/presence`, { chatId, presence: "paused" }).catch(() => {});
}

/** El teléfono (+549…) de un chat individual de WhatsApp, o null si es un grupo, un canal o no es de la Argentina. */
export function phoneFromChatId(id: string | null | undefined): string | null {
  const match = /^(\d{8,15})@(c\.us|s\.whatsapp\.net)$/.exec(id ?? "");
  return match ? (outreachPhone(match[1], "movil")?.phone ?? null) : null;
}

const SYNC_PAGE = 500;
const SYNC_MAX_CHATS = 5000;

/**
 * Sugiere contactos con un chat existente para que el operador compruebe qué envió y desde dónde.
 * Los @lid se resuelven con su teléfono.
 */
export async function suggestVoiceSendersFromWaha(ending?: string): Promise<{ sender: string; chats: number; matched: number; inserted: 0; phones: number; kinds: Record<string, number>; suggestions: string[] }> {
  const config = await requireChannel(ending);
  if (!config.phone) throw new OutreachError("Agregá «phone» a WAHA_PROSPECCION para saber de qué línea son los chats.");
  const session = encodeURIComponent(config.session);
  const ids: string[] = [];
  try {
    for (let offset = 0; offset < SYNC_MAX_CHATS; offset += SYNC_PAGE) {
      const res = await waha(config, `/api/${session}/chats?limit=${SYNC_PAGE}&offset=${offset}`);
      const page = (await res.json()) as Array<{ id?: string | { _serialized?: string } }>;
      ids.push(...page.map((chat) => (typeof chat.id === "string" ? chat.id : chat.id?._serialized ?? "")).filter(Boolean));
      if (page.length < SYNC_PAGE) break;
    }
  } catch (e) {
    console.error("chats del WhatsApp emisor", e instanceof Error ? e.message : e);
    throw new OutreachError(
      "WAHA no devolvió la lista de chats del WhatsApp emisor. Con el motor NOWEB hace falta prender su historial (store) en la sesión. Mientras tanto, confirmá cada contacto con «+ " + config.phone.slice(-4) + "».",
    );
  }

  const lids = new Map<string, string>();
  if (ids.some((id) => id.endsWith("@lid"))) {
    try {
      for (let offset = 0; offset < SYNC_MAX_CHATS; offset += SYNC_PAGE) {
        const res = await waha(config, `/api/${session}/lids?limit=${SYNC_PAGE}&offset=${offset}`);
        const page = (await res.json()) as Array<{ lid?: string; pn?: string | null }>;
        for (const { lid, pn } of page) if (lid && pn) lids.set(lid, pn);
        if (page.length < SYNC_PAGE) break;
      }
    } catch (e) {
      console.error("lids del WhatsApp emisor", e instanceof Error ? e.message : e); // se siguen los chats con número
    }
  }

  // Los @lid que la lista general no trae se buscan de a uno (es una consulta local de WAHA).
  const pending = [...new Set(ids.filter((id) => id.endsWith("@lid") && !lids.has(id)))];
  for (let i = 0; i < pending.length; i += 10) {
    await Promise.all(pending.slice(i, i + 10).map(async (lid) => {
      try {
        const res = await waha(config, `/api/${session}/lids/${encodeURIComponent(lid)}`, { signal: AbortSignal.timeout(5000) });
        const { pn } = (await res.json()) as { pn?: string | null };
        if (pn) lids.set(lid, pn);
      } catch { /* sin número conocido */ }
    }));
  }

  // Si quedan @lid sin número, al revés: el @lid de cada contacto que puede recibir el audio
  // (WAHA lo averigua por su teléfono) y si coincide con un chat, es ese contacto.
  const unknown = new Set(ids.filter((id) => id.endsWith("@lid") && !lids.has(id)));
  if (unknown.size) {
    const people = await sql<Array<{ phone: string }>>`
      select distinct o.phone from sales_outreach o where ${eligible()}
        and not exists (select 1 from sales_outreach_whatsapp_senders w where w.outreach_id = o.id and w.phone = o.phone and w.sender_phone = ${config.phone})
      limit 1500`;
    const deadline = Date.now() + 60_000;
    for (let i = 0; i < people.length && unknown.size && Date.now() < deadline; i += 10) {
      await Promise.all(people.slice(i, i + 10).map(async ({ phone }) => {
        const pn = `${phone.replace(/\D/g, "")}@c.us`;
        try {
          const res = await waha(config, `/api/${session}/lids/pn/${encodeURIComponent(pn)}`, { signal: AbortSignal.timeout(5000) });
          const { lid } = (await res.json()) as { lid?: string | null };
          if (lid && unknown.delete(lid)) lids.set(lid, pn);
        } catch { /* sin @lid conocido */ }
      }));
    }
  }

  const kinds ={ numero: 0, lid: 0, lidSinNumero: 0, grupos: 0, otros: 0 };
  const phones = [...new Set(ids.flatMap((id) => {
    const lid = id.endsWith("@lid");
    if (lid) kinds.lid++;
    else if (/@(c\.us|s\.whatsapp\.net)$/.test(id)) kinds.numero++;
    else if (id.endsWith("@g.us")) kinds.grupos++;
    else kinds.otros++;
    if (lid && !lids.has(id)) kinds.lidSinNumero++;
    const phone = phoneFromChatId(lid ? lids.get(id) : id);
    return phone ? [phone] : [];
  }))];
  const digits = phones.map((phone) => phone.replace(/\D/g, ""));
  const matches = await sql<Array<{ id: string }>>`
    select o.id from sales_outreach o
    where ${eligible()} and regexp_replace(o.phone, '[^0-9]', '', 'g') = any(${digits}::text[])
      and not exists (
        select 1 from sales_outreach_whatsapp_senders w
        where w.outreach_id = o.id and w.phone = o.phone and w.sender_phone = ${config.phone}
      )`;
  return {
    sender: config.phone.slice(-4), chats: ids.length, matched: matches.length, inserted: 0,
    phones: phones.length, kinds, suggestions: matches.map(({ id }) => id),
  };
}

function checkHours(now = new Date()) {
  const { hour } = zonedParts(now, DEFAULT_TZ);
  if (hour < HOURS.from || hour >= HOURS.to) throw new OutreachError(`Los audios salen de ${HOURS.from} a ${HOURS.to} (hora de Argentina).`);
}

export async function voiceSentToday(db: Sql | TransactionSql = sql): Promise<number> {
  // «Hoy» según el reloj de la base, el mismo que fecha cada envío.
  const [{ count }] = await db<Array<{ count: number }>>`
    select count(*)::int as count from sales_voice_sends
    where outreach_id is not null and status <> 'error'
      and (created_at at time zone ${DEFAULT_TZ})::date = (now() at time zone ${DEFAULT_TZ})::date`;
  return count;
}

/** Normaliza una grabación del navegador una sola vez, antes de guardarla. */
export async function saveBrowserVoiceNote(label: string, audio: Buffer, ending?: string): Promise<string> {
  if (!label.trim()) throw new OutreachError("Ponele un nombre al audio.");
  if (!audio.length || audio.length > VOICE_MAX_BYTES) throw new OutreachError("Elegí un audio de hasta 3 MB.");
  const isOpus = (bytes: Buffer) => bytes.toString("ascii", 0, 4) === "OggS" && bytes.subarray(0, 256).includes("OpusHead");
  if (isOpus(audio)) return saveVoiceNote(label, "audio/ogg", audio);
  const config = await requireChannel(ending);
  const result = await post(config, `/api/${encodeURIComponent(config.session)}/media/convert/voice`, { data: audio.toString("base64") });
  const converted = (await result.json()) as { data?: string };
  const ogg = Buffer.from(converted.data ?? "", "base64");
  if (!isOpus(ogg)) {
    throw new OutreachError("WAHA no pudo convertir la grabación a una nota de voz.");
  }
  return saveVoiceNote(label, "audio/ogg", ogg);
}

/** Prueba: el audio a un número propio. No toca el embudo ni el tope del día. */
export async function sendVoiceTest(noteId: string, rawPhone: string, text: string, seconds: number, ending?: string): Promise<string> {
  const phone = outreachPhone(rawPhone, "movil")?.phone;
  if (!phone) throw new OutreachError("Ese número no parece un celular argentino (probá con 223 6123456).");
  const note = await voiceNoteAudio(noteId);
  if (!note) throw new OutreachError("No encontramos ese audio.");
  const config = await requireChannel(ending);
  const digits = phone.replace(/\D/g, "");
  const chatId = await chatFor(config, digits);
  if (!chatId) throw new OutreachError("Ese número no tiene WhatsApp.");
  const [row] = await sql<Array<{ id: string }>>`
    insert into sales_voice_sends (voice_note_id, phone, status) values (${noteId}, ${phone}, 'enviando') returning id`;
  try {
    await deliver(config, chatId, note, text.trim(), seconds);
    await sql`update sales_voice_sends set status = 'enviado' where id = ${row.id}`;
    return phone;
  } catch (e) {
    await sql`update sales_voice_sends set status = 'error', error = ${String(e instanceof Error ? e.message : e).slice(0, 300)} where id = ${row.id}`;
    throw e;
  }
}

/**
 * Un envío de la cola. Se reserva antes de mandar (el índice único impide el doble envío aunque
 * se toque dos veces), y al salir suma el mensaje y programa el seguimiento como cualquier WhatsApp.
 */
export async function sendVoiceToProspect(noteId: string, outreachId: string, template: string, seconds: number, group?: VoiceGroup, ending?: string): Promise<{ name: string }> {
  checkHours();
  const note = await voiceNoteAudio(noteId);
  if (!note) throw new OutreachError("No encontramos ese audio.");
  if (!/^[0-9a-f-]{36}$/i.test(outreachId)) throw new OutreachError("No encontramos ese contacto.");
  const [person] = await sql<Array<OutreachPerson & { id: string; ok: boolean }>>`
    select o.id, o.code, o.name, o.greeting, o.title, o.business_name, o.zone, o.address, o.specialty, o.phone, o.phone_kind,
      o.instagram, o.website, o.touches, o.greeted_at, (${eligible()} and ${group ? groupFilter(group) : sql`true`}) as ok
    from sales_outreach o where o.id = ${outreachId}`;
  if (!person) throw new OutreachError("No encontramos ese contacto.");
  if (!person.ok || !person.phone) throw new OutreachError(`A ${person.name} ya no le toca en este grupo o ya no puede recibir el seguimiento.`);
  const config = await requireChannel(ending);

  const claim = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('turnia-prospecting-voice-quota', 0))`;
    if (group) {
      const [current] = await tx`
        select 1 from sales_outreach o
        where o.id = ${outreachId} and o.phone = ${person.phone} and ${eligible()} and ${groupFilter(group)}
      `;
      if (!current) throw new OutreachError(`A ${person.name} ya no le toca en este grupo o cambió su teléfono.`);
      const [verified] = await tx`
        select 1 from sales_outreach_whatsapp_senders w
        where w.outreach_id = ${outreachId} and w.phone = ${person.phone} and w.sender_phone = ${config.phone ?? ""}
      `;
      if (!verified) throw new OutreachError("Confirmá primero que ya le escribiste desde el WhatsApp emisor.");
    }
    const rules = await voiceRules(tx);
    if ((await voiceSentToday(tx)) >= rules.dailyLimit) throw new OutreachError(`Ya se reservaron ${rules.dailyLimit} envíos de audio para hoy. Seguí mañana.`);
    if (group) {
      const pauseSeconds = rules.pauseMinMinutes * 60;
      const [{ seconds }] = await tx<Array<{ seconds: number }>>`
        select coalesce(ceil(extract(epoch from (max(created_at) + ${pauseSeconds} * interval '1 second' - now())))::int, 0) as seconds
        from sales_voice_sends where outreach_id is not null and created_at > now() - ${pauseSeconds} * interval '1 second'`;
      if (seconds > 0) throw new VoicePaceError(seconds);
    }
    return tx<Array<{ id: string }>>`
      insert into sales_voice_sends (voice_note_id, outreach_id, phone, status)
      select ${noteId}::uuid, ${outreachId}::uuid, ${person.phone}, 'enviando'
      where not exists (
        select 1 from sales_voice_sends
        where outreach_id is not null and (outreach_id = ${outreachId} or phone = ${person.phone}) and status <> 'error'
          and (voice_note_id = ${noteId} or (status = 'enviando' and created_at > now() - ${VOICE_RESERVATION_TIMEOUT} * interval '1 second'))
      )
      on conflict do nothing returning id`;
  });
  if (!claim.length) throw new OutreachError(`${person.name} ya recibió este audio o tiene otro envío en curso.`);
  const sendId = claim[0].id;
  let outboundStarted = false;
  try {
    const chatId = await chatFor(config, person.phone.replace(/\D/g, ""));
    if (!chatId) throw new OutreachError(`${person.name}: ese número no tiene WhatsApp.`);
    const text = renderTemplate(template.trim(), person, outreachDemoUrl(person.code)).trim();
    await deliver(config, chatId, note, text, seconds, () => { outboundStarted = true; });
    await sql`update sales_voice_sends set status = 'enviado' where id = ${sendId}`;
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e).slice(0, 300);
    // Si hubo un intento de texto o audio, el proveedor pudo aceptarlo antes del error.
    await sql`update sales_voice_sends set status = ${outboundStarted ? "enviando" : "error"}, error = ${error} where id = ${sendId}`;
    if (outboundStarted) throw new OutreachError(`No se pudo confirmar el envío a ${person.name}. Revisá su chat antes de volver a escribirle.`);
    throw e;
  }
  // Ya salió: lo que sigue solo registra. Si falla, el envío no se repite (queda «enviado»).
  try {
    await recordTouch(outreachId, "whatsapp", { properties: { message_format: "audio", voice_note: note.label } });
    await sql`insert into sales_outreach_events (outreach_id, kind, channel, detail) values (${outreachId}, 'nota', 'whatsapp', ${`Audio de seguimiento: «${note.label}»`})`;
  } catch (e) {
    console.error("Audio enviado pero no se pudo registrar el contacto", e instanceof Error ? e.message : e);
  }
  return { name: person.name };
}
