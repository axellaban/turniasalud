import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { OUTREACH_COLUMNS, outreachSheetRows, queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";
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
  outreachSettings,
  recordTouch,
  saveOutreachSettings,
  setOutreachStatus,
  undoLastTouch,
  updateOutreach,
  type OutreachEdit,
} from "@/lib/sales/outreach";
import { json, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

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

async function apply(id: string, a: Action): Promise<void> {
  switch (a.type) {
    case "sent": {
      const channel = SENT_CHANNEL[a.channel ?? "whatsapp"];
      if (!channel) throw new BadRequest("Canal desconocido.");
      // Un reintento (o un doble clic, o un agente que confirma dos veces) no suma otro mensaje: si ya
      // hay uno por el mismo canal en los últimos 2 minutos, se toma como el mismo envío.
      // El saludo y la demo pueden salir con segundos de diferencia: solo es reintento si es el mismo paso
      // (la plantilla dice si es el saludo).
      // Con «step» (0 el saludo, 1 la demo, 2 el seguimiento, 3 el último) el registro es idempotente por
      // estado: si la persona ya tiene ese paso, no se suma nada. Así se puede registrar en lote y repetir.
      if (typeof a.step === "number") {
        const [row] = await sql<Array<{ touches: number; greeted_at: string | null }>>`select touches, greeted_at from sales_outreach where id = ${id}`;
        if (a.step === 0 ? Boolean(row.greeted_at) || row.touches > 0 : row.touches >= a.step) return;
        await recordTouch(id, channel);
        return;
      }
      const [recent] = await sql<Array<{ detail: string }>>`
        select detail from sales_outreach_events where outreach_id = ${id} and kind = 'mensaje' and channel = ${channel}
          and created_at > now() - interval '2 minutes' order by created_at desc limit 1`;
      const greeting = /saludo/.test(String(a.template ?? ""));
      if (recent && a.template && (recent.detail === "saludo") === greeting) return;
      await recordTouch(id, channel);
      return;
    }
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


export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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
