import "server-only";
import { sql } from "../db";
import { DIMENSIONS, INTENTS, SITUATIONS, VALID_CELLS, isValidCell, type Dimension } from "./cases";
import type { LabFinding } from "./judge";
import type { LabProposal } from "./proposals";
import { allCases, type LabResult, type LabRun } from "./runs";
import { aggregateReviews, type Dims, type RunAggregate } from "./score";

// Lo que muestran las pantallas del Laboratorio de Sofi (Panel → Turnia → Laboratorio de Sofi).

export const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export const INTENT_LABEL: Record<string, string> = {
  agendar: "Turno nuevo",
  reprogramar: "Reprogramar",
  cancelar: "Cancelar",
  confirmar: "Confirmar o consultar su turno",
  consulta_informativa: "Precio, cobertura o información",
  consulta_clinica: "Consulta clínica",
  urgencia: "Dolor o urgencia",
  receta: "Receta",
  resultados: "Resultados",
  orden_medica: "Orden médica",
  facturacion: "Facturación",
  encuesta: "Encuesta",
  otro: "Otro",
};

export const SITUATION_LABEL: Record<string, string> = {
  con_lugar: "Con lugar",
  agenda_llena: "Agenda llena",
  pide_profesional: "Pide profesional",
  pide_franja: "Pide franja horaria",
  dia_sin_atencion: "Día sin atención",
  para_otra_persona: "Para otra persona",
  mensajes_seguidos: "Mensajes seguidos",
  falla_agenda: "Falla la agenda",
  sin_agenda: "Sin agenda",
};

type ReviewRow = { score: string | null; critical: boolean; dims: Dims | null; findings: LabFinding[] | null; is_test: boolean };

export type Overview = {
  latest: LabRun | null;
  previous: LabRun | null;
  running: LabRun | null;
  history: Array<Pick<LabRun, "id" | "score" | "spread" | "prompt_hash" | "finished_at" | "critical_count">>;
  real: RunAggregate & { count: number };
  tests: RunAggregate & { count: number };
  pending: number;
  experimentsReady: number;
  failing: Array<{ text: string; dim: Dimension; count: number; cases: string[] }>;
  realProblems: Array<{ text: string; dim: string; count: number; example: string }>;
};

const asAggregate = (rows: ReviewRow[]) =>
  ({ ...aggregateReviews(rows.map((r) => ({ score: num(r.score), critical: r.critical, dims: r.dims }))), count: rows.length });

export async function labOverview(clinicId: string): Promise<Overview> {
  const [batteries, [running], reviews, [counts]] = await Promise.all([
    sql<LabRun[]>`
      select * from lab_runs where clinic_id = ${clinicId} and kind = 'bateria' and status = 'terminada' and score is not null
      order by finished_at desc limit 8`,
    sql<LabRun[]>`select * from lab_runs where clinic_id = ${clinicId} and status in ('preparando', 'corriendo', 'puntuando') order by created_at desc limit 1`,
    sql<ReviewRow[]>`
      select score, critical, dims, findings, is_test from lab_reviews
      where clinic_id = ${clinicId} and error is null and reviewed_at > now() - interval '7 days'`,
    sql<Array<{ pending: number; ready: number }>>`
      select count(*) filter (where status = 'pendiente')::int as pending,
        count(*) filter (where status = 'pendiente' and experiment_run_id is not null)::int as ready
      from lab_proposals where clinic_id = ${clinicId}`,
  ]);
  const latest = batteries[0] ?? null;
  const failing = new Map<string, { text: string; dim: Dimension; count: number; cases: Set<string> }>();
  if (latest) {
    const results = await sql<Array<Pick<LabResult, "case_id" | "conditions" | "checks">>>`
      select case_id, conditions, checks from lab_results where run_id = ${latest.id} and judged`;
    for (const r of results) {
      for (const v of [...(r.conditions ?? []), ...(r.checks ?? [])]) {
        if (v.pass) continue;
        const item = failing.get(v.text) ?? { text: v.text, dim: v.dim, count: 0, cases: new Set<string>() };
        item.count++;
        item.cases.add(latest.cases.find((c) => c.id === r.case_id)?.titulo ?? r.case_id);
        failing.set(v.text, item);
      }
    }
  }
  const problems = new Map<string, { text: string; dim: string; count: number; example: string }>();
  for (const r of reviews.filter((x) => !x.is_test)) {
    for (const f of r.findings ?? []) {
      const key = f.problema.trim().toLowerCase();
      const item = problems.get(key) ?? { text: f.problema, dim: f.dimension, count: 0, example: f.cita };
      item.count++;
      problems.set(key, item);
    }
  }
  return {
    latest,
    previous: batteries[1] ?? null,
    running: running ?? null,
    history: batteries.slice().reverse(),
    real: asAggregate(reviews.filter((r) => !r.is_test)),
    tests: asAggregate(reviews.filter((r) => r.is_test)),
    pending: counts?.pending ?? 0,
    experimentsReady: counts?.ready ?? 0,
    failing: [...failing.values()].map((f) => ({ ...f, cases: [...f.cases] })).sort((a, b) => b.count - a.count).slice(0, 8),
    realProblems: [...problems.values()].sort((a, b) => b.count - a.count).slice(0, 6),
  };
}

export type CoverageCell = { intent: string; situation: string; cases: number; score: number | null; real: number };

export async function labCoverage(clinicId: string): Promise<{
  cells: CoverageCell[];
  intents: string[];
  situations: string[];
  coverage: number | null;
  reviewed: number;
  testedCells: number;
  validCells: number;
  missingValid: number;
  uncoveredWithReal: CoverageCell[];
}> {
  const cases = await allCases(clinicId);
  const [latest] = await sql<Array<{ id: string }>>`
    select id from lab_runs where clinic_id = ${clinicId} and kind = 'bateria' and status = 'terminada' order by finished_at desc limit 1`;
  const scores = latest
    ? await sql<Array<{ case_id: string; score: string | null }>>`
        select case_id, avg(score) as score from lab_results where run_id = ${latest.id} and score is not null group by case_id`
    : [];
  const real = await sql<Array<{ intent: string; situation: string; n: number }>>`
    select intent, situation, count(*)::int as n from lab_reviews
    where clinic_id = ${clinicId} and not is_test and error is null and intent is not null and situation is not null
      and reviewed_at > now() - interval '30 days'
    group by 1, 2`;
  const key = (i: string, s: string) => `${i}|${s}`;
  const cells = new Map<string, CoverageCell>();
  const cell = (i: string, s: string) => {
    const k = key(i, s);
    if (!cells.has(k)) cells.set(k, { intent: i, situation: s, cases: 0, score: null, real: 0 });
    return cells.get(k) as CoverageCell;
  };
  const caseScores = new Map(scores.map((s) => [s.case_id, num(s.score)]));
  const sums = new Map<string, number[]>();
  for (const c of cases) {
    const x = cell(c.intent, c.situation);
    x.cases++;
    const s = caseScores.get(c.id);
    if (s !== null && s !== undefined) sums.set(key(c.intent, c.situation), [...(sums.get(key(c.intent, c.situation)) ?? []), s]);
  }
  for (const [k, values] of sums) {
    const x = cells.get(k);
    if (x) x.score = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }
  for (const r of real) cell(r.intent, r.situation).real += r.n;
  const reviewed = real.reduce((a, r) => a + r.n, 0);
  const covered = real.filter((r) => (cells.get(key(r.intent, r.situation))?.cases ?? 0) > 0).reduce((a, r) => a + r.n, 0);
  const all = [...cells.values()];
  for (const [i, s] of VALID_CELLS) cell(i, s);
  const usedIntents = INTENTS.filter((i) => all.concat([...cells.values()]).some((c) => c.intent === i));
  const usedSituations = SITUATIONS.filter((s) => [...cells.values()].some((c) => c.situation === s));
  const valid = [...cells.values()].filter((c) => isValidCell(c.intent, c.situation));
  return {
    intents: usedIntents,
    situations: usedSituations,
    coverage: reviewed ? Math.round((covered / reviewed) * 100) : null,
    reviewed,
    cells: [...cells.values()],
    testedCells: valid.filter((c) => c.cases > 0).length,
    validCells: VALID_CELLS.length,
    missingValid: valid.filter((c) => !c.cases).length,
    uncoveredWithReal: [...cells.values()].filter((c) => !c.cases && c.real > 0).sort((a, b) => b.real - a.real),
  };
}

export async function labRuns(clinicId: string, kind?: string): Promise<LabRun[]> {
  return sql<LabRun[]>`
    select * from lab_runs where clinic_id = ${clinicId} ${kind ? sql`and kind = ${kind}` : sql``}
    order by created_at desc limit 60`;
}

export async function labProposals(clinicId: string): Promise<LabProposal[]> {
  return sql<LabProposal[]>`
    select * from lab_proposals where clinic_id = ${clinicId} or clinic_id is null
    order by case status when 'pendiente' then 0 when 'probando' then 1 when 'aprobada' then 2 else 3 end, created_at desc
    limit 80`;
}

export type ReviewListItem = {
  conversation_id: string;
  is_test: boolean;
  score: string | null;
  critical: boolean;
  dims: Dims | null;
  intent: string | null;
  situation: string | null;
  summary: string | null;
  findings: LabFinding[] | null;
  error: string | null;
  reviewed_at: string;
  started_at: string;
  channel: string;
  prompt_hash: string | null;
};

export async function labReviews(clinicId: string, filter: "todas" | "pruebas" | "reales" | "bajas"): Promise<ReviewListItem[]> {
  return sql<ReviewListItem[]>`
    select r.*, c.started_at, c.channel from lab_reviews r join conversations c on c.id = r.conversation_id
    where r.clinic_id = ${clinicId}
      ${filter === "pruebas" ? sql`and r.is_test` : filter === "reales" ? sql`and not r.is_test` : filter === "bajas" ? sql`and r.score < 70` : sql``}
    order by c.started_at desc limit 80`;
}

export async function labCriteria(clinicId: string): Promise<Array<{ id: string; clinic_id: string | null; text: string; created_by: string | null; created_at: string }>> {
  return sql`select id, clinic_id, text, created_by, created_at from lab_criteria where clinic_id is null or clinic_id = ${clinicId} order by created_at desc`;
}

export async function labSavedCases(clinicId: string): Promise<Array<{ id: string; title: string; intent: string; situation: string; source: string; active: boolean; created_at: string }>> {
  return sql`select id, title, intent, situation, source, active, created_at from lab_cases where clinic_id is null or clinic_id = ${clinicId} order by created_at desc`;
}

export const DIMS: Dimension[] = DIMENSIONS;
