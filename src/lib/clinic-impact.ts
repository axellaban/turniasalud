import "server-only";
import { sql } from "./db";
import { getCatalog, getScheduleBlocks } from "./clinic";
import { expandBlocks, isOpenAt } from "./slots";

// Lo que el consultorio ve en el Inicio sobre lo que hizo Sofi (PLAN_PROTOCOLOS.md, etapa 3). Todo
// sale de sus datos: sin precios cargados no hay valor, y sin ser cliente no hay garantía.

/** Garantía de actividad del Programa Fundadores (src/content/precios.ts): 50 interacciones el primer mes. */
export const ACTIVITY_GUARANTEE = 50;

/** Por dónde da turnos Sofi (los del panel, Smile Connect y las importaciones no cuentan). */
const AGENT_SOURCES = ["whatsapp", "telegram", "telefono", "web", "campana"];

export type Guarantee = {
  /** Cuándo se marcó «Cliente» en Prospección (se cobró el setup). */
  clientAt: string | null;
  /** Primera conversación de Sofi en la clínica: desde ahí corre el primer mes. */
  operationalAt: string | null;
  /** Conversaciones en los 30 días desde la primera. */
  interactions: number;
  /** Fin del primer mes. */
  endsAt: string | null;
};

/**
 * La garantía del primer mes, solo si la clínica es la cuenta de un cliente de la prospección.
 * Mismo cálculo que las columnas «Operativa desde» e «Interacciones del primer mes» de la planilla.
 */
export async function clinicGuarantee(clinicId: string): Promise<Guarantee | null> {
  const [row] = await sql<Array<{ client_at: string | null; operational_at: string | null; interactions: number }>>`
    select
      (select max(e.created_at) from sales_outreach_events e
        where e.outreach_id = o.id and e.kind = 'estado' and split_part(e.detail, ':', 1) = 'cliente') as client_at,
      (select min(v.started_at) from conversations v where v.clinic_id = o.clinic_id) as operational_at,
      (select count(*)::int from conversations v where v.clinic_id = o.clinic_id
        and v.started_at < (select min(v2.started_at) from conversations v2 where v2.clinic_id = o.clinic_id) + interval '30 days') as interactions
    from sales_outreach o
    where o.clinic_id = ${clinicId} and o.status = 'cliente'
    order by o.account_at desc nulls last
    limit 1`;
  if (!row) return null;
  const endsAt = row.operational_at ? new Date(Date.parse(row.operational_at) + 30 * 86400_000).toISOString() : null;
  return { clientAt: row.client_at, operationalAt: row.operational_at, interactions: row.interactions, endsAt };
}

export type AgentBookings = {
  /** Turnos que dio Sofi en el período (sin contar los que después se movieron). */
  total: number;
  /** De esos, los que dio fuera del horario de atención (noches, fines de semana, feriados). */
  outsideHours: number;
  /** Suma de los precios de referencia de los que no se cancelaron, y cuántos tienen precio. */
  value: number;
  priced: number;
  kept: number;
};

/** Los turnos que dio Sofi en los últimos `days` días. Los horarios son los de hoy. */
export async function agentBookings(clinic: { id: string; timezone: string }, days = 30): Promise<AgentBookings> {
  const since = new Date(Date.now() - days * 86400_000);
  const [rows, catalog, blocks] = await Promise.all([
    sql<Array<{ created_at: string; status: string; price: string | null }>>`
      select a.created_at, a.status, t.price from appointments a join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.source = any(${AGENT_SOURCES}::text[]) and a.created_at >= ${since}
        and a.status <> 'reprogramado'`,
    getCatalog(clinic.id),
    getScheduleBlocks(clinic.id, since, new Date()),
  ]);
  const blocked = expandBlocks(blocks, catalog.professionals.map((p) => p.id));
  const kept = rows.filter((r) => r.status !== "cancelado");
  const priced = kept.filter((r) => r.price !== null && Number(r.price) > 0);
  return {
    total: rows.length,
    outsideHours: rows.filter((r) => !isOpenAt(catalog.schedules, blocked, new Date(r.created_at), clinic.timezone)).length,
    value: priced.reduce((sum, r) => sum + Number(r.price), 0),
    priced: priced.length,
    kept: kept.length,
  };
}
