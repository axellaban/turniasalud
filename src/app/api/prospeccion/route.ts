import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse, after } from "next/server";
import { OUTREACH_COLUMNS, outreachSheetRows, queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";
import { ensureDemoPreviews } from "@/lib/sales/demo-preview";
import { FollowupError } from "@/lib/sales/followup";
import { FollowupConflict, followupSnapshot, runFollowupOp } from "@/lib/sales/followup-queue";
import { parseOutreachImport } from "@/lib/sales/outreach-import";
import { manualWhatsappSenders, setVoiceSender, voiceSenderPhones } from "@/lib/sales/voice-outreach";
import { lastWhatsappSync, syncWhatsappReplies, whatsappInbox } from "@/lib/sales/whatsapp-sync";
import {
  TEMPLATE_KEYS,
  TEMPLATE_LABEL,
  normalizeInstagram,
  outreachPhone,
  type OutreachChannel,
  type OutreachStatus,
  type PhoneKind,
  type TemplateKey,
} from "@/lib/sales/outreach-messages";
import {
  OutreachError,
  addOutreachNote,
  importOutreach,
  outreachSettings,
  recordTouch,
  saveOutreachSettings,
  setOutreachStatus,
  undoAudio,
  undoLastTouch,
  updateOutreach,
  type OutreachEdit,
} from "@/lib/sales/outreach";
import { json, sql } from "@/lib/db";
import { DEFAULT_TZ } from "@/lib/time";

export const dynamic = "force-dynamic";
// La lectura de WhatsApp (op «whatsapp-sync») recorre los chats de dos líneas.
export const maxDuration = 300;

// /api/prospeccion — el panel de prospección de Chapa Labs (/prospecting) opera la prospección de
// Turnia desde acá, con las mismas funciones y reglas que Panel → Prospección; la planilla de Google se
// vuelve a copiar como siempre. De servidor a servidor: Authorization: Bearer $PROSPECTING_API_SECRET
// (o $METRICS_SECRET, la misma clave que ya usa /api/metricas).
//   GET                          los mensajes (los mismos de Panel → Prospección → Mensajes) y las
//                                clínicas reales, para vincular la cuenta que se le da a cada persona.
//   POST { code, action, by }    una acción sobre una persona; devuelve su fila de la planilla.
//   POST { templates }           guarda mensajes ({ clave: texto }); los demás quedan como estaban.
//   POST { funnel }              guarda las metas del embudo: { perWeek, rates: { paso: 0.45 } }. perWeek es
//                                la meta semanal de saludos de Panel → Prospección (la misma).
//   GET ?vista=filas             la prospección como la planilla «Prospección» ({ header, rows, events }), leída
//                                de la base: Chapa la usa en vez de la copia en Google Sheets. Suma
//                                `whatsappSenders` (la línea de cada uno) y `whatsappInbox` (por código, lo
//                                último que escribió en cada chat y quién escribió último: «Responder» de Chapa).
//   GET ?vista=followup          la cola de Follow-up como la de habita.: { summary, queue, scheduled, blocked,
//                                inbox, funnel, timing, stages, rules, results, changes }.
//   POST { followup: { op, ... }, by }  opera esa cola: claim, open, confirm, fail, release, situation, reply,
//                                snooze, priority, owner, version-create, version-status (los mismos campos que
//                                habita.; `inmobiliaria` es la persona, por id o código). `by` es quien opera.
//   GET ?vista=whatsapp          la última lectura de WhatsApp (también va en ?vista=followup como `whatsapp`).
//   POST { followup: { op: "whatsapp-sync" }, by }  lee los chats de las dos líneas de WAHA de la prospección
//                                y registra las respuestas nuevas (src/lib/sales/whatsapp-sync.ts). Chapa lo
//                                dispara una vez por día; si se pide antes de 10 minutos, devuelve la última.
//   POST { import: { csv, overwrite } }  importa una lista como Panel → Prospección → Importar lista (las
//                                mismas columnas y reglas; overwrite = «Reemplazar los datos de los que ya
//                                están»). Devuelve cuántas personas nuevas y cuántas actualizadas.

function secret(): string | null {
  // Pegada en Vercel puede traer un espacio o un salto de línea de más.
  const s = (process.env.PROSPECTING_API_SECRET || process.env.METRICS_SECRET || "").trim();
  return s.length >= 32 ? s : null;
}

function authorized(request: Request): boolean {
  const s = secret();
  if (!s) return false;
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${s}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Action = {
  type?: string;
  template?: string;
  step?: number;
  channel?: string;
  /** «audio»: el mensaje salió como audio (se marca en «Audio enviado»). */
  format?: string;
  /** Los últimos 4 números de la línea desde la que salió (0022, 5483): queda como su línea confirmada. */
  line?: string;
  /** «refer»: el número nuevo que pasaron (una derivación) y de quién es. */
  phone?: string;
  name?: string;
  outcome?: string;
  detail?: string;
  text?: string;
  nextAt?: string;
  nextStep?: string;
  fields?: Record<string, unknown>;
  clinicId?: string | null;
};

const SENT_CHANNEL: Record<string, OutreachChannel> = { whatsapp: "whatsapp", instagram: "instagram", email: "email" };
// Las etapas del panel común, en los estados de Turnia (no tiene «interesado»: queda como respondió con su detalle).
const OUTCOME: Record<string, OutreachStatus> = {
  respondio: "respondio", interesado: "respondio", reunion: "reunion", cliente: "cliente",
  perdido: "no_interesa", invalido: "sin_canal", baja: "baja",
};
const PHONE_KIND: Record<string, PhoneKind> = { celular: "movil", compartido: "consultorio", fijo: "fijo" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class BadRequest extends Error {}

function editOf(fields: Record<string, unknown>): OutreachEdit {
  const str = (k: string) => (fields[k] === undefined ? undefined : String(fields[k] ?? "").trim());
  const edit: OutreachEdit = {};
  if (str("name") !== undefined) edit.name = str("name");
  if (str("greeting") !== undefined) edit.greeting = str("greeting");
  if (str("org") !== undefined) edit.business_name = str("org");
  if (str("zone") !== undefined) edit.zone = str("zone");
  if (str("email") !== undefined) edit.email = str("email") || null;
  if (str("web") !== undefined) edit.website = str("web") || null;
  if (str("instagram") !== undefined) edit.instagram = normalizeInstagram(str("instagram"));
  if (str("agendaSoftware") !== undefined) edit.agenda_software = str("agendaSoftware")!.slice(0, 80) || null;
  const kind = str("phoneKind") ? PHONE_KIND[str("phoneKind")!] ?? null : null;
  if (str("phone") !== undefined) {
    if (!str("phone")) edit.phone = null;
    else {
      const phone = outreachPhone(str("phone"), kind);
      if (!phone) throw new BadRequest("No entendimos el teléfono.");
      edit.phone = phone.phone;
      edit.phone_kind = phone.kind;
    }
  } else if (kind) edit.phone_kind = kind;
  return edit;
}

/** La línea de la prospección que termina en esos 4 números (o null si no vino). */
function lineOf(a: Action): string | null {
  if (a.line === undefined || a.line === null || a.line === "") return null;
  const ending = String(a.line).replace(/\D/g, "");
  if (ending.length !== 4 || !voiceSenderPhones().some((p) => p.endsWith(ending))) throw new BadRequest("No encontramos esa línea de WhatsApp.");
  return ending;
}

async function apply(id: string, a: Action): Promise<void> {
  switch (a.type) {
    case "sent": {
      const channel = SENT_CHANNEL[a.channel ?? "whatsapp"];
      if (!channel) throw new BadRequest("Canal desconocido.");
      // Desde qué línea salió: se valida antes de registrar y queda como su línea confirmada.
      const line = channel === "whatsapp" ? lineOf(a) : null;
      if (line) {
        await sentStep(id, channel, a);
        await setVoiceSender(id, line, true);
        return;
      }
      return sentStep(id, channel, a);
    }
    case "conversation": {
      // Un mensaje dentro de una conversación abierta (le contestamos a mano desde WhatsApp): no es un paso de
      // la secuencia ni cuenta como uno de los tres mensajes. Mueve «Último contacto» (así deja de figurar como
      // «falta contestarle») y deja la nota. Un reintento en 2 minutos no repite la nota.
      const line = lineOf(a);
      const [row] = await sql<Array<{ status: string; suppressed: boolean }>>`
        select o.status, exists (select 1 from sales_suppressions s where s.phone = o.phone) as suppressed from sales_outreach o where o.id = ${id}`;
      if (!row) throw new BadRequest("No encontramos ese contacto.");
      if (row.status === "baja" || row.suppressed) throw new OutreachError("Pidió no recibir más mensajes.");
      const detail = `Le respondimos por WhatsApp${line ? ` (línea ${line})` : ""}${a.detail ? `: ${String(a.detail).slice(0, 200)}` : ""}`;
      const [recent] = await sql`select 1 from sales_outreach_events where outreach_id = ${id} and kind = 'nota' and detail = ${detail} and created_at > now() - interval '2 minutes'`;
      if (recent) return;
      await sql`update sales_outreach set last_contact_at = now(), last_channel = 'whatsapp', updated_at = now() where id = ${id}`;
      await sql`insert into sales_outreach_events (outreach_id, kind, channel, detail) values (${id}, 'nota', 'whatsapp', ${detail})`;
      if (line) await setVoiceSender(id, line, true);
      return;
    }
    case "refer": {
      // Una derivación: la recepción pasó el WhatsApp de otra persona (el doctor) para la misma cuenta. Queda ese
      // número (su código y su demo no cambian) y la nota con el anterior, así no hay que crear otra ficha.
      const [before] = await sql<Array<{ phone: string | null }>>`select phone from sales_outreach where id = ${id}`;
      if (!before) throw new BadRequest("No encontramos ese contacto.");
      const edit = editOf({ phone: a.phone, phoneKind: "celular" });
      if (!edit.phone) throw new BadRequest("Falta el número nuevo.");
      if (edit.phone === before.phone) throw new BadRequest("Es el mismo número que ya tiene.");
      await updateOutreach(id, edit);
      const who = String(a.name ?? "").trim().slice(0, 80);
      await addOutreachNote(id, `Derivación: pasaron el WhatsApp de ${who || "otra persona"} (${edit.phone}). Antes: ${before.phone ?? "sin número"}.`);
      return;
    }
    default:
      return applyOther(id, a);
  }
}

/** Un mensaje enviado: el saludo, el Paso 2, uno de los tres o un audio (las reglas de siempre). */
async function sentStep(id: string, channel: OutreachChannel, a: Action): Promise<void> {
  if (a.format === "audio") {
    // Un audio de seguimiento mandado a mano. Cuenta como uno de los tres mensajes, salvo que ese
    // día ya se haya registrado un mensaje (el texto y el audio salieron juntos: es uno solo).
    const [today] = await sql`
      select 1 from sales_outreach_events where outreach_id = ${id} and kind = 'mensaje' and detail <> 'saludo'
        and (created_at at time zone ${DEFAULT_TZ})::date = (now() at time zone ${DEFAULT_TZ})::date`;
    if (!today) await recordTouch(id, channel, { properties: { message_format: "audio" } });
    // La nota dice si sumó un mensaje: así, si se desmarca, se sabe si hay que descontarlo.
    const detail = today ? "Audio de seguimiento (a mano, con el mensaje del día)" : "Audio de seguimiento (a mano)";
    await sql`insert into sales_outreach_events (outreach_id, kind, channel, detail) values (${id}, 'nota', ${channel}, ${detail})`;
    return;
  }
  // Un reintento (o un doble clic, o un agente que confirma dos veces) no suma otro mensaje: si ya
  // hay uno por el mismo canal en los últimos 2 minutos, se toma como el mismo envío.
  // El saludo y la demo pueden salir con segundos de diferencia: solo es reintento si es el mismo paso
  // (la plantilla dice si es el saludo).
  // Con «step» (0 el saludo, 1 la demo, 2 el seguimiento, 3 el último) el registro es idempotente por
  // estado: si la persona ya tiene ese paso, no se suma nada. Así se puede registrar en lote y repetir.
  // La demo cuenta como la demo aunque no se haya registrado el Paso 2 (que no tiene número).
  if (typeof a.step === "number") {
    const [row] = await sql<Array<{ touches: number; greeted_at: string | null }>>`select touches, greeted_at from sales_outreach where id = ${id}`;
    if (a.step === 0 ? Boolean(row.greeted_at) || row.touches > 0 : row.touches >= a.step) return;
    await recordTouch(id, channel, { touch: a.step > 0 });
    return;
  }
  // El paso del mensaje: el Paso 1 («saludo»), el Paso 2 («permiso») o uno de los tres.
  const template = String(a.template ?? "");
  const kind = (detail: string) => (detail === "saludo" || detail === "permiso" ? detail : "toque");
  const sentKind = /abridor|saludo/.test(template) ? "saludo" : /permiso/.test(template) ? "permiso" : "toque";
  const [recent] = await sql<Array<{ detail: string }>>`
    select detail from sales_outreach_events where outreach_id = ${id} and kind = 'mensaje' and channel = ${channel}
      and created_at > now() - interval '2 minutes' order by created_at desc limit 1`;
  if (recent && template && kind(recent.detail) === sentKind) return;
  // Un mensaje con link (el Paso 3 o los Seguimientos 1, 2 y 3) es uno de los tres aunque no figure el Paso 2.
  await recordTouch(id, channel, { touch: Boolean(template) && sentKind === "toque" && channel === "whatsapp" });
  return;
}

async function applyOther(id: string, a: Action): Promise<void> {
  switch (a.type) {
    case "call":
      await recordTouch(id, "telefono");
      if (a.detail) await addOutreachNote(id, a.detail);
      return;
    case "visit":
      await recordTouch(id, "persona");
      if (a.detail) await addOutreachNote(id, a.detail);
      return;
    case "outcome": {
      const status = OUTCOME[a.outcome ?? ""];
      if (!status) throw new BadRequest("Resultado desconocido.");
      const detail = [a.outcome === "interesado" ? "interesado" : "", a.detail ?? ""].filter(Boolean).join(": ").slice(0, 300);
      await setOutreachStatus(id, status, detail);
      return;
    }
    case "reopen":
      await setOutreachStatus(id, "contactado", a.detail ?? "reabierta");
      return;
    case "undo":
      await undoLastTouch(id);
      return;
    case "unaudio":
      // «🎤 ✓» tocado otra vez: el audio se había marcado por error.
      await undoAudio(id);
      return;
    case "note":
      if (!String(a.text ?? "").trim()) throw new BadRequest("La nota está vacía.");
      await addOutreachNote(id, String(a.text).slice(0, 2000));
      return;
    case "schedule": {
      const day = String(a.nextAt ?? "").slice(0, 10);
      if (day && !DAY.test(day)) throw new BadRequest("Fecha inválida.");
      await updateOutreach(id, { next_action_on: day || null });
      if (a.nextStep) await addOutreachNote(id, `Próximo paso: ${a.nextStep}`.slice(0, 300));
      return;
    }
    case "edit":
      await updateOutreach(id, editOf(a.fields ?? {}));
      return;
    case "account": {
      // La cuenta real que se le dio (o null para desvincularla).
      const clinicId = a.clinicId ? String(a.clinicId) : null;
      if (clinicId && !/^[0-9a-f-]{36}$/i.test(clinicId)) throw new BadRequest("Esa clínica no existe o es de una demo.");
      if (clinicId) {
        const [clinic] = await sql<Array<{ name: string }>>`select name from clinics where id = ${clinicId}::uuid and not is_demo`;
        if (!clinic) throw new BadRequest("Esa clínica no existe o es de una demo.");
        await sql`update sales_outreach set clinic_id = ${clinicId}::uuid, account_at = coalesce(account_at, now()), updated_at = now() where id = ${id}`;
        await addOutreachNote(id, `Cuenta creada: ${clinic.name}`);
      } else {
        await sql`update sales_outreach set clinic_id = null, account_at = null, updated_at = now() where id = ${id}`;
        await addOutreachNote(id, "Se desvinculó su cuenta.");
      }
      return;
    }
    case "demo":
      throw new BadRequest("Turnia registra sola cuando abre o prueba su demo.");
    default:
      throw new BadRequest("Acción desconocida.");
  }
}


const NO_STORE = { "Cache-Control": "private, no-store" };

/** La historia de cada persona en la forma de la pestaña Actividad de Chapa (la misma de habita.). */
async function activity() {
  const events = await sql<Array<{ at: string; code: string; name: string; kind: string; channel: string | null; detail: string }>>`
    select to_char(e.created_at at time zone ${DEFAULT_TZ}, 'YYYY-MM-DD HH24:MI') as at, o.code, o.name, e.kind, e.channel, e.detail
    from sales_outreach_events e join sales_outreach o on o.id = e.outreach_id
    where e.created_at > now() - interval '180 days' order by e.created_at`;
  const TYPE: Record<string, string> = { mensaje: "mensaje", llamada: "llamada", visita: "visita", nota: "nota", abrio: "abrio_demo", demo: "probo_demo", pidio_hablar: "pidio_hablar" };
  return events.map((e) => {
    const status = e.kind === "estado" ? e.detail.split(":")[0] : "";
    const type = e.kind === "estado" ? ({ respondio: "respondio", reunion: "reunion", cliente: "cliente", no_interesa: "perdido", sin_canal: "invalido", baja: "baja" } as Record<string, string>)[status] ?? "estado" : TYPE[e.kind] ?? e.kind;
    return { at: e.at, id: e.code, account: e.name, type, channel: e.channel ?? "", template: e.kind === "mensaje" ? e.detail : "", detail: e.kind === "mensaje" ? "" : e.detail, by: "" };
  });
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const vista = new URL(request.url).searchParams.get("vista");
  if (vista === "filas") {
    const [rows, events, whatsappSenders, whatsappInboxData] = await Promise.all([outreachSheetRows(), activity(), manualWhatsappSenders(), whatsappInbox()]);
    return NextResponse.json({ header: OUTREACH_COLUMNS, rows, events, whatsappSenders, whatsappInbox: whatsappInboxData }, { headers: NO_STORE });
  }
  if (vista === "followup") {
    const [snapshot, whatsapp] = await Promise.all([followupSnapshot(), lastWhatsappSync()]);
    return NextResponse.json({ ...snapshot, whatsapp }, { headers: NO_STORE });
  }
  if (vista === "whatsapp") return NextResponse.json({ whatsapp: await lastWhatsappSync() }, { headers: NO_STORE });
  const [settings, clinics, [funnel]] = await Promise.all([
    outreachSettings(),
    sql<Array<{ id: string; name: string }>>`select id, name from clinics where not is_demo order by name`,
    sql<Array<{ rates: Record<string, number> }>>`select outreach_funnel_rates as rates from sales_settings where id = 1`,
  ]);
  return NextResponse.json(
    {
      templates: TEMPLATE_KEYS.map((key) => ({ key, ...TEMPLATE_LABEL[key], text: settings.templates[key] })),
      dailyGoal: settings.daily_goal,
      weeklyGoal: settings.weekly_goal,
      funnelRates: funnel?.rates ?? {},
      clinics,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Guarda solo los mensajes que llegan; los demás quedan como estaban (y las metas, igual). */
async function saveTemplates(input: Record<string, unknown>) {
  const current = await outreachSettings();
  const templates = { ...current.templates };
  for (const [key, value] of Object.entries(input)) {
    if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) throw new BadRequest(`No existe el mensaje «${key}».`);
    if (typeof value !== "string" || !value.trim()) throw new BadRequest("El mensaje no puede quedar vacío.");
    templates[key as TemplateKey] = value;
  }
  await saveOutreachSettings({ templates, daily_goal: current.daily_goal, weekly_goal: current.weekly_goal });
}

/** Metas del embudo: la semanal de saludos (la del panel) y la conversión de cada paso. */
async function saveFunnel(input: unknown) {
  const f = (input ?? {}) as { perWeek?: unknown; rates?: unknown };
  const perWeek = Number(f.perWeek);
  if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 2000) throw new BadRequest("La meta semanal va de 1 a 2000.");
  const rates: Record<string, number> = {};
  const entries = Object.entries((f.rates && typeof f.rates === "object" ? f.rates : {}) as Record<string, unknown>);
  if (entries.length > 12) throw new BadRequest("Demasiados pasos.");
  for (const [key, value] of entries) {
    const r = Number(value);
    if (!/^[a-z0-9_]{2,40}$/.test(key) || !Number.isFinite(r) || r <= 0 || r > 1) throw new BadRequest("Cada paso tiene que estar entre 1% y 100%.");
    rates[key] = Math.round(r * 1000) / 1000;
  }
  await sql`update sales_settings set outreach_weekly_goal = ${perWeek}, outreach_funnel_rates = ${json(rates)}, updated_at = now() where id = 1`;
  return { perWeek, rates };
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { code?: unknown; action?: Action; templates?: unknown } | null;
  if (body && "funnel" in body && !body.code) {
    try {
      return NextResponse.json({ funnel: await saveFunnel((body as { funnel: unknown }).funnel) });
    } catch (e) {
      if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 422 });
      throw e;
    }
  }
  if (body && "import" in body && !body.code) return importList((body as { import: unknown }).import);
  if (body && "followup" in body && !body.code) return followupOp(body as { followup?: unknown; by?: unknown });
  if (body?.templates && typeof body.templates === "object" && !body.code) {
    try {
      await saveTemplates(body.templates as Record<string, unknown>);
    } catch (e) {
      if (e instanceof OutreachError || e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 422 });
      throw e;
    }
    const settings = await outreachSettings();
    return NextResponse.json({ templates: TEMPLATE_KEYS.map((key) => ({ key, ...TEMPLATE_LABEL[key], text: settings.templates[key] })) });
  }
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  if (!code || !body?.action || typeof body.action !== "object") return NextResponse.json({ error: "Falta la persona o la acción." }, { status: 400 });
  const [person] = await sql<Array<{ id: string }>>`select id from sales_outreach where code = ${code}`;
  if (!person) return NextResponse.json({ error: "Esa persona no está en la prospección de Turnia." }, { status: 404 });
  try {
    await apply(person.id, body.action);
  } catch (e) {
    if (e instanceof OutreachError || e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("prospecting_api_error", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    return NextResponse.json({ error: "No pudimos registrar el cambio." }, { status: 500 });
  }
  // Como en el panel: la planilla de Google se vuelve a copiar después de responder.
  queueTurniaSheetSync();
  const [row] = await outreachSheetRows(person.id);
  return NextResponse.json({ header: OUTREACH_COLUMNS, row }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Lo mismo que Panel → Prospección → Importar lista: una persona nueva por fila, y quien ya estaba solo
 * completa lo que le falta (o, con overwrite, toma los datos del archivo). Nunca cambia el nombre, el estado
 * ni los contactos. */
/** Una operación de la cola de Follow-up desde Chapa Labs, a nombre de quien opera. */
async function followupOp(body: { followup?: unknown; by?: unknown }) {
  const f = body.followup && typeof body.followup === "object" ? (body.followup as Record<string, unknown>) : null;
  if (!f) return NextResponse.json({ error: "Falta la operación." }, { status: 400 });
  const actor = (typeof body.by === "string" ? body.by.trim().slice(0, 80) : "") || "Chapa Labs";
  if (f.op === "whatsapp-sync") {
    try {
      const report = await syncWhatsappReplies(actor);
      if (report.totals.nuevas && !report.reused) {
        revalidatePath("/panel/prospeccion");
        revalidatePath("/panel/follow-up");
        queueTurniaSheetSync();
      }
      return NextResponse.json({ whatsapp: report }, { headers: NO_STORE });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
  }
  try {
    const result = await runFollowupOp(f.op, f, actor);
    if (["confirm", "fail", "situation", "reply"].includes(String(f.op))) {
      revalidatePath("/panel/prospeccion");
      revalidatePath("/panel/follow-up");
      queueTurniaSheetSync();
    }
    return NextResponse.json(result ?? null, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof FollowupConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof FollowupError || e instanceof OutreachError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}

async function importList(raw: unknown) {
  const input = raw && typeof raw === "object" ? (raw as { csv?: unknown; overwrite?: unknown }) : {};
  const csv = typeof input.csv === "string" ? input.csv : "";
  if (!csv.trim()) return NextResponse.json({ error: "Falta la lista (csv)." }, { status: 400 });
  if (csv.length > 3_000_000) return NextResponse.json({ error: "La lista es muy grande: dividila en partes." }, { status: 413 });
  const preview = parseOutreachImport(csv);
  if (!preview.rows.length) return NextResponse.json({ error: preview.problems[0]?.reason ?? "No encontramos filas para importar.", problems: preview.problems }, { status: 422 });
  const { codes, ...result } = await importOutreach(preview.rows, { overwrite: input.overwrite === true });
  // Como en el panel: las vistas previas de los links se arman después de responder y la planilla se copia.
  after(() => ensureDemoPreviews(codes));
  revalidatePath("/panel/prospeccion");
  queueTurniaSheetSync();
  return NextResponse.json({ ...result, total: preview.total, problems: preview.problems.slice(0, 50) }, { headers: { "Cache-Control": "private, no-store" } });
}
