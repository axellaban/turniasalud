import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { json, sql, type TransactionSql } from "@/lib/db";
import { env } from "@/lib/env";
import { elevenlabs } from "@/lib/elevenlabs";
import type { PostCallPayload } from "@/lib/conversations";
import { verifySalesAgent } from "./agent";
import { salesConfiguration, type SalesConfigurationFields } from "./config";

export class SalesError extends Error {}
export const RESERVE_CENTS = 100;
export const OUTCOMES = ["interesado", "seguimiento", "no_interesado", "numero_equivocado"] as const;
export type SalesSettings = SalesConfigurationFields & { config_version: number; needs_sync: boolean; applied_at: string | null; agent_id: string | null; voice_id: string | null; tool_ids: string[]; enabled: boolean; budget_date: string | null; budget_cents: number };
export type Prospect = { id: string; business_name: string; phone: string; website: string; context: string; eligibility: string; evidence: string; reviewed_at: string | null; outcome: string | null; notes: string; suppressed?: boolean };
export type SalesCall = { id: string; prospect_id: string; request_key: string; phone: string; business_name: string; agent_id: string; status: string; conversation_id: string | null; duration_secs: number | null; credits: number | null; summary: string | null; outcome: string | null; error: string | null; transcript: PostCallPayload["transcript"]; created_at: string; config_version: number };

/** No adivina prefijos ni móviles. Se carga el internacional argentino explícito. */
export function salesPhone(value: string): string {
  let n = value.replace(/[\s()-]/g, "");
  if (n.startsWith("00")) n = `+${n.slice(2)}`;
  if (!/^\+54(?:9\d{10}|[1-8]\d{9})$/.test(n)) throw new SalesError("Usá el número argentino internacional: +54, código de área y número; para celular, +54 9 y diez dígitos.");
  return n;
}

export const prospectSchema = z.object({
  business_name: z.string().trim().min(3).max(160),
  phone: z.string().transform(salesPhone),
  website: z.url().max(500).refine((s) => /^https?:\/\//.test(s) && !new URL(s).username && !new URL(s).password, "Web pública inválida"),
  context: z.string().trim().max(3000),
  eligibility: z.enum(["sin_revisar", "solicito_llamada", "no_llame_revisado"]),
  evidence: z.string().trim().max(1500),
}).refine((p) => p.eligibility === "sin_revisar" || p.evidence.length >= 15, "Anotá la fuente y fecha del pedido o de la revisión de No Llame.");

export async function salesSettings(): Promise<SalesSettings> {
  const [s] = await sql<SalesSettings[]>`select * from sales_settings where id = 1`;
  return s;
}

export async function budgetToday() {
  const [row] = await sql<{ today: string; spent: number }[]>`
    select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text as today,
      coalesce((select sum(reserved_cents)::int from sales_calls where budget_date = (now() at time zone 'America/Argentina/Buenos_Aires')::date),0)::int as spent`;
  return row;
}

export async function saveProspect(input: unknown): Promise<string> {
  const p = prospectSchema.parse(input);
  const [row] = await sql<{ id: string }[]>`insert into sales_prospects (business_name, phone, website, context, eligibility, evidence, reviewed_at)
    values (${p.business_name},${p.phone},${p.website},${p.context},${p.eligibility},${p.evidence},${p.eligibility === "sin_revisar" ? null : new Date().toISOString()}) returning id`;
  return row.id;
}

export async function authorizeBudget(cents: number, enabled: boolean): Promise<void> {
  if (!Number.isInteger(cents) || cents < 0 || cents > 10000) throw new SalesError("Presupuesto inválido (US$0 a US$100).");
  await sql.begin(async (tx) => {
    await tx`select id from sales_settings where id = 1 for update`;
    await tx`update sales_settings set budget_cents = ${cents}, enabled = ${enabled && cents >= RESERVE_CENTS}, budget_date = (now() at time zone 'America/Argentina/Buenos_Aires')::date, updated_at = now() where id = 1`;
  });
}

function callToken(id: string, phone: string): string {
  return createHmac("sha256", env.agentToolsSecret()).update(`turnia-sales:${id}:${phone}`).digest("hex");
}

/** Reservar es atómico; el proveedor se llama una sola vez y nunca se reintenta automáticamente. */
export async function dialProspect(prospectId: string, requestKey: string): Promise<string> {
  z.uuid().parse(prospectId); z.uuid().parse(requestKey);
  const reservation = await sql.begin(async (tx) => {
    const [s] = await tx<SalesSettings[]>`select * from sales_settings where id = 1 for update`;
    const [existing] = await tx<SalesCall[]>`select * from sales_calls where request_key = ${requestKey}`;
    if (existing) {
      if (existing.prospect_id !== prospectId) throw new SalesError("La confirmación pertenece a otro consultorio.");
      return { existing: existing.id };
    }
    if (!s.enabled) throw new SalesError("El piloto está pausado. En Comercial → Cupo de hoy, habilitá las llamadas manuales y guardá.");
    if (s.needs_sync) throw new SalesError("La última configuración no se pudo comprobar. Guardá y aplicá de nuevo antes de habilitar llamadas.");
    if (!s.agent_id || !s.voice_id) throw new SalesError("Falta preparar Sofi comercial. Guardá y aplicá su configuración.");
    if (!process.env.ELEVENLABS_PHONE_NUMBER_ID) throw new SalesError("Falta configurar la línea saliente de Turnia en el servidor.");
    const [{ today }] = await tx<{ today: string }[]>`select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text as today`;
    if (s.budget_date !== today) throw new SalesError("La autorización venció. Definí el presupuesto de hoy.");
    const [p] = await tx<Prospect[]>`select * from sales_prospects where id = ${prospectId} for update`;
    if (!p) throw new SalesError("Consultorio inexistente.");
    if ((await tx`select phone from sales_suppressions where phone = ${p.phone}`).length) throw new SalesError("Ese número pidió no recibir más llamadas.");
    if (p.eligibility === "sin_revisar" || p.evidence.length < 15 || !p.reviewed_at || Date.now() - Date.parse(p.reviewed_at) > 24 * 3600_000) throw new SalesError("Falta revisar hoy el permiso de contacto y registrar su evidencia.");
    if ((await tx`select id from sales_calls where status in ('iniciando','en_curso','incierta') limit 1`).length) throw new SalesError("Hay una llamada pendiente. Revisá su resultado antes de iniciar otra.");
    const [{ spent }] = await tx<{ spent: number }[]>`select coalesce(sum(reserved_cents),0)::int as spent from sales_calls where budget_date = ${today}`;
    if (spent + RESERVE_CENTS > s.budget_cents) throw new SalesError("El cupo de hoy no alcanza para otro intento.");
    const context = JSON.stringify({ consultorio: p.business_name, web: p.website, datos_revisados: p.context || "Sin información adicional", motivo_contacto: p.eligibility === "solicito_llamada" ? "Solicitó una llamada" : "Presentación comercial", oferta: "Demo personalizada y después charla con Axel" });
    const [call] = await tx<SalesCall[]>`insert into sales_calls (request_key, prospect_id, agent_id, phone, business_name, context, budget_date, config_version)
      values (${requestKey},${p.id},${s.agent_id},${p.phone},${p.business_name},${context},${today},${s.config_version}) returning *`;
    return { call, settings: s, context };
  });
  if ("existing" in reservation && reservation.existing) return reservation.existing;
  if (!reservation.call || !reservation.settings || !reservation.context) throw new SalesError("No se pudo reservar el intento.");
  const { call, settings, context } = reservation;
  // Fallar antes del POST no marca un inicio incierto. Conservamos la reserva del intento.
  try {
    await verifySalesAgent(settings.agent_id!, settings.voice_id!, settings.tool_ids, salesConfiguration(settings));
  } catch {
    await sql`update sales_calls set status = 'fallida', error = 'No se inició: revisá la configuración de la agente comercial, la pausa y las bajas.', completed_at = now() where id = ${call.id} and status = 'iniciando'`;
    return call.id;
  }
  let dispatched = false;
  try {
    const variables = { business_name: call.business_name, sales_context: context, sales_call_id: call.id, sales_call_token: callToken(call.id, call.phone) };
    if (Object.values(variables).some((v) => !v.trim())) throw new Error("Variables incompletas");
    await sql.begin(async (tx) => {
      // Mantener el mismo lock hasta despachar evita que una baja/pausa se confirme
      // entre la última comprobación y el POST al proveedor.
      await tx`select id from sales_settings where id = 1 for update`;
      const [ready] = await tx`select s.id from sales_settings s where s.id = 1 and s.enabled and s.budget_date = (now() at time zone 'America/Argentina/Buenos_Aires')::date
        and s.config_version = ${settings.config_version}
        and not exists(select 1 from sales_suppressions where phone = ${call.phone})`;
      if (!ready) throw new SalesError("Cambió la configuración, se pausó el piloto o el número fue dado de baja.");
      dispatched = true;
      const result = await elevenlabs<{ success?: boolean; conversation_id?: string | null }>("/v1/convai/twilio/outbound-call", {
      method: "POST", signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ agent_id: settings.agent_id, agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
        to_number: call.phone, call_recording_enabled: true, conversation_initiation_client_data: { dynamic_variables: variables, user_id: `sales-${call.id}` } }),
    });
    if (result.success === false) {
      await tx`update sales_calls set status = 'fallida', error = 'ElevenLabs rechazó el inicio. Revisá el registro del proveedor.', completed_at = now() where id = ${call.id} and status = 'iniciando'`;
    } else {
      await tx`update sales_calls set status = case when status = 'iniciando' then ${result.conversation_id ? "en_curso" : "incierta"} else status end,
        conversation_id = coalesce(conversation_id, ${result.conversation_id ?? null}) where id = ${call.id}`;
    }
    });
  } catch {
    // Un timeout/5xx puede ocurrir DESPUÉS de crear la llamada. No liberar ni reintentar.
    await sql`update sales_calls set status = ${dispatched ? "incierta" : "fallida"}, error = ${dispatched ? "Inicio sin confirmación. Revisá ElevenLabs/Twilio; no reintentes hasta reconciliar." : "No se inició: cambió la configuración, se pausó el piloto o el número fue dado de baja."} where id = ${call.id} and status = 'iniciando'`;
  }
  return call.id;
}

async function suppress(tx: TransactionSql, phone: string, reason: string, callId: string | null) {
  // Mismo orden de locks que la reserva de llamadas: pausa/baja y dial no se pisan.
  await tx`insert into sales_suppressions (phone,reason,source_call_id) values (${phone},${reason},${callId}) on conflict (phone) do nothing`;
  await tx`update sales_prospects set outcome = 'baja' where phone = ${phone}`;
  if (callId) await tx`update sales_calls set outcome = 'baja' where id = ${callId}`;
}

export async function blockProspect(id: string): Promise<void> {
  z.uuid().parse(id);
  await sql.begin(async (tx) => {
    await tx`select id from sales_settings where id = 1 for update`;
    const [p] = await tx<Prospect[]>`select * from sales_prospects where id = ${id}`;
    if (!p) throw new SalesError("Consultorio inexistente.");
    await suppress(tx, p.phone, "Baja manual desde el panel", null);
  });
}

export const salesToolSchema = z.object({ sales_call_id: z.uuid(), sales_call_token: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(1).max(500).optional(), outcome: z.enum(OUTCOMES).optional(), summary: z.string().trim().min(1).max(1500).optional() });
export async function runSalesTool(name: string, raw: unknown) {
  const p = salesToolSchema.parse(raw);
  return sql.begin(async (tx) => {
    await tx`select id from sales_settings where id = 1 for update`;
    const [call] = await tx<SalesCall[]>`select * from sales_calls where id = ${p.sales_call_id} for update`;
    const expected = call ? callToken(call.id, call.phone) : "";
    const a = Buffer.from(expected); const b = Buffer.from(p.sales_call_token);
    if (!call || a.length !== b.length || !timingSafeEqual(a,b) || Date.now() - Date.parse(call.created_at) > 10 * 60_000) throw new SalesError("Llamada o autorización inválida.");
    if (name === "registrar_baja_comercial" && p.reason) {
      await suppress(tx, call.phone, p.reason, call.id);
      return { ok: true, message: "Baja guardada. Este número no puede volver a llamarse desde el piloto. Cerrá con end_call." };
    }
    if (name === "registrar_resultado_comercial" && p.outcome && p.summary) {
      await tx`update sales_calls set outcome = ${p.outcome}, summary = ${p.summary} where id = ${call.id} and outcome is distinct from 'baja'`;
      await tx`update sales_prospects set outcome = ${p.outcome}, notes = ${p.summary} where id = ${call.prospect_id} and outcome is distinct from 'baja'`;
      return { ok: true, message: "Resultado guardado para seguimiento manual de Axel. No se envió ningún mensaje." };
    }
    throw new SalesError("Herramienta o parámetros inválidos.");
  });
}

/** true: evento comercial, jamás debe pasar por memoria/turnos/pacientes. */
export async function recordSalesConversation(data: PostCallPayload): Promise<boolean> {
  const vars = data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const [known] = await sql`select agent_id from sales_settings where agent_id = ${data.agent_id}
    union select agent_id from sales_calls where agent_id = ${data.agent_id} limit 1`;
  if (!known && !vars.sales_call_id) return false;
  const id = z.uuid().safeParse(vars.sales_call_id);
  const [call] = await sql<SalesCall[]>`select * from sales_calls where agent_id = ${data.agent_id} and
    (conversation_id = ${data.conversation_id} or id::text = ${id.success ? id.data : ""}) limit 1`;
  if (!call || (call.conversation_id && call.conversation_id !== data.conversation_id)) return true;
  const transcript = (data.transcript ?? []).map((t) => ({ role: t.role, message: t.message?.slice(0,10000) ?? null, time_in_call_secs: t.time_in_call_secs }));
  const duration = Math.max(0, Math.round(Number(data.metadata?.call_duration_secs) || 0));
  const credits = typeof data.metadata?.cost === "number" ? data.metadata.cost : null;
  await sql.begin(async (tx) => {
    await tx`select id from sales_settings where id = 1 for update`;
    await tx`update sales_calls set conversation_id = ${data.conversation_id}, status = ${data.status === "failed" ? "fallida" : "completada"},
      transcript = ${json(transcript)}, summary = coalesce(${data.analysis?.transcript_summary?.slice(0,6000) ?? null}, summary),
      duration_secs = ${duration}, credits = ${credits}, completed_at = coalesce(completed_at,now()), error = null where id = ${call.id}`;
    // Respaldo conservador si la petición se escuchó pero la herramienta no llegó a ejecutarse.
    const optout = transcript.some((t) => t.role === "user" && /(?:no\s+(?:me\s+)?(?:llamen|llames|llamar|vuelv\w*\s+a\s+llamar)|dejen\s+de\s+llamar|no\s+quiero\s+(?:más\s+)?llamadas|b[oó]rr[ae]me\s+de\s+la\s+lista)/i.test(t.message ?? ""));
    if (optout) await suppress(tx,call.phone,"Petición de baja detectada en la transcripción",call.id);
  });
  return true;
}

export async function refreshSalesCall(id: string, suppliedConversationId?: string): Promise<void> {
  z.uuid().parse(id);
  const [call] = await sql<SalesCall[]>`select * from sales_calls where id = ${id}`;
  const conversationId = call?.conversation_id || suppliedConversationId;
  if (!call || !conversationId || !/^conv_[a-zA-Z0-9]+$/.test(conversationId)) throw new SalesError("No hay ID confirmado. Revisá el proveedor e ingresá su ID de conversación; no repitas la llamada.");
  const data = await elevenlabs<PostCallPayload>(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`, { signal: AbortSignal.timeout(15000) });
  if (data.agent_id !== call.agent_id || data.conversation_initiation_client_data?.dynamic_variables?.sales_call_id !== call.id || data.conversation_id !== conversationId) throw new SalesError("La conversación no pertenece a este intento comercial.");
  if (data.status !== "done" && data.status !== "failed") throw new SalesError("La conversación todavía está en curso o en análisis.");
  await recordSalesConversation(data);
}
