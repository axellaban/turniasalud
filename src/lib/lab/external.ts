import "server-only";
import { z } from "zod";
import { json, sql } from "../db";
import { isUuid } from "../clinic";
import { localDateKey } from "../time";
import type { Clinic } from "../types";
import { Proposal, RealJudgment, RUBRIC, SimulationJudgment, realVerdictFrom, simulationVerdictFrom, todayLine } from "./judge";
import { LAB_API_RULE } from "./policy";
import { criteriaFor, proposalContext, recentFailures, saveProposalDrafts } from "./proposals";
import { effectivePrompt } from "./prompt";
import { linesFor, reviewCandidates, saveRealReview } from "./reviews";
import { clinicContextFor, maybeFinish, saveJudgment, type LabResult, type LabRun } from "./runs";
import { normalizeTranscript, transcriptText } from "./transcript";

// El trabajo del laboratorio que hace la suscripción (Claude Code o ChatGPT), por regla de policy.ts:
//   pendingWork()  → lo que falta evaluar: charlas simuladas, charlas reales y propuestas, con la rúbrica.
//   applyExternal() → guarda lo que evaluó (mismo formato que el juez del servidor) y cierra las corridas.
// El puntaje lo calcula siempre el servidor (score.ts), con los controles automáticos incluidos: quien evalúa
// solo dice qué condiciones cumple, las cinco notas, si hay falla crítica y los hallazgos.

const MAX_SIMULATIONS = 40;
const MAX_REAL = 12;

/** Saca teléfonos, DNI y mails de una charla real antes de mandarla afuera. Puro. */
export function maskPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[mail]")
    .replace(/\+?\d[\d\s.-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[número]" : m));
}

type LabClinic = Clinic & { lab_enabled: boolean; lab_settings: { proposals_due?: boolean; last_proposals?: string } | null };

export async function pendingWork() {
  const clinics = await sql<LabClinic[]>`select * from clinics where lab_enabled and not is_demo`;
  const byId = new Map(clinics.map((c) => [c.id, c]));

  const rows = await sql<Array<LabResult & { run: LabRun }>>`
    select r.*, to_jsonb(l.*) as run from lab_results r join lab_runs l on l.id = r.run_id
    where l.status in ('corriendo', 'puntuando') and not r.judged and coalesce(r.el_status, '') not in ('pendiente', 'simulando')
    order by l.created_at, r.case_id, r.repetition limit ${MAX_SIMULATIONS * 2}`;
  const simulaciones = rows
    .filter((r) => (r.transcript ?? []).some((l) => l.role === "sofi" && l.text))
    .slice(0, MAX_SIMULATIONS)
    .map((r) => {
      const c = r.run.cases.find((x) => x.id === r.case_id);
      const lines = [...normalizeTranscript(c?.history ?? []), ...r.transcript];
      return {
        resultado: r.id,
        corrida: r.run_id,
        tipo_corrida: r.run.kind,
        clinica: r.run.clinic_id,
        caso: r.case_id,
        titulo: c?.titulo ?? r.case_id,
        escenario: c?.scenario ?? "",
        condiciones: (c?.conditions ?? []).map((cond, i) => ({ numero: i + 1, dimension: cond.dim, critica: Boolean(cond.critical), texto: cond.text })),
        charla: transcriptText(lines),
      };
    });

  const candidates = await reviewCandidates(MAX_REAL);
  const charlas_reales = [];
  for (const c of candidates) {
    const lines = await linesFor(c);
    if (!lines.some((l) => l.role === "sofi" && l.text)) continue;
    charlas_reales.push({ conversacion: c.id, clinica: c.clinic_id, prueba: c.is_test, empezo: c.started_at, charla: maskPersonalData(transcriptText(lines, 30_000)) });
  }

  const propuestas = [];
  for (const clinic of clinics) {
    const today = localDateKey(new Date(), clinic.timezone);
    const due = clinic.lab_settings?.proposals_due || clinic.lab_settings?.last_proposals !== today;
    if (!due) continue;
    const fallas = await recentFailures(clinic.id);
    if (!fallas) continue;
    const known = await proposalContext(clinic.id);
    propuestas.push({ clinica: clinic.id, fallas, abiertas: known.pending, rechazadas: known.rejected, instrucciones_consultorio: clinic.agent_context ?? "" });
  }

  const involved = new Set([...simulaciones.map((s) => s.clinica), ...charlas_reales.map((c) => c.clinica), ...propuestas.map((p) => p.clinica)]);
  const clinicas = [];
  for (const id of involved) {
    const clinic = byId.get(id) ?? (await sql<Clinic[]>`select * from clinics where id = ${id}`)[0];
    if (!clinic) continue;
    clinicas.push({ id, nombre: clinic.name, contexto: await clinicContextFor(clinic), criterios: await criteriaFor(id) });
  }

  return {
    ok: true,
    regla: LAB_API_RULE,
    hoy: todayLine(),
    rubrica: RUBRIC,
    formatos: {
      simulacion: z.toJSONSchema(SimulationJudgment),
      charla_real: z.toJSONSchema(RealJudgment),
      propuesta: z.toJSONSchema(Proposal),
    },
    clinicas,
    simulaciones,
    charlas_reales,
    propuestas,
    // Solo si hay propuestas para armar: las de capa prompt necesitan el texto exacto a reemplazar.
    prompt_actual: propuestas.length ? (await effectivePrompt()).prompt : null,
  };
}

const Body = z.object({
  evaluador: z.string().trim().min(2).max(80),
  simulaciones: z.array(SimulationJudgment.extend({ resultado: z.string() })).max(100).default([]),
  charlas_reales: z.array(RealJudgment.extend({ conversacion: z.string() })).max(50).default([]),
  propuestas: z.array(z.object({ clinica: z.string(), propuestas: z.array(Proposal).max(4) })).max(10).default([]),
});

export type ExternalResult = { ok: boolean; simulaciones: number; charlas_reales: number; propuestas: number; corridas_cerradas: number; errores: string[] };

export async function applyExternal(raw: unknown): Promise<ExternalResult> {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, simulaciones: 0, charlas_reales: 0, propuestas: 0, corridas_cerradas: 0, errores: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const body = parsed.data;
  const label = `${body.evaluador} (suscripción)`;
  const out: ExternalResult = { ok: true, simulaciones: 0, charlas_reales: 0, propuestas: 0, corridas_cerradas: 0, errores: [] };

  const touched = new Set<string>();
  for (const e of body.simulaciones) {
    if (!isUuid(e.resultado)) { out.errores.push(`Resultado inválido: ${e.resultado}`); continue; }
    const [row] = await sql<Array<LabResult & { run: LabRun }>>`
      select r.*, to_jsonb(l.*) as run from lab_results r join lab_runs l on l.id = r.run_id where r.id = ${e.resultado}`;
    if (!row) { out.errores.push(`No existe el resultado ${e.resultado}.`); continue; }
    if (row.judged) { out.errores.push(`El resultado ${e.resultado} ya estaba evaluado.`); continue; }
    const c = row.run.cases.find((x) => x.id === row.case_id);
    if (!c) { out.errores.push(`El caso ${row.case_id} ya no está en la corrida.`); continue; }
    await saveJudgment(row.run, row, simulationVerdictFrom(c.conditions, e), label);
    touched.add(row.run_id);
    out.simulaciones++;
  }
  for (const runId of touched) {
    await maybeFinish(runId);
    const [r] = await sql`select 1 from lab_runs where id = ${runId} and status = 'terminada'`;
    if (r) out.corridas_cerradas++;
  }

  for (const e of body.charlas_reales) {
    if (!isUuid(e.conversacion)) { out.errores.push(`Charla inválida: ${e.conversacion}`); continue; }
    const [c] = await sql<Array<{ id: string; clinic_id: string; is_test: boolean; started_at: string; elevenlabs_conversation_id: string | null; transcript: unknown }>>`
      select id, clinic_id, is_test, started_at, elevenlabs_conversation_id, transcript from conversations where id = ${e.conversacion}`;
    if (!c) { out.errores.push(`No existe la charla ${e.conversacion}.`); continue; }
    await saveRealReview(c, await linesFor(c), realVerdictFrom(e), label);
    out.charlas_reales++;
  }

  for (const group of body.propuestas) {
    if (!isUuid(group.clinica)) { out.errores.push(`Clínica inválida: ${group.clinica}`); continue; }
    const [clinic] = await sql<Clinic[]>`select * from clinics where id = ${group.clinica}`;
    if (!clinic) { out.errores.push(`No existe la clínica ${group.clinica}.`); continue; }
    // Aunque no haya propuestas: «ya se miró hoy».
    await sql`update clinics set lab_settings = lab_settings || ${json({ last_proposals: localDateKey(new Date(), clinic.timezone), proposals_due: false })} where id = ${clinic.id}`;
    if (group.propuestas.length) out.propuestas += await saveProposalDrafts(clinic, group.propuestas, "Laboratorio");
  }
  return out;
}
