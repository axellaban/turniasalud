import "server-only";
import { sql } from "@/lib/db";
import { AXEL_WHATSAPP } from "./contacto-axel";
import { prospectWaha, voiceChannelStatus, waha, type ProspectWaha } from "./voice-outreach";

// ¿Tiene WhatsApp? Al cargar las listas, «fijo» o «celular» sale de cómo venía escrito el número
// (con o sin el 9), y eso falla en los dos sentidos: celulares de Mar del Plata que vinieron sin el 9
// quedan como fijos (y fuera de la cola), y fijos de la Costa o de Necochea que vinieron con el 9 quedan
// como celulares (y se pierde tiempo probándolos). Los prefijos no alcanzan para saberlo: en cada área
// hay bloques de las dos clases. Esto se lo pregunta a WhatsApp (WAHA, check-exists): no le manda nada a
// nadie ni abre un chat. Va de a pocos y despacio, a pedido, para no exponer la línea.

/** Por pedido, y nunca más que esto: la consulta es a los servidores de WhatsApp. */
export const CHECK_MAX = 40;
const PAUSE_MS = 1200;
const NOTE = "Verificación de WhatsApp";

export type CheckChange = { code: string; name: string; from: string; to: string; kind: "movil" | "consultorio" | "fijo" };
export type CheckReport = {
  line: string | null;
  problem?: string;
  checked: number;
  /** Estaban como fijos y tienen WhatsApp: pasan a la cola. */
  toWhatsapp: CheckChange[];
  /** Estaban como celulares y no tienen WhatsApp: pasan a fijo (para llamar). */
  toLandline: CheckChange[];
  /** Quedan como estaban. */
  same: number;
  /** Cuántos quedan sin verificar. */
  left: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** La primera línea de la prospección que está lista. */
async function readyLine(): Promise<{ config: ProspectWaha; label: string } | { problem: string }> {
  const problems: string[] = [];
  for (const ending of [undefined, AXEL_WHATSAPP.slice(-4)]) {
    const status = await voiceChannelStatus(ending);
    if (status.configured && status.ok) {
      const config = prospectWaha(ending)!;
      return { config, label: (config.phone ?? ending ?? "").slice(-4) };
    }
    if (status.configured) problems.push(status.problem ?? "WAHA no está listo.");
  }
  return { problem: problems[0] ?? "No hay ninguna línea de WhatsApp conectada." };
}

/** El WhatsApp de esos 10 dígitos (área + número), o null si no tiene. Primero como celular (54 9). */
export async function whatsappOf(config: ProspectWaha, national: string): Promise<string | null> {
  const res = await waha(config, `/api/contacts/check-exists?phone=549${national}&session=${encodeURIComponent(config.session)}`, { signal: AbortSignal.timeout(10000) });
  const body = (await res.json()) as { numberExists?: boolean; chatId?: string | null };
  if (body.numberExists !== true) return null;
  const digits = String(body.chatId ?? "").split("@")[0].replace(/\D/g, "");
  return /^54[0-9]{10,11}$/.test(digits) ? digits : `549${national}`;
}

/**
 * Verifica hasta `limit` personas por contactar que todavía no se verificaron (primero los celulares,
 * después los fijos, por prioridad) y corrige su número: con WhatsApp como celular (+54 9), sin WhatsApp
 * como fijo (+54). Cada una queda con una nota; las que comparten el número se corrigen juntas.
 */
export async function checkWhatsappNumbers(limit = 20): Promise<CheckReport> {
  const take = Math.max(1, Math.min(CHECK_MAX, Math.floor(limit)));
  const pending = () => sql`
    o.status = 'por_contactar' and o.phone is not null
    and not exists (select 1 from sales_suppressions s where s.phone = o.phone)
    and not exists (select 1 from sales_outreach_events e where e.outreach_id = o.id and e.kind = 'nota' and e.detail like ${NOTE + "%"})`;
  const [{ left }] = await sql<Array<{ left: number }>>`select count(distinct o.phone)::int as left from sales_outreach o where ${pending()}`;
  const report: CheckReport = { line: null, checked: 0, toWhatsapp: [], toLandline: [], same: 0, left };
  const line = await readyLine();
  if ("problem" in line) return { ...report, problem: line.problem };
  report.line = line.label;
  const phones = await sql<Array<{ phone: string }>>`
    select o.phone from sales_outreach o where ${pending()}
    group by o.phone order by bool_or(o.phone_kind = 'fijo'), min(o.priority), min(o.created_at) limit ${take}`;
  for (const [i, { phone }] of phones.entries()) {
    if (i) await sleep(PAUSE_MS);
    const national = phone.replace(/^\+54(9?)/, "");
    if (national.length !== 10) continue;
    let found: string | null;
    try {
      found = await whatsappOf(line.config, national);
    } catch (e) {
      report.problem = `WAHA dejó de responder: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
      break;
    }
    report.checked++;
    // Con WhatsApp: el número que usa WhatsApp (54 9 si es celular; 54 sin el 9 si es un fijo con WhatsApp Business).
    const to = found ? `+${found}` : `+54${national}`;
    const kind: CheckChange["kind"] = !found ? "fijo" : found.startsWith("549") ? "movil" : "consultorio";
    const people = await sql<Array<{ id: string; code: string; name: string; phone_kind: string | null }>>`
      select id, code, name, phone_kind from sales_outreach where phone = ${phone} and status = 'por_contactar'`;
    for (const p of people) {
      const wasLandline = p.phone_kind === "fijo";
      const changed = to !== phone || wasLandline !== (kind === "fijo");
      // El celular o el WhatsApp del consultorio que ya tenía se respeta si el número no cambia.
      const newKind = !changed ? p.phone_kind : kind === "movil" && p.phone_kind === "consultorio" ? "consultorio" : kind;
      await sql.begin(async (tx) => {
        if (changed) await tx`update sales_outreach set phone = ${to}, phone_kind = ${newKind}, updated_at = now() where id = ${p.id}`;
        await tx`insert into sales_outreach_events (outreach_id, kind, detail) values (${p.id}, 'nota', ${
          `${NOTE} (línea ${line.label}): ${found ? "tiene WhatsApp" : "no tiene WhatsApp"}.${changed ? ` Antes: ${phone}${wasLandline ? " (fijo)" : ""}.` : ""}`
        })`;
      });
      if (!changed) report.same++;
      else (found ? report.toWhatsapp : report.toLandline).push({ code: p.code, name: p.name, from: phone, to, kind });
    }
  }
  report.left = Math.max(0, left - report.checked);
  return report;
}
