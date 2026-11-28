import "server-only";
import { json, sql } from "../db";
import { env } from "../env";
import { localDateKey } from "../time";
import type { Clinic } from "../types";
import { AXEL_WHATSAPP } from "../sales/contacto-axel";
import { chatIdForPhone, wahaSendText } from "../waha";
import { withGeneralWaha } from "../waha-connections";
import { labJudgeConfigured } from "./judge";
import { LAB_PAUSED_MESSAGE, labAutoRunsAllowed, labPaused } from "./policy";
import { generateProposals } from "./proposals";
import { effectivePrompt, recordPromptVersion } from "./prompt";
import { fillCoverage } from "./coverage";
import { reviewRecentConversations } from "./reviews";
import { advanceRun, allCases, fixOldUsage, openRuns, runCost, startRun, type LabRun } from "./runs";
import { aggregateReviews, type Dims } from "./score";

// La rutina del Laboratorio de Sofi. La corre el cron «calendario» (cada 10 minutos):
//   - de 2 a 6 (hora del consultorio), una batería por noche para cada clínica con el laboratorio prendido;
//   - avanza las corridas abiertas (trae resultados de ElevenLabs y los puntúa);
//   - revisa las charlas reales cerradas;
//   - a partir de las 6, una vez por día, pide propuestas de mejora;
//   - a partir de las 9, una vez por día, manda el resumen por WhatsApp (si está prendido y hay algo).

export type LabSettings = {
  resumen_whatsapp?: boolean;
  auto_a?: boolean;
  last_proposals?: string;
  last_digest?: string;
  proposals_due?: boolean;
  tope_corrida_usd?: number;
  tope_dia_usd?: number;
};

type LabClinic = Clinic & { lab_enabled: boolean; lab_settings: LabSettings };


const localWeekday = (timezone: string, now = new Date()) =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now));

/** Lo gastado hoy en el laboratorio de la clínica (corridas creadas hoy, hora del consultorio), en USD. */
export async function spentToday(clinic: Clinic): Promise<number> {
  const rows = await sql<Array<{ usage: LabRun["usage"] }>>`
    select usage from lab_runs where clinic_id = ${clinic.id}
      and (created_at at time zone ${clinic.timezone})::date = (now() at time zone ${clinic.timezone})::date`;
  return rows.reduce((a, r) => a + runCost(r.usage), 0);
}

/** Tope de gasto diario del laboratorio (USD; por defecto 2). */
export const dailyCap = (clinic: Clinic) => {
  const n = Number((clinic.lab_settings as { tope_dia_usd?: number } | undefined)?.tope_dia_usd);
  return Number.isFinite(n) && n > 0 ? n : 2;
};

async function overDailyCap(clinic: Clinic): Promise<boolean> {
  return (await spentToday(clinic)) >= dailyCap(clinic);
}

const localHour = (timezone: string, now = new Date()) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));

async function setSetting(clinicId: string, patch: LabSettings): Promise<void> {
  await sql`update clinics set lab_settings = lab_settings || ${json(patch)} where id = ${clinicId}`;
}

export async function runLab(budgetMs = 200_000): Promise<Record<string, unknown>> {
  // Pausa total (policy.ts): el cron no lanza, no trae, no revisa ni manda nada.
  if (labPaused()) return { pausado: LAB_PAUSED_MESSAGE };
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  const report: Record<string, unknown> = {};
  const clinics = await sql<LabClinic[]>`select * from clinics where lab_enabled and not is_demo`;

  // Sin ninguna versión registrada (el prompt se cargó directo en ElevenLabs): se toma el actual.
  const [anyVersion] = await sql`select 1 from lab_versions limit 1`;
  if (!anyVersion) {
    const current = await effectivePrompt();
    await recordPromptVersion({ hash: current.hash, applied: current.applied, failed: [] });
  }

  // 1. La batería nocturna (una charla por caso; las que fallan se repiten solas) y, los lunes, la
  //    verificación con ElevenLabs y el modelo de producción. Nada automático si se pasó el tope del día.
  // Regla de costos (policy.ts): nada automático. Las corridas se lanzan a mano desde el panel.
  for (const clinic of labAutoRunsAllowed() ? clinics : []) {
    const hour = localHour(clinic.timezone);
    if (hour < 2 || hour >= 6) continue;
    if (await overDailyCap(clinic)) {
      report[`tope:${clinic.name}`] = "Se alcanzó el tope de gasto del día: las corridas automáticas esperan a mañana.";
      continue;
    }
    const today = localDateKey(new Date(), clinic.timezone);
    const [already] = await sql`
      select 1 from lab_runs where clinic_id = ${clinic.id} and kind = 'bateria' and created_by = 'Laboratorio'
        and (created_at at time zone ${clinic.timezone})::date = ${today}::date limit 1`;
    try {
      if (!already) {
        report[`bateria:${clinic.name}`] = await startRun({ clinic, kind: "bateria", label: "Batería nocturna", cases: await allCases(clinic.id), repeat: 1, createdBy: "Laboratorio" });
      } else if (localWeekday(clinic.timezone) === 1 && hour >= 3) {
        const [verified] = await sql`
          select 1 from lab_runs where clinic_id = ${clinic.id} and kind = 'verificacion' and created_at > now() - interval '6 days' limit 1`;
        if (!verified) {
          const critical = (await allCases(clinic.id)).filter((c) => c.conditions.some((cond) => typeof cond !== "function" && cond.critical)).slice(0, 8);
          report[`verificacion:${clinic.name}`] = await startRun({
            clinic, kind: "verificacion", label: "Verificación semanal con producción (ElevenLabs y Opus)", cases: critical, repeat: 1,
            createdBy: "Laboratorio", engine: "elevenlabs", productionModel: true,
          });
        }
      }
    } catch (e) {
      report[`bateria:${clinic.name}`] = e instanceof Error ? e.message : String(e);
    }
  }

  // 2. Propuestas: después de cada batería o prueba que termina (proposals_due) y, además, una vez por día.
  //    Tardan: si toca, es lo único pesado de esta vuelta.
  for (const clinic of clinics) {
    const today = localDateKey(new Date(), clinic.timezone);
    const due = clinic.lab_settings?.proposals_due || (clinic.lab_settings?.last_proposals !== today && localHour(clinic.timezone) >= 6);
    if (!due || !labJudgeConfigured()) continue;
    const [openBattery] = await sql`
      select 1 from lab_runs where clinic_id = ${clinic.id} and kind = 'bateria' and status in ('preparando', 'corriendo', 'puntuando')
        and created_at > now() - interval '12 hours' limit 1`;
    // Espera a que termine la batería abierta: las propuestas sin sus resultados salen vacías.
    if (openBattery) continue;
    await setSetting(clinic.id, { last_proposals: today, proposals_due: false });
    try {
      report[`propuestas:${clinic.name}`] = await generateProposals(clinic, { actor: "Laboratorio" });
    } catch (e) {
      report[`propuestas:${clinic.name}`] = e instanceof Error ? e.message : String(e);
    }
    return report;
  }

  // 2b. Cobertura: arma casos para los tipos de caso que no tienen ninguno (2 por vuelta, fuera de la
  //     ventana de la batería nocturna para que entren en la próxima).
  for (const clinic of clinics) {
    if (!labJudgeConfigured() || left() < 80_000) break;
    const hour = localHour(clinic.timezone);
    if (hour >= 2 && hour < 6) continue;
    if (await overDailyCap(clinic)) continue;
    try {
      const titles = await fillCoverage(clinic, 2, 70_000);
      if (titles.length) report[`cobertura:${clinic.name}`] = titles;
    } catch (e) {
      report[`cobertura:${clinic.name}`] = e instanceof Error ? e.message : String(e);
    }
  }

  // Consumo guardado con la fórmula vieja (27/11): se recalcula desde ElevenLabs.
  if (labAutoRunsAllowed()) {
    try {
      await fixOldUsage();
    } catch {
      // Se reintenta en la próxima vuelta.
    }
  }

  // 3. Avanzar las corridas abiertas.
  for (const id of await openRuns()) {
    if (left() < 30_000) break;
    try {
      const run = await advanceRun(id, Math.min(140_000, left() - 25_000));
      report[`corrida:${id.slice(0, 8)}`] = run?.status;
    } catch (e) {
      report[`corrida:${id.slice(0, 8)}`] = e instanceof Error ? e.message : String(e);
    }
  }

  // 4. Charlas reales.
  if (left() > 25_000) {
    try {
      report.charlas_revisadas = await reviewRecentConversations(Math.min(45_000, left() - 15_000));
    } catch (e) {
      report.charlas_revisadas = e instanceof Error ? e.message : String(e);
    }
  }

  // 5. El resumen por WhatsApp.
  for (const clinic of clinics) {
    const today = localDateKey(new Date(), clinic.timezone);
    if (!clinic.lab_settings?.resumen_whatsapp || clinic.lab_settings?.last_digest === today || localHour(clinic.timezone) < 9) continue;
    await setSetting(clinic.id, { last_digest: today });
    try {
      const text = await digestText(clinic);
      if (text) await withGeneralWaha(() => wahaSendText(chatIdForPhone(AXEL_WHATSAPP), text, { internal: true }));
      report[`resumen:${clinic.name}`] = text ? "enviado" : "sin novedades";
    } catch (e) {
      // Es un resumen, no un aviso técnico: si WhatsApp falla, no se manda por el canal de avisos.
      report[`resumen:${clinic.name}`] = e instanceof Error ? e.message : String(e);
    }
  }
  return report;
}

const fmt = (n: number | string | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(Number(n))));
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** El resumen del día, o null si no hay nada nuevo para contar. */
export async function digestText(clinic: Clinic): Promise<string | null> {
  const batteries = await sql<Array<{ score: string | null; finished_at: string }>>`
    select score, finished_at from lab_runs where clinic_id = ${clinic.id} and kind = 'bateria' and status = 'terminada' and score is not null
    order by finished_at desc limit 2`;
  const fresh = batteries[0] && Date.now() - new Date(batteries[0].finished_at).getTime() < 26 * 3600_000;
  const reviews = await sql<Array<{ score: string | null; critical: boolean; dims: Dims | null; findings: Array<{ problema: string }> | null }>>`
    select score, critical, dims, findings from lab_reviews
    where clinic_id = ${clinic.id} and not is_test and error is null and reviewed_at > now() - interval '7 days'`;
  const pending = await sql<Array<{ title: string; level: string }>>`
    select title, level from lab_proposals where clinic_id = ${clinic.id} and status = 'pendiente' order by created_at desc limit 5`;
  if (!fresh && !pending.length) return null;
  const real = aggregateReviews(reviews.map((r) => ({ score: r.score === null ? null : Number(r.score), critical: r.critical, dims: r.dims })));
  const problems = new Map<string, number>();
  for (const r of reviews) for (const f of r.findings ?? []) problems.set(f.problema, (problems.get(f.problema) ?? 0) + 1);
  const top = [...problems.entries()].sort((a, b) => b[1] - a[1])[0];
  const lines = [`*Laboratorio de Sofi · ${clinic.name}*`];
  if (batteries[0]) {
    const delta = batteries[1]?.score && batteries[0].score ? Math.round(Number(batteries[0].score) - Number(batteries[1].score)) : null;
    lines.push(`Puntaje en el laboratorio: *${fmt(batteries[0].score)}*${delta !== null ? ` (${signed(delta)})` : ""}`);
  }
  if (reviews.length) lines.push(`Charlas reales, últimos 7 días: *${fmt(real.score)}* (${reviews.length} charlas)`);
  if (top) lines.push(`Lo que más se repite: ${top[0]}`);
  if (pending.length) {
    lines.push("", `Esperan su sí (${pending.length}):`, ...pending.map((p) => `· ${p.title} (nivel ${p.level})`));
  }
  lines.push("", `${env.appUrl().replace(/\/$/, "")}/panel/laboratorio/mejoras`);
  return lines.join("\n");
}
