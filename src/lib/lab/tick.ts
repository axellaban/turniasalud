import "server-only";
import { json, sql } from "../db";
import { env } from "../env";
import { localDateKey } from "../time";
import type { Clinic } from "../types";
import { AXEL_WHATSAPP } from "../sales/contacto-axel";
import { chatIdForPhone, wahaSendText } from "../waha";
import { withGeneralWaha } from "../waha-connections";
import { labJudgeConfigured } from "./judge";
import { generateProposals } from "./proposals";
import { reviewRecentConversations } from "./reviews";
import { advanceRun, allCases, openRuns, startRun } from "./runs";
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
};

type LabClinic = Clinic & { lab_enabled: boolean; lab_settings: LabSettings };


const localHour = (timezone: string, now = new Date()) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));

async function setSetting(clinicId: string, patch: LabSettings): Promise<void> {
  await sql`update clinics set lab_settings = lab_settings || ${json(patch)} where id = ${clinicId}`;
}

export async function runLab(budgetMs = 110_000): Promise<Record<string, unknown>> {
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  const report: Record<string, unknown> = {};
  const clinics = await sql<LabClinic[]>`select * from clinics where lab_enabled and not is_demo`;

  // 1. La batería nocturna.
  for (const clinic of clinics) {
    const hour = localHour(clinic.timezone);
    if (hour < 2 || hour >= 6) continue;
    const today = localDateKey(new Date(), clinic.timezone);
    const [already] = await sql`
      select 1 from lab_runs where clinic_id = ${clinic.id} and kind = 'bateria'
        and (created_at at time zone ${clinic.timezone})::date = ${today}::date limit 1`;
    if (already) continue;
    try {
      report[`bateria:${clinic.name}`] = await startRun({ clinic, kind: "bateria", label: "Batería nocturna", cases: await allCases(clinic.id), repeat: 3, createdBy: "Laboratorio" });
    } catch (e) {
      report[`bateria:${clinic.name}`] = e instanceof Error ? e.message : String(e);
    }
  }

  // 2. Las propuestas del día (tardan: si toca, es lo único pesado de esta vuelta).
  for (const clinic of clinics) {
    const today = localDateKey(new Date(), clinic.timezone);
    if (clinic.lab_settings?.last_proposals === today || localHour(clinic.timezone) < 6 || !labJudgeConfigured()) continue;
    const [openBattery] = await sql`
      select 1 from lab_runs where clinic_id = ${clinic.id} and kind = 'bateria' and status in ('preparando', 'corriendo', 'puntuando')
        and created_at > now() - interval '12 hours' limit 1`;
    // Espera a que termine la batería abierta: las propuestas sin sus resultados salen vacías.
    if (openBattery) continue;
    await setSetting(clinic.id, { last_proposals: today });
    try {
      report[`propuestas:${clinic.name}`] = await generateProposals(clinic, { actor: "Laboratorio" });
    } catch (e) {
      report[`propuestas:${clinic.name}`] = e instanceof Error ? e.message : String(e);
    }
    return report;
  }

  // 3. Avanzar las corridas abiertas.
  for (const id of await openRuns()) {
    if (left() < 30_000) break;
    try {
      const run = await advanceRun(id, Math.min(60_000, left() - 25_000));
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
