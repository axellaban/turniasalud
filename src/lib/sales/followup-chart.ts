// «Funnel comercial» de Chapa Labs, como el de habita. (amoblaia: chart, lostAt y chartRows de su
// Follow-up), con los pasos y las definiciones de Turnia (followup-stages.ts → stepOf, EMBUDO.md).
// Puro: lo comparten el servidor y los tests.
//
// Cada barra cuenta a quienes llegaron a ese paso o más lejos, de los saludados en el período
// (por la fecha del saludo, en Buenos Aires). Dentro de la barra: los que pasaron al siguiente,
// los que se quedaron (siguen en seguimiento) y los perdidos (cerrados: no le interesa, sin
// WhatsApp o baja) en ese paso. «Todo» no filtra por fecha.

import { artDay } from "./followup-results";

/** Los pasos del embudo desde el saludo (stepOf: 0 saludado … 6 cliente pago). */
export const CHART_STEPS = [
  "Saludados",
  "Demo enviada",
  "Visitaron la demo",
  "Conversaron con Sofi",
  "Cuenta creada",
  "Cuenta activa",
  "Clientes pagos",
] as const;

export type ChartPeriod = { periodo?: string | null; desde?: string | null; hasta?: string | null };
export type ChartPerson = { id: string; name: string; phone: string | null; greetedAt: string | null; step: number; lost: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

/** El rango de fechas del período (YYYY-MM-DD, Buenos Aires), o null si es «Todo» sin fechas. */
export function chartRange(p: ChartPeriod, now = new Date()): { from: string; to: string } | null {
  const from = p.desde && DATE.test(p.desde) ? p.desde : null;
  const to = p.hasta && DATE.test(p.hasta) ? p.hasta : null;
  if (from || to) return { from: from ?? "0000-01-01", to: to ?? "9999-12-31" };
  const today = artDay(now);
  switch (p.periodo) {
    case "hoy":
      return { from: today, to: today };
    case "7":
      return { from: artDay(now.getTime() - 6 * DAY), to: today };
    case "30":
      return { from: artDay(now.getTime() - 29 * DAY), to: today };
    case "mes":
      return { from: today.slice(0, 8) + "01", to: today };
    default:
      return null;
  }
}

export function commercialChart(people: ChartPerson[], period: ChartPeriod = {}, now = new Date()) {
  const range = chartRange(period, now);
  const cohort = people.filter((p) => {
    if (p.step < 0) return false;
    if (!range) return true;
    if (!p.greetedAt) return false;
    const d = artDay(p.greetedAt);
    return d >= range.from && d <= range.to;
  });
  const counts = CHART_STEPS.map((_, i) => cohort.filter((p) => p.step >= i).length);
  const chart = CHART_STEPS.map((label, i) => ({
    label,
    count: counts[i],
    ofPrevious: i && counts[i - 1] ? Math.round((counts[i] / counts[i - 1]) * 100) : null,
  }));
  const lostAt = CHART_STEPS.map((_, i) => cohort.filter((p) => p.lost && p.step === i).length);
  const chartRows = cohort.map((p) => ({ agencyId: p.id, name: p.name, whatsapp: p.phone, step: p.step, lost: p.lost }));
  return { chart, lostAt, chartRows };
}
