import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { OUTREACH_COLUMNS, outreachSheetRows, queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";
import { normalizeInstagram, outreachPhone, type OutreachChannel, type OutreachStatus, type PhoneKind } from "@/lib/sales/outreach-messages";
import {
  OutreachError,
  addOutreachNote,
  recordTouch,
  setOutreachStatus,
  undoLastTouch,
  updateOutreach,
  type OutreachEdit,
} from "@/lib/sales/outreach";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/prospeccion — el panel de prospección de Chapa Labs (/prospecting) opera la prospección
// de Turnia desde acá: registra contactos, estados, notas, próximos pasos y ediciones con las mismas
// funciones y reglas que Panel → Prospección, y la planilla de Google se vuelve a copiar como siempre.
// De servidor a servidor: Authorization: Bearer $PROSPECTING_API_SECRET (o $METRICS_SECRET, la misma
// clave que ya usa /api/metricas). Cuerpo: { code, action, by }. Devuelve la fila de esa persona con
// las mismas columnas que la pestaña «Prospección».

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
  channel?: string;
  outcome?: string;
  detail?: string;
  text?: string;
  nextAt?: string;
  nextStep?: string;
  fields?: Record<string, unknown>;
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
    case "demo":
      throw new BadRequest("Turnia registra sola cuando abre o prueba su demo.");
    default:
      throw new BadRequest("Acción desconocida.");
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { code?: unknown; action?: Action } | null;
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
