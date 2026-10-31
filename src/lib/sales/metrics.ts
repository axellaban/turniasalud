import "server-only";
import { sql } from "@/lib/db";
import { DEFAULT_TZ } from "@/lib/time";
import { fijoSinRespuesta } from "./outreach";

// Métricas agregadas para el tablero de Chapa Labs (/api/metricas): prospección, demos, pedidos de
// demo y uso del producto, en totales y por día. Sin nombres, teléfonos ni textos. Las cuentas de la
// prospección son las mismas del panel (outreachStats en outreach.ts). Las clínicas temporales de las
// demos (is_demo) no cuentan como uso real.

const TZ = DEFAULT_TZ;
export type Range = { from: string | null; to: string | null };
type Counts<K extends string> = Record<K, number>;

const REPLIED = ["respondio", "reunion", "cliente", "no_interesa", "baja"];

export async function turniaMetrics({ from, to }: Range) {
  // Un instante cae en el rango según su día en Buenos Aires; sin fechas, todo.
  const inRange = (column: string) =>
    sql`(${from}::date is null or (${sql(column)} at time zone ${TZ})::date >= ${from}::date)
      and (${to}::date is null or (${sql(column)} at time zone ${TZ})::date <= ${to}::date)`;
  const day = (column: string) => sql`to_char((${sql(column)} at time zone ${TZ})::date, 'YYYY-MM-DD')`;
  // Los fijos que no respondieron no cuentan (no tienen WhatsApp), igual que en el panel.
  const cohort = sql`first_contact_at is not null and ${inRange("first_contact_at")} and not ${fijoSinRespuesta()}`;
  const counted = sql`not ${fijoSinRespuesta()}`;

  const [
    [funnel],
    channels,
    zones,
    statuses,
    outreachDaily,
    newDaily,
    [demos],
    demoDaily,
    [leads],
    leadDaily,
    [product],
    productDaily,
  ] = await Promise.all([
    // Cohorte: contactados por primera vez en el período. Prospectados es siempre toda la base.
    sql<Array<Counts<"prospectados" | "contactados" | "abrieron_demo" | "probaron_demo" | "respondieron" | "interesados" | "reuniones" | "clientes" | "no_interesa" | "toques">>>`
      select
        count(*)::int as prospectados,
        count(*) filter (where ${cohort})::int as contactados,
        count(*) filter (where ${cohort} and opened_at is not null)::int as abrieron_demo,
        count(*) filter (where ${cohort} and demo_at is not null)::int as probaron_demo,
        count(*) filter (where ${cohort} and status in ${sql(REPLIED)})::int as respondieron,
        count(*) filter (where ${cohort} and (status in ('respondio', 'reunion', 'cliente') or (status = 'contactado' and (opened_at is not null or demo_at is not null))))::int as interesados,
        count(*) filter (where ${cohort} and status in ('reunion', 'cliente'))::int as reuniones,
        count(*) filter (where ${cohort} and status = 'cliente')::int as clientes,
        count(*) filter (where ${cohort} and status = 'no_interesa')::int as no_interesa,
        coalesce(sum(touches) filter (where ${cohort}), 0)::int as toques
      from sales_outreach o where ${counted}`,
    sql<Array<Record<string, number | string>>>`
      select coalesce(last_channel, 'otro') as canal, count(*)::int as contactados,
        count(*) filter (where status in ${sql(REPLIED)})::int as respondieron,
        count(*) filter (where demo_at is not null)::int as probaron_demo,
        count(*) filter (where status = 'cliente')::int as clientes
      from sales_outreach o where ${cohort} group by 1 order by 2 desc`,
    sql<Array<Record<string, number | string>>>`
      select coalesce(nullif(zone, ''), 'Sin zona') as zona, count(*)::int as prospectados,
        count(*) filter (where ${cohort})::int as contactados,
        count(*) filter (where ${cohort} and status in ${sql(REPLIED)})::int as respondieron,
        count(*) filter (where ${cohort} and status = 'cliente')::int as clientes
      from sales_outreach o where ${counted} group by 1 order by 2 desc limit 12`,
    sql<Array<{ estado: string; cuentas: number }>>`select status as estado, count(*)::int as cuentas from sales_outreach o where ${counted} group by 1 order by 2 desc`,
    sql<Array<Record<string, number | string>>>`
      select ${day("created_at")} as date,
        count(*) filter (where kind = 'mensaje')::int as mensajes,
        count(*) filter (where kind in ('llamada', 'visita'))::int as otros_contactos,
        count(*) filter (where kind = 'abrio')::int as aperturas,
        count(*) filter (where kind = 'demo')::int as demos,
        count(*) filter (where kind = 'estado' and split_part(detail, ':', 1) = 'respondio')::int as respuestas,
        count(*) filter (where kind = 'estado' and split_part(detail, ':', 1) = 'reunion')::int as reuniones,
        count(*) filter (where kind = 'estado' and split_part(detail, ':', 1) = 'cliente')::int as clientes
      from sales_outreach_events where ${inRange("created_at")}
        and outreach_id not in (select o.id from sales_outreach o where ${fijoSinRespuesta()}) group by 1 order by 1`,
    sql<Array<{ date: string; nuevos: number }>>`
      select ${day("first_contact_at")} as date, count(*)::int as nuevos from sales_outreach o where ${cohort} group by 1 order by 1`,
    // Demos de Sofi (web, WhatsApp, llamada): cada sesión es una demo.
    sql<Array<Counts<"iniciadas" | "listas" | "terminadas" | "con_error" | "por_voz">>>`
      select count(*)::int as iniciadas,
        count(*) filter (where status in ('llamada', 'audio', 'chat', 'terminada'))::int as listas,
        count(*) filter (where status = 'terminada')::int as terminadas,
        count(*) filter (where status = 'error')::int as con_error,
        count(*) filter (where status in ('llamada', 'audio'))::int as por_voz
      from demo_sessions where ${inRange("created_at")}`,
    sql<Array<{ date: string; demos: number }>>`
      select ${day("created_at")} as date, count(*)::int as demos from demo_sessions where ${inRange("created_at")} group by 1 order by 1`,
    // Pedidos de demo («Pedí una demo» y la demo del navegador) y su seguimiento.
    sql<Array<Counts<"pedidos" | "contactados" | "demo_agendada" | "ganados" | "descartados">>>`
      select count(*)::int as pedidos,
        count(*) filter (where status in ('contactado', 'demo_agendada', 'ganado'))::int as contactados,
        count(*) filter (where status in ('demo_agendada', 'ganado'))::int as demo_agendada,
        count(*) filter (where status = 'ganado')::int as ganados,
        count(*) filter (where status = 'descartado')::int as descartados
      from leads where ${inRange("created_at")}`,
    sql<Array<{ date: string; pedidos: number }>>`
      select ${day("created_at")} as date, count(*)::int as pedidos from leads where ${inRange("created_at")} group by 1 order by 1`,
    // Uso real: turnos que tomó Turnia (no el panel) y conversaciones de Sofi, en clínicas reales.
    sql<Array<Counts<"clinicas" | "clinicas_activas" | "ultimos7" | "previos7" | "turnos" | "cancelados" | "ausentes" | "atendidos" | "conversaciones">>>`
      select
        (select count(*)::int from clinics where not is_demo) as clinicas,
        (select count(distinct a.clinic_id)::int from appointments a join clinics c on c.id = a.clinic_id
           where not c.is_demo and a.created_at > now() - interval '30 days') as clinicas_activas,
        count(*) filter (where a.created_at > now() - interval '7 days')::int as ultimos7,
        count(*) filter (where a.created_at <= now() - interval '7 days' and a.created_at > now() - interval '14 days')::int as previos7,
        count(*) filter (where ${inRange("a.created_at")})::int as turnos,
        count(*) filter (where ${inRange("a.created_at")} and a.status = 'cancelado')::int as cancelados,
        count(*) filter (where ${inRange("a.created_at")} and a.status = 'ausente')::int as ausentes,
        count(*) filter (where ${inRange("a.created_at")} and a.status = 'atendido')::int as atendidos,
        (select count(*)::int from conversations v join clinics c on c.id = v.clinic_id where not c.is_demo and ${inRange("v.started_at")}) as conversaciones
      from appointments a join clinics c on c.id = a.clinic_id
      where not c.is_demo and a.source <> 'panel'`,
    sql<Array<Record<string, number | string>>>`
      select date, sum(turnos)::int as turnos, sum(conversaciones)::int as conversaciones from (
        select ${day("a.created_at")} as date, count(*) as turnos, 0 as conversaciones
          from appointments a join clinics c on c.id = a.clinic_id
          where not c.is_demo and a.source <> 'panel' and ${inRange("a.created_at")} group by 1
        union all
        select ${day("v.started_at")}, 0, count(*)
          from conversations v join clinics c on c.id = v.clinic_id
          where not c.is_demo and ${inRange("v.started_at")} group by 1
      ) t group by 1 order by 1`,
  ]);

  // Une las dos series de la prospección por día.
  const daily = new Map<string, Record<string, number | string>>();
  for (const row of outreachDaily) daily.set(String(row.date), { ...row, nuevos: 0 });
  for (const row of newDaily) {
    const prev = daily.get(row.date);
    if (prev) prev.nuevos = row.nuevos;
    else daily.set(row.date, { date: row.date, mensajes: 0, otros_contactos: 0, aperturas: 0, demos: 0, respuestas: 0, reuniones: 0, clientes: 0, nuevos: row.nuevos });
  }

  return {
    prospeccion: {
      ...funnel,
      etapas: Object.fromEntries(statuses.map((s) => [s.estado, s.cuentas])),
      porCanal: channels,
      porZona: zones,
      diario: [...daily.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    },
    demos: { ...demos, diario: demoDaily },
    pedidos: { ...leads, diario: leadDaily },
    uso: { ...product, diario: productDaily },
  };
}
