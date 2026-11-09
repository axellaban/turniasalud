import { AXEL_WHATSAPP } from "@/lib/sales/contacto-axel";
import "server-only";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { sql, type Sql, type TransactionSql } from "@/lib/db";
import { DEFAULT_TZ, zonedParts } from "@/lib/time";
import { MAX_TOUCHES, PERMISSION_WAIT_HOURS, outreachPhone, renderTemplate, splitMessages, whatsappTemplateKey, type OutreachPerson, type TemplateKey } from "./outreach-messages";
import { OutreachError, conversoSql, lastReplySql, outreachDemoUrl, outreachSettings, recordTouch, repliedSinceSql, setOutreachStatus } from "./outreach";
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

const NO_WHATSAPP_DETAIL = "ese número no tiene WhatsApp.";
export class VoiceRecipientUnavailableError extends OutreachError {
  constructor(name: string) { super(`${name}: ${NO_WHATSAPP_DETAIL}`); }
}
export class VoiceRecipientIneligibleError extends OutreachError {}
export const VOICE_MAX_BYTES = 3 * 1024 * 1024;
/** De 8 a 21 en Buenos Aires: nunca un audio ni un mensaje de un desconocido a la noche. */
const HOURS = { from: 8, to: 21 };

/**
 * Las etapas, en el orden de la secuencia de WhatsApp (outreach-messages.ts, siempre a la recepción):
 * el Paso 1 (el saludo, sin link), el Paso 2 a quienes respondieron el saludo (pide permiso, sin link),
 * el Paso 3 a quienes respondieron el Paso 2 (el link de su demo) y el Seguimiento 1 a quienes no lo
 * respondieron en 24 horas (el link igual). Las tres siguientes son el seguimiento después del link (el
 * Seguimiento 2, un audio de unos 12 segundos, y el 3, el mensaje para reenviar a los doctores), y la
 * última es para quien dijo que no: un mensaje que cierra
 * la charla y le pide en una línea por qué no le sirve. Antes del link sale solo texto; después, un
 * audio, un texto o los dos.
 */
export const VOICE_GROUPS = ["saludo", "permiso", "entrega", "sin_respuesta", "no_abrio", "abrio", "hablo", "no_interesa"] as const;
export type VoiceGroup = (typeof VOICE_GROUPS)[number];
/** Las del seguimiento (después de la demo): las que muestra el panel de Turnia. */
export const VOICE_FOLLOWUP_GROUPS = ["no_abrio", "abrio", "hablo"] as const satisfies readonly VoiceGroup[];
const isFollowupGroup = (g: VoiceGroup) => (VOICE_FOLLOWUP_GROUPS as readonly VoiceGroup[]).includes(g);
export const VOICE_GROUP_LABEL: Record<VoiceGroup, string> = {
  saludo: "Paso 1 · Por saludar",
  permiso: "Paso 2 · Respondieron el saludo",
  entrega: "Paso 3 · Respondieron el Paso 2",
  sin_respuesta: "Seguimiento 1 · Sin respuesta al Paso 2 en 24 h",
  no_abrio: "Seguimientos 2 y 3 · No abrieron la demo",
  abrio: "Seguimientos 2 y 3 · La abrieron sin hablar con Sofi",
  hablo: "Seguimientos 2 y 3 · Hablaron con Sofi",
  no_interesa: "Dijeron que no les interesa",
};
/**
 * Antes del link, solo texto (un audio o un link de un desconocido es lo que hace que WhatsApp bloquee
 * el número, y el Paso 3 y el Seguimiento 1 son el link escrito). El pedido de feedback, también.
 */
export const voiceTextOnly = (g: VoiceGroup) => !isFollowupGroup(g);
/** El saludo es el primer chat: no hay una línea que confirmar. En el resto, sale desde la línea que ya le escribió. */
export const voiceNeedsSender = (g: VoiceGroup) => g !== "saludo";
/** Las etapas que llevan el link de su demo. */
export const needsLink = (g: VoiceGroup) => g === "entrega" || g === "sin_respuesta";
/** Las que no pueden llevar un link (el Paso 1 y el 2: todavía no dio permiso). */
export const forbidsLink = (g: VoiceGroup) => g === "saludo" || g === "permiso";
/**
 * El texto que se propone para escribir. Vacío: sale el mensaje del panel de esa etapa (o, con un
 * audio, el audio solo, como el Seguimiento 2).
 */
export const VOICE_DEFAULT_TEXT: Record<VoiceGroup, string> = {
  saludo: "",
  permiso: "",
  entrega: "",
  sin_respuesta: "",
  no_abrio: "",
  abrio: "",
  hablo: "",
  no_interesa: "Gracias por contestarme. No te escribo más. Si me decís en una línea por qué no les sirve, me ayudás un montón.",
};
/** Los mensajes del panel que salen cuando se manda solo texto y el texto queda vacío. */
export const VOICE_PANEL_TEMPLATES: Record<VoiceGroup, TemplateKey[]> = {
  saludo: ["whatsapp_abridor"],
  permiso: ["whatsapp_permiso"],
  entrega: ["whatsapp_entrega"],
  sin_respuesta: ["whatsapp_sin_respuesta"],
  no_abrio: ["whatsapp_seguimiento", "whatsapp_reenviable"],
  abrio: ["whatsapp_seguimiento", "whatsapp_reenviable"],
  hablo: ["whatsapp_seguimiento", "whatsapp_reenviable"],
  no_interesa: [],
};

/**
 * «No, gracias» y parecidos en la última respuesta que leyó la lectura diaria de WhatsApp: así entra
 * quien dijo que no aunque en la base siga «Respondió». Para Postgres (`~*`).
 */
export const NO_INTERESA_PATTERN =
  "(^|[^a-záéíóúñ])no(,| )+(me |nos |les? )?(interesa|interesad)|no (estoy|estamos) interesad|(^|[^a-záéíóúñ])no,? (muchas )?gracias|no por (ahora|el momento)|no (lo |la )?necesit|no es para (m[ií]|nosotros)";

// Mismas definiciones que el embudo de Chapa Labs: abrió = entró a su /p/… (o tocó «Probar»),
// habló con Sofi = conversó con ella (no alcanza con tocar «Probar la demo»).
const groupFilter = (g: VoiceGroup) =>
  g === "hablo" ? conversoSql()
  : g === "abrio" ? sql`(o.opened_at is not null or o.demo_at is not null) and not ${conversoSql()}`
  : sql`o.opened_at is null and o.demo_at is null and not ${conversoSql()}`;

/** Tiene celular y no pidió la baja: lo mínimo para escribirle por WhatsApp. */
const reachable = () => sql`
  o.phone is not null and o.phone_kind is distinct from 'fijo'
  and not exists (select 1 from sales_suppressions s where s.phone = o.phone)`;

/** Su última respuesta fue un «no, gracias» (va a la etapa de quienes dijeron que no). */
const saidNo = () => sql`exists (
  select 1 from sales_whatsapp_chats c
  where c.outreach_id = o.id and c.last_from_me is false and c.last_received_text ~* ${NO_INTERESA_PATTERN})`;

/** Antes del link: lo saludamos o le escribimos el Paso 2 y todavía no recibió ninguno de los tres mensajes. */
const beforeLink = () => sql`o.status in ('contactado', 'respondio') and o.touches = 0`;

/**
 * El seguimiento: ya recibió el link (al menos uno de los tres mensajes), le queda alguno, no respondió
 * después de nuestro último mensaje («no habló más»: si contestó, lo atiende una persona) y no se le
 * escribió hoy (el Seguimiento 2 va al día siguiente del link).
 */
const followup = () => sql`o.status in ('contactado', 'respondio') and o.touches >= 1 and o.touches < ${MAX_TOUCHES}
  and not ${repliedSinceSql(sql`o.last_contact_at`)}
  and (o.last_contact_at is null or (o.last_contact_at at time zone ${DEFAULT_TZ})::date < (now() at time zone ${DEFAULT_TZ})::date)`;

/**
 * Quién está en cada etapa. Saludo: nadie le escribió todavía, ni a él ni a otro con su mismo número
 * (un número compartido se saluda una vez, por la persona de mejor prioridad, como en la cola del
 * panel). Paso 2: respondió el saludo. Paso 3: respondió el Paso 2. Seguimiento 1: pasaron 24 horas del
 * Paso 2 sin respuesta. Las respuestas salen de la lectura de WhatsApp (a las 8 y con «Leer las
 * respuestas») o de lo que se marcó a mano.
 */
const stageFilter = (g: VoiceGroup) =>
  g === "saludo" ? sql`o.status = 'por_contactar' and o.touches = 0 and o.greeted_at is null
      and not exists (
        select 1 from sales_outreach x where x.phone = o.phone and x.id <> o.id
          and (x.touches > 0 or x.status <> 'por_contactar' or x.greeted_at is not null or (x.priority, x.name, x.id) < (o.priority, o.name, o.id)))`
  : g === "permiso" ? sql`${beforeLink()} and o.greeted_at is not null and o.permission_at is null
      and ${repliedSinceSql(sql`o.greeted_at`)} and not ${saidNo()}`
  : g === "entrega" ? sql`${beforeLink()} and o.permission_at is not null and ${repliedSinceSql(sql`o.permission_at`)} and not ${saidNo()}`
  : g === "sin_respuesta" ? sql`${beforeLink()} and o.permission_at <= now() - ${PERMISSION_WAIT_HOURS} * interval '1 hour'
      and not ${repliedSinceSql(sql`o.permission_at`)}`
  : g === "no_interesa" ? sql`(o.status = 'no_interesa' or (o.status = 'respondio' and ${saidNo()}))`
  : sql`${followup()} and ${groupFilter(g)}`;

/** Sin etapa (el panel de Turnia) es el seguimiento con audio, como antes. */
const eligible = (g?: VoiceGroup) => sql`${reachable()} and ${g ? stageFilter(g) : followup()}`;
/** Las etapas que salen desde la línea que ya le escribió: todas menos el saludo. */
const withSender = () => sql`${reachable()} and (${followup()} or (${beforeLink()} and o.greeted_at is not null))`;

/**
 * Cómo se registra un envío de texto en sales_voice_sends (uno por persona y clave): la etapa o, en el
 * seguimiento, la etapa y el número de mensaje (así el Seguimiento 2 y el 3 pueden salir escritos los dos).
 */
const textStage = (g: VoiceGroup, touches: number) => (isFollowupGroup(g) ? `${g}:${touches + 1}` : g);
const textStageSql = (g: VoiceGroup) => (isFollowupGroup(g) ? sql`${g} || ':' || (o.touches + 1)` : sql`${g}`);

export type VoiceCandidate = OutreachPerson & { id: string; opened_at: string | null; demo_at: string | null; sent: boolean; needs_review: boolean; senders: string[]; reply: string | null; reply_at: string | null; whatsapp_unavailable: boolean };

// El rechazo se guarda por número, no por ficha. Una corrección de teléfono no hereda el
// rechazo. La evidencia vence al día y un envío posterior prevalece sobre el rechazo.
const recentlyUnavailable = () => sql`coalesce((
  select v.status = 'error'
  from sales_voice_sends v
  where v.outreach_id is not null and v.phone = o.phone and v.created_at > now() - interval '24 hours'
    and (v.status = 'enviado' or (v.status = 'error' and (
      v.failure_code = 'recipient_unavailable' or (v.failure_code is null and v.error like ${`%: ${NO_WHATSAPP_DETAIL}`})
    )))
  order by v.created_at desc, v.id desc
  limit 1
), false)`;

/**
 * Las líneas que ya tienen un chat con esa persona: las confirmadas a mano o al mandar desde acá, y
 * aquellas donde la lectura diaria de WhatsApp encontró que nos contestó.
 */
const senderPhones = () => sql`
  select w.sender_phone from sales_outreach_whatsapp_senders w where w.outreach_id = o.id and w.phone = o.phone
  union select c.sender_phone from sales_whatsapp_chats c where c.outreach_id = o.id and c.received > 0`;

export async function voiceGroupCounts(): Promise<Record<VoiceGroup, number>> {
  const [row] = await sql<Array<Record<VoiceGroup, number>>>`
    select count(*) filter (where ${stageFilter("saludo")})::int as saludo,
           count(*) filter (where ${stageFilter("permiso")})::int as permiso,
           count(*) filter (where ${stageFilter("entrega")})::int as entrega,
           count(*) filter (where ${stageFilter("sin_respuesta")})::int as sin_respuesta,
           count(*) filter (where ${stageFilter("no_abrio")})::int as no_abrio,
           count(*) filter (where ${stageFilter("abrio")})::int as abrio,
           count(*) filter (where ${stageFilter("hablo")})::int as hablo,
           count(*) filter (where ${stageFilter("no_interesa")})::int as no_interesa
    from sales_outreach o where ${reachable()}`;
  return row;
}

export async function voiceCandidates(group: VoiceGroup, noteId: string | null, rememberUnavailable = false): Promise<VoiceCandidate[]> {
  return sql<VoiceCandidate[]>`
    select o.id, o.code, o.name, o.greeting, o.title, o.business_name, o.zone, o.address, o.specialty, o.phone, o.phone_kind,
      o.instagram, o.website, o.touches, o.greeted_at, o.permission_at, o.opened_at, o.demo_at,
      coalesce(delivery.reserved, false) as sent, coalesce(delivery.needs_review, false) as needs_review,
      ${rememberUnavailable ? recentlyUnavailable() : sql`false`} as whatsapp_unavailable,
      array(select x.sender_phone from (${senderPhones()}) x order by x.sender_phone) as senders,
      (select c.last_received_text from sales_whatsapp_chats c where c.outreach_id = o.id and c.received > 0
        order by c.last_received_at desc nulls last limit 1) as reply,
      ${lastReplySql()} as reply_at
    from sales_outreach o
    left join lateral (
      select bool_or(v.status <> 'error') as reserved,
        bool_or(v.status = 'enviando' and (v.error is not null or v.created_at < now() - ${VOICE_RESERVATION_TIMEOUT} * interval '1 second')) as needs_review
      from sales_voice_sends v
      where v.outreach_id is not null and (v.outreach_id = o.id or v.phone = o.phone)
        and ${noteId ? sql`v.voice_note_id = ${noteId}` : sql`v.voice_note_id is null and v.stage = ${textStageSql(group)}`}
    ) delivery on true
    where ${eligible(group)}
    order by whatsapp_unavailable, ${group === "permiso" || group === "entrega" ? sql`reply_at desc nulls last,` : sql``} o.priority, o.last_contact_at nulls first, o.name
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
export type ProspectWaha = z.infer<typeof configSchema>;

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

export async function waha(config: ProspectWaha, path: string, init: RequestInit = {}): Promise<Response> {
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

const businessEnding = AXEL_WHATSAPP.slice(-4);

export async function voiceBusinessConnection() {
  const channel = await voiceChannelStatus(businessEnding);
  if (!channel.configured) return { status: "CONFIG", ready: false, hasAccount: false, qr: null };
  const hasAccount = Boolean(channel.me);
  const status = hasAccount && channel.me !== AXEL_WHATSAPP ? "WRONG_NUMBER" : channel.status;
  let qr: string | null = null;
  if (status === "SCAN_QR_CODE") {
    const config = prospectWaha(businessEnding)!;
    try {
      const response = await waha(config, `/api/${config.session}/auth/qr`, { signal: AbortSignal.timeout(5000) });
      const body = await response.json() as { mimetype?: string; data?: string };
      if (body.mimetype === "image/png" && typeof body.data === "string"
        && body.data.length <= 100_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) {
        qr = body.data;
      }
    } catch {
      // La sesión puede haberse conectado o rotado el código mientras se pedía la imagen.
    }
  }
  return { status, ready: channel.ok, hasAccount, qr };
}

export async function reconnectVoiceBusiness(relink: boolean) {
  const config = prospectWaha(businessEnding);
  if (!config) throw new OutreachError("Falta configurar el WhatsApp Business en Turnia.");
  await sql.begin(async (tx) => {
    const [lock] = await tx<Array<{ acquired: boolean }>>`
      select pg_try_advisory_xact_lock(hashtextextended('turnia-prospecting-voice-reconnect', 0)) as acquired`;
    if (!lock.acquired) return;
    const channel = await voiceChannelStatus(businessEnding);
    if (!channel.configured || channel.status !== "FAILED" || (channel.me && channel.me !== config.phone)) return;
    const path = `/api/sessions/${config.session}`;
    const change = (action: string) => waha(config, `${path}/${action}`, {
      method: "POST", body: "{}", signal: AbortSignal.timeout(8000),
    });
    try {
      if (relink) {
        const result = await change("logout");
        const session = await result.json() as { status?: string };
        if (session.status === "STOPPED") await change("start");
      } else {
        await change("restart");
      }
    } catch {
      throw new OutreachError("WAHA no pudo recuperar la sesión. Revisá su estado y volvé a intentar.");
    }
  });
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
 * el momento, y la nota de voz. Sin audio, solo el texto, después de unos segundos de «escribiendo…».
 * La presencia es cosmética: si WAHA no la acepta, se sigue.
 */
async function deliver(config: ProspectWaha, chatId: string, note: { mimetype: string; audio: Buffer } | null, text: string, seconds: number, onOutbound?: () => void) {
  await post(config, "/api/sendSeen", { chatId }).catch(() => {});
  if (!note) {
    await post(config, `/api/${encodeURIComponent(config.session)}/presence`, { chatId, presence: "typing" }).catch(() => {});
    await sleep(between(2000, 4000));
  }
  // Una línea con «---» separa dos mensajes (el Seguimiento 3: el segundo queda solo, para reenviarlo).
  const parts = splitMessages(text);
  for (const [i, part] of parts.entries()) {
    if (i > 0) {
      await post(config, `/api/${encodeURIComponent(config.session)}/presence`, { chatId, presence: "typing" }).catch(() => {});
      await sleep(between(2500, 5000));
    }
    onOutbound?.();
    await post(config, "/api/sendText", { chatId, text: part });
  }
  if (parts.length) {
    if (!note) return;
    await sleep(between(2000, 4000));
  }
  if (!note) return;
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

export type ProspectChats = {
  /** Todos los chats de la línea, como los devuelve WAHA. */
  ids: string[];
  /** El chat de cada teléfono (+549…), con el @lid ya resuelto. */
  byPhone: Map<string, string>;
  kinds: { numero: number; lid: number; lidSinNumero: number; grupos: number; otros: number };
};

/**
 * Los chats individuales de una línea de la prospección, con su teléfono. Los @lid se resuelven con
 * la lista de WAHA, de a uno y, si quedan, al revés: el @lid de cada teléfono de `candidates`.
 * Solo lee: no manda nada.
 */
export async function listProspectChats(config: ProspectWaha, candidates: () => Promise<string[]>): Promise<ProspectChats> {
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
    throw new OutreachError("WAHA no devolvió la lista de chats del WhatsApp emisor. Con el motor NOWEB hace falta prender su historial (store) en la sesión.");
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

  // Si quedan @lid sin número, al revés: el @lid de cada candidato (WAHA lo averigua por su
  // teléfono) y si coincide con un chat, es ese contacto.
  const unknown = new Set(ids.filter((id) => id.endsWith("@lid") && !lids.has(id)));
  if (unknown.size) {
    const people = await candidates();
    const deadline = Date.now() + 60_000;
    for (let i = 0; i < people.length && unknown.size && Date.now() < deadline; i += 10) {
      await Promise.all(people.slice(i, i + 10).map(async (phone) => {
        const pn = `${phone.replace(/\D/g, "")}@c.us`;
        try {
          const res = await waha(config, `/api/${session}/lids/pn/${encodeURIComponent(pn)}`, { signal: AbortSignal.timeout(5000) });
          const { lid } = (await res.json()) as { lid?: string | null };
          if (lid && unknown.delete(lid)) lids.set(lid, pn);
        } catch { /* sin @lid conocido */ }
      }));
    }
  }

  const kinds = { numero: 0, lid: 0, lidSinNumero: 0, grupos: 0, otros: 0 };
  const byPhone = new Map<string, string>();
  for (const id of ids) {
    const lid = id.endsWith("@lid");
    if (lid) kinds.lid++;
    else if (/@(c\.us|s\.whatsapp\.net)$/.test(id)) kinds.numero++;
    else if (id.endsWith("@g.us")) kinds.grupos++;
    else kinds.otros++;
    if (lid && !lids.has(id)) kinds.lidSinNumero++;
    const phone = phoneFromChatId(lid ? lids.get(id) : id);
    // Si el mismo teléfono tiene chat por número y por @lid, se queda el primero que da WAHA.
    if (phone && !byPhone.has(phone)) byPhone.set(phone, id);
  }
  return { ids, byPhone, kinds };
}

/**
 * Sugiere contactos con un chat existente para que el operador compruebe qué envió y desde dónde.
 * Los @lid se resuelven con su teléfono.
 */
export async function suggestVoiceSendersFromWaha(ending?: string): Promise<{ sender: string; chats: number; matched: number; inserted: 0; phones: number; kinds: Record<string, number>; suggestions: string[] }> {
  const config = await requireChannel(ending);
  if (!config.phone) throw new OutreachError("Agregá «phone» a WAHA_PROSPECCION para saber de qué línea son los chats.");
  const sender = config.phone;
  let chats: ProspectChats;
  try {
    chats = await listProspectChats(config, async () => (await sql<Array<{ phone: string }>>`
      select distinct o.phone from sales_outreach o where ${withSender()}
        and not exists (select 1 from sales_outreach_whatsapp_senders w where w.outreach_id = o.id and w.phone = o.phone and w.sender_phone = ${sender})
      limit 1500`).map((r) => r.phone));
  } catch (e) {
    if (e instanceof OutreachError) throw new OutreachError(`${e.message} Mientras tanto, confirmá cada contacto con «+ ${sender.slice(-4)}».`);
    throw e;
  }
  const phones = [...chats.byPhone.keys()];
  const digits = phones.map((phone) => phone.replace(/\D/g, ""));
  const matches = await sql<Array<{ id: string }>>`
    select o.id from sales_outreach o
    where ${withSender()} and regexp_replace(o.phone, '[^0-9]', '', 'g') = any(${digits}::text[])
      and not exists (
        select 1 from sales_outreach_whatsapp_senders w
        where w.outreach_id = o.id and w.phone = o.phone and w.sender_phone = ${sender}
      )`;
  return {
    sender: sender.slice(-4), chats: chats.ids.length, matched: matches.length, inserted: 0,
    phones: phones.length, kinds: chats.kinds, suggestions: matches.map(({ id }) => id),
  };
}

function checkHours(now = new Date()) {
  const { hour } = zonedParts(now, DEFAULT_TZ);
  if (hour < HOURS.from || hour >= HOURS.to) throw new OutreachError(`Los audios y mensajes salen de ${HOURS.from} a ${HOURS.to} (hora de Argentina).`);
}

// «Hoy» según el reloj de la base, el mismo que fecha cada envío.
const countedToday = () => sql`outreach_id is not null and status <> 'error'
  and (created_at at time zone ${DEFAULT_TZ})::date = (now() at time zone ${DEFAULT_TZ})::date`;

export async function voiceSentToday(db: Sql | TransactionSql = sql): Promise<number> {
  const [{ count }] = await db<Array<{ count: number }>>`
    select count(*)::int as count from sales_voice_sends
    where ${countedToday()}`;
  return count;
}

export async function voiceUsageToday() {
  return sql<Array<{ ending: string | null; used: number; sent: number }>>`
    select right(sender_phone, 4) as ending, count(*)::int as used,
      count(*) filter (where status = 'enviado')::int as sent
    from sales_voice_sends where ${countedToday()}
    group by right(sender_phone, 4)`;
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

/** Cómo se ve un texto con variables en la prueba: con tus datos y un link de muestra. */
const TEST_PERSON: OutreachPerson = {
  code: "prueba", name: "Axel Laban", greeting: "Axel", title: "", business_name: "Consultorio de prueba", zone: "Mar del Plata",
  address: "", specialty: "", phone: null, phone_kind: "movil", instagram: null, website: null, touches: 0,
};

/** Prueba: el audio, el texto o los dos a un número propio. No toca el embudo ni el tope del día. */
export async function sendVoiceTest(noteId: string | null, rawPhone: string, text: string, seconds: number, ending?: string): Promise<string> {
  const phone = outreachPhone(rawPhone, "movil")?.phone;
  if (!phone) throw new OutreachError("Ese número no parece un celular argentino (probá con 223 6123456).");
  const note = noteId ? await voiceNoteAudio(noteId) : null;
  if (noteId && !note) throw new OutreachError("No encontramos ese audio.");
  const message = renderTemplate(text.trim(), TEST_PERSON, outreachDemoUrl(TEST_PERSON.code)).trim();
  if (!note && !message) throw new OutreachError("Escribí el mensaje o elegí un audio para la prueba.");
  const config = await requireChannel(ending);
  const digits = phone.replace(/\D/g, "");
  const chatId = await chatFor(config, digits);
  if (!chatId) throw new OutreachError("Ese número no tiene WhatsApp.");
  const [row] = await sql<Array<{ id: string }>>`
    insert into sales_voice_sends (voice_note_id, phone, status) values (${noteId}, ${phone}, 'enviando') returning id`;
  try {
    await deliver(config, chatId, note, message, seconds);
    await sql`update sales_voice_sends set status = 'enviado' where id = ${row.id}`;
    return phone;
  } catch (e) {
    await sql`update sales_voice_sends set status = 'error', error = ${String(e instanceof Error ? e.message : e).slice(0, 300)} where id = ${row.id}`;
    throw e;
  }
}

/**
 * El mensaje del panel que le toca, para cuando se manda solo texto sin escribirlo: el de la etapa antes
 * del link y, en el seguimiento, el Seguimiento 2 o el 3 según cuántos lleva.
 */
async function panelMessage(person: OutreachPerson, group?: VoiceGroup): Promise<string> {
  const key = group && !isFollowupGroup(group) ? VOICE_PANEL_TEMPLATES[group][0] : whatsappTemplateKey(person);
  if (!key) return "";
  const { templates } = await outreachSettings();
  return renderTemplate(templates[key], person, outreachDemoUrl(person.code)).trim();
}

/**
 * Un envío de la cola. Se reserva antes de mandar (el índice único impide el doble envío aunque
 * se toque dos veces), y al salir suma el mensaje y programa el seguimiento como cualquier WhatsApp.
 * Sin audio (`noteId` null) sale solo el texto: el escrito o, si queda vacío, el del panel. Antes del
 * link es siempre así: el Paso 1 y el 2 no llevan link; el 3 y el Seguimiento 1, el de su demo.
 */
export async function sendVoiceToProspect(noteId: string | null, outreachId: string, template: string, seconds: number, group?: VoiceGroup, ending?: string): Promise<{ name: string }> {
  checkHours();
  if (!noteId && !group) throw new OutreachError("Elegí un audio.");
  if (noteId && group && voiceTextOnly(group)) throw new OutreachError("Esta etapa va solo con texto: el audio queda para el seguimiento, cuando ya tiene el link de su demo.");
  const note = noteId ? await voiceNoteAudio(noteId) : null;
  if (noteId && !note) throw new OutreachError("No encontramos ese audio.");
  if (!/^[0-9a-f-]{36}$/i.test(outreachId)) throw new OutreachError("No encontramos ese contacto.");
  const [person] = await sql<Array<OutreachPerson & { id: string; ok: boolean; demo_at: string | null; whatsapp_unavailable: boolean }>>`
    select o.id, o.code, o.name, o.greeting, o.title, o.business_name, o.zone, o.address, o.specialty, o.phone, o.phone_kind,
      o.instagram, o.website, o.touches, o.greeted_at, o.permission_at, o.demo_at, ${eligible(group)} as ok,
      ${group ? recentlyUnavailable() : sql`false`} as whatsapp_unavailable
    from sales_outreach o where o.id = ${outreachId}`;
  if (!person) throw new VoiceRecipientIneligibleError("No encontramos ese contacto.");
  if (!person.ok || !person.phone) throw new VoiceRecipientIneligibleError(`A ${person.name} ya no le toca en este grupo o ya no puede recibir el seguimiento.`);
  if (person.whatsapp_unavailable) throw new VoiceRecipientUnavailableError(person.name);
  const custom = template.trim();
  const fallback = group && !VOICE_PANEL_TEMPLATES[group].length
    ? renderTemplate(VOICE_DEFAULT_TEXT[group], person, outreachDemoUrl(person.code)).trim()
    : await panelMessage(person, group);
  const text = custom ? renderTemplate(custom, person, outreachDemoUrl(person.code)).trim() : note ? "" : fallback;
  if (!note && !text) throw new OutreachError("Escribí el mensaje o elegí un audio.");
  if (group && forbidsLink(group) && /\{link\}|https?:\/\/|www\./i.test(`${custom} ${text}`)) {
    throw new OutreachError(group === "saludo"
      ? "El Paso 1 va sin link: que un desconocido mande un link de entrada es lo que hace que WhatsApp bloquee el número."
      : "El Paso 2 va sin link: pide permiso para pasarlo. El link sale en el Paso 3 (o el Seguimiento 1).");
  }
  if (group && needsLink(group) && !text.includes(outreachDemoUrl(person.code))) {
    throw new OutreachError("Este paso lleva el link de su demo: sumá {link} al mensaje.");
  }
  const stageKey = group ? textStage(group, person.touches) : null;
  const config = await requireChannel(ending);

  const claim = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('turnia-prospecting-voice-quota', 0))`;
    if (group) {
      const [current] = await tx`
        select 1 from sales_outreach o
        where o.id = ${outreachId} and o.phone = ${person.phone} and ${eligible(group)}
      `;
      if (!current) throw new VoiceRecipientIneligibleError(`A ${person.name} ya no le toca en este grupo o cambió su teléfono.`);
    }
    if (group && voiceNeedsSender(group)) {
      const [verified] = await tx`
        select 1 from sales_outreach o where o.id = ${outreachId} and ${config.phone ?? ""} in (${senderPhones()})
      `;
      if (!verified) throw new VoiceRecipientIneligibleError("Confirmá primero que ya le escribiste desde el WhatsApp emisor.");
    }
    const rules = await voiceRules(tx);
    if ((await voiceSentToday(tx)) >= rules.dailyLimit) throw new OutreachError(`Ya se reservaron ${rules.dailyLimit} envíos para hoy (audios y mensajes). Seguí mañana.`);
    if (group) {
      const pauseSeconds = rules.pauseMinMinutes * 60;
      const [{ seconds }] = await tx<Array<{ seconds: number }>>`
        select coalesce(ceil(extract(epoch from (max(created_at) + ${pauseSeconds} * interval '1 second' - now())))::int, 0) as seconds
        from sales_voice_sends where outreach_id is not null and created_at > now() - ${pauseSeconds} * interval '1 second'`;
      if (seconds > 0) throw new VoicePaceError(seconds);
    }
    return tx<Array<{ id: string }>>`
      insert into sales_voice_sends (voice_note_id, outreach_id, phone, status, stage, sender_phone)
      select ${noteId}::uuid, ${outreachId}::uuid, ${person.phone}, 'enviando', ${stageKey}, ${config.phone ?? null}
      where not exists (
        select 1 from sales_voice_sends
        where outreach_id is not null and (outreach_id = ${outreachId} or phone = ${person.phone}) and status <> 'error'
          and (${noteId ? tx`voice_note_id = ${noteId}` : tx`voice_note_id is null and stage = ${stageKey}`}
            or (status = 'enviando' and created_at > now() - ${VOICE_RESERVATION_TIMEOUT} * interval '1 second'))
      )
      on conflict do nothing returning id`;
  });
  if (!claim.length) throw new VoiceRecipientIneligibleError(`${person.name} ya recibió ${note ? "este audio" : "el mensaje de esta etapa"} o tiene otro envío en curso.`);
  const sendId = claim[0].id;
  let outboundStarted = false;
  try {
    const chatId = await chatFor(config, person.phone.replace(/\D/g, ""));
    if (!chatId) throw new VoiceRecipientUnavailableError(person.name);
    await deliver(config, chatId, note, text, seconds, () => { outboundStarted = true; });
    await sql`update sales_voice_sends set status = 'enviado' where id = ${sendId}`;
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e).slice(0, 300);
    // Si hubo un intento de texto o audio, el proveedor pudo aceptarlo antes del error.
    const code = e instanceof VoiceRecipientUnavailableError ? "recipient_unavailable" : null;
    await sql`update sales_voice_sends set status = ${outboundStarted ? "enviando" : "error"}, error = ${error}, failure_code = ${code} where id = ${sendId}`;
    if (outboundStarted) throw new OutreachError(`No se pudo confirmar el envío a ${person.name}. Revisá su chat antes de volver a escribirle.`);
    throw e;
  }
  // Ya salió: lo que sigue solo registra. Si falla, el envío no se repite (queda «enviado»).
  if (group === "no_interesa") {
    // No es uno de los tres mensajes: cierra la charla. Queda en la historia y, si seguía «Respondió», pasa a «No le interesa».
    try {
      await sql`insert into sales_outreach_events (outreach_id, kind, channel, detail) values (${outreachId}, 'mensaje', 'whatsapp', ${`Pedido de feedback: «${text.slice(0, 300)}»`})`;
      await sql`update sales_outreach set last_contact_at = now(), last_channel = 'whatsapp', updated_at = now() where id = ${outreachId}`;
      await setOutreachStatus(outreachId, "no_interesa", "dijo que no por WhatsApp");
    } catch (e) {
      console.error("Pedido de feedback enviado pero no se pudo registrar", e instanceof Error ? e.message : e);
    }
    return { name: person.name };
  }
  try {
    // El Paso 1 y el 2 se registran como tales (no son de los tres mensajes); el resto, como uno de los tres.
    await recordTouch(outreachId, "whatsapp", {
      touch: group !== "saludo" && group !== "permiso",
      properties: { message_format: note ? "audio" : "texto", voice_note: note?.label ?? null, voice_stage: group ?? null },
    });
    if (note) await sql`insert into sales_outreach_events (outreach_id, kind, channel, detail) values (${outreachId}, 'nota', 'whatsapp', ${`Audio de seguimiento: «${note.label}»`})`;
    // El chat ya existe en esta línea: los próximos envíos de esta persona salen de acá sin confirmarlo a mano.
    if (config.phone) {
      await sql`insert into sales_outreach_whatsapp_senders (outreach_id, phone, sender_phone) values (${outreachId}, ${person.phone}, ${config.phone}) on conflict do nothing`;
    }
  } catch (e) {
    console.error("Envío hecho pero no se pudo registrar el contacto", e instanceof Error ? e.message : e);
  }
  return { name: person.name };
}
