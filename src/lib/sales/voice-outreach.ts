import "server-only";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { sql } from "@/lib/db";
import { DEFAULT_TZ, localDateKey, zonedParts } from "@/lib/time";
import { MAX_TOUCHES, outreachPhone, renderTemplate, type OutreachPerson } from "./outreach-messages";
import { OutreachError, conversoSql, outreachDemoUrl, recordTouch } from "./outreach";

// Audios de seguimiento (MVP): Axel graba una vez y el panel lo manda como nota de voz nativa
// (sin «Reenviado») desde SU número, el mismo con el que prospectó, conectado a una sesión de
// WAHA propia (WAHA_PROSPECCION). Sale de a uno: la pausa entre envíos la lleva la página, y acá
// se controla el tope del día, el horario, la baja y que nadie reciba el mismo audio dos veces.
// No usa el WAHA de las clínicas ni el selector de canal de Sofi: es otra sesión, sin webhooks.

export const VOICE_DAILY_LIMIT = 20;
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

export type VoiceCandidate = OutreachPerson & { id: string; opened_at: string | null; demo_at: string | null; sent: boolean };

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
      exists (select 1 from sales_voice_sends v where v.outreach_id = o.id and v.voice_note_id = ${noteId} and v.status <> 'error') as sent
    from sales_outreach o
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

export function prospectWaha(): ProspectWaha | null {
  const raw = process.env.WAHA_PROSPECCION;
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new OutreachError("WAHA_PROSPECCION no contiene JSON válido."); }
  const result = configSchema.safeParse(parsed);
  if (!result.success) throw new OutreachError("Revisá WAHA_PROSPECCION: necesita url (https), apiKey y, si no es «default», session.");
  return result.data;
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

export async function voiceChannelStatus(): Promise<VoiceChannelStatus> {
  let config: ProspectWaha | null;
  try {
    config = prospectWaha();
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
      : config.phone && me !== config.phone ? `La sesión está conectada a ${me ?? "otro número"}, no al ${config.phone} de WAHA_PROSPECCION.`
      : null;
    return { configured: true, ok: !problem, status, me, problem };
  } catch (e) {
    return { configured: true, ok: false, status: "ERROR", me: null, problem: e instanceof Error ? e.message : String(e) };
  }
}

async function requireChannel(): Promise<ProspectWaha> {
  const status = await voiceChannelStatus();
  if (!status.configured) throw new OutreachError("Falta conectar tu número: cargá WAHA_PROSPECCION en Vercel.");
  if (!status.ok) throw new OutreachError(status.problem ?? "WAHA no está listo.");
  return prospectWaha()!;
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
async function deliver(config: ProspectWaha, chatId: string, note: { mimetype: string; audio: Buffer }, text: string, seconds: number) {
  await post(config, "/api/sendSeen", { chatId }).catch(() => {});
  if (text) {
    await post(config, "/api/sendText", { chatId, text });
    await sleep(between(2000, 4000));
  }
  await post(config, `/api/${encodeURIComponent(config.session)}/presence`, { chatId, presence: "recording" }).catch(() => {});
  await sleep(Math.min(Math.max(seconds, 3), 15) * 1000 * between(0.6, 0.9));
  const ogg = isOgg(note.mimetype);
  await post(config, "/api/sendVoice", {
    chatId,
    file: { mimetype: ogg ? "audio/ogg; codecs=opus" : note.mimetype, filename: ogg ? "audio.ogg" : "audio", data: note.audio.toString("base64") },
    convert: !ogg,
  });
  await post(config, `/api/${encodeURIComponent(config.session)}/presence`, { chatId, presence: "paused" }).catch(() => {});
}

function checkHours(now = new Date()) {
  const { hour } = zonedParts(now, DEFAULT_TZ);
  if (hour < HOURS.from || hour >= HOURS.to) throw new OutreachError(`Los audios salen de ${HOURS.from} a ${HOURS.to} (hora de Argentina).`);
}

export async function voiceSentToday(): Promise<number> {
  const today = localDateKey(new Date(), DEFAULT_TZ);
  const [{ count }] = await sql<Array<{ count: number }>>`
    select count(*)::int as count from sales_voice_sends
    where outreach_id is not null and status <> 'error' and (created_at at time zone ${DEFAULT_TZ})::date = ${today}::date`;
  return count;
}

/** Prueba: el audio a un número propio. No toca el embudo ni el tope del día. */
export async function sendVoiceTest(noteId: string, rawPhone: string, text: string, seconds: number): Promise<string> {
  const phone = outreachPhone(rawPhone, "movil")?.phone;
  if (!phone) throw new OutreachError("Ese número no parece un celular argentino (probá con 223 6123456).");
  const note = await voiceNoteAudio(noteId);
  if (!note) throw new OutreachError("No encontramos ese audio.");
  const config = await requireChannel();
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
export async function sendVoiceToProspect(noteId: string, outreachId: string, template: string, seconds: number): Promise<{ name: string }> {
  checkHours();
  const note = await voiceNoteAudio(noteId);
  if (!note) throw new OutreachError("No encontramos ese audio.");
  if (!/^[0-9a-f-]{36}$/i.test(outreachId)) throw new OutreachError("No encontramos ese contacto.");
  const [person] = await sql<Array<OutreachPerson & { id: string; ok: boolean }>>`
    select o.id, o.code, o.name, o.greeting, o.title, o.business_name, o.zone, o.address, o.specialty, o.phone, o.phone_kind,
      o.instagram, o.website, o.touches, o.greeted_at, (${eligible()}) as ok
    from sales_outreach o where o.id = ${outreachId}`;
  if (!person) throw new OutreachError("No encontramos ese contacto.");
  if (!person.ok || !person.phone) throw new OutreachError(`A ${person.name} ya no le toca: respondió, pidió la baja o ya recibió los tres mensajes.`);
  if ((await voiceSentToday()) >= VOICE_DAILY_LIMIT) throw new OutreachError(`Ya salieron ${VOICE_DAILY_LIMIT} audios hoy. Seguí mañana: más que eso desde un número es lo que hace que WhatsApp lo bloquee.`);
  const config = await requireChannel();

  const claim = await sql<Array<{ id: string }>>`
    insert into sales_voice_sends (voice_note_id, outreach_id, phone, status) values (${noteId}, ${outreachId}, ${person.phone}, 'enviando')
    on conflict do nothing returning id`;
  if (!claim.length) throw new OutreachError(`${person.name} ya recibió este audio.`);
  const sendId = claim[0].id;
  try {
    const chatId = await chatFor(config, person.phone.replace(/\D/g, ""));
    if (!chatId) throw new OutreachError(`${person.name}: ese número no tiene WhatsApp.`);
    const text = renderTemplate(template.trim(), person, outreachDemoUrl(person.code)).trim();
    await deliver(config, chatId, note, text, seconds);
    await sql`update sales_voice_sends set status = 'enviado' where id = ${sendId}`;
  } catch (e) {
    await sql`update sales_voice_sends set status = 'error', error = ${String(e instanceof Error ? e.message : e).slice(0, 300)} where id = ${sendId}`;
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
