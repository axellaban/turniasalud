import "server-only";
import { json, sql } from "../db";
import { getClinic } from "../clinic";
import { setupAgent } from "../agent/setup";
import { TOOL_DEFINITIONS } from "../agent/tools";
import type { Clinic } from "../types";
import { referenceCases, type Condition, type Dimension, type LabCase } from "./cases";
import { attributeRegression, draftCase, proposeImprovements, refineProposal, type CaseDraftOut, type JudgeUsage, type LabFinding, type ProposalDraft } from "./judge";
import { effectivePrompt, patchProblem } from "./prompt";
import { addJudgeUsage, allCases, clinicContextFor, getRun, onRunFinished, runResults, startRun, toScored, variantPrompt, type LabResult, type LabRun } from "./runs";
import { compareRuns, type CaseComparison } from "./score";
import { normalizeTranscript, transcriptText } from "./transcript";

// Mejoras del Laboratorio de Sofi: Claude las propone a partir de las fallas, se prueban en un experimento
// (la versión actual contra la variante, con los mismos casos) y el equipo decide. Lo aprobado se aplica
// solo: el prompt, con «Actualizar a Sofi»; las instrucciones del consultorio, al momento. Lo que toca
// código o configuración queda aprobado para implementarlo.

export type ProposalLevel = "A" | "B" | "C";
export type ProposalLayer = "prompt" | "consultorio" | "herramienta" | "configuracion";
export type ProposalStatus = "pendiente" | "probando" | "aprobada" | "aplicada" | "rechazada" | "no_aplica";

export type LabProposal = {
  id: string;
  clinic_id: string | null;
  level: ProposalLevel;
  layer: ProposalLayer;
  dimension: Dimension | null;
  title: string;
  why: string;
  evidence: Array<{ cita: string; fuente: string }>;
  change: { old_str?: string; new_str?: string; text?: string };
  status: ProposalStatus;
  experiment_run_id: string | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  applied_at: string | null;
  apply_error: string | null;
  created_at: string;
  parent_id?: string | null;
  attempt?: number;
  analysis?: ExperimentAnalysis | null;
};

/** Hasta cuántos intentos se prueba una mejora antes de dejarla para una persona. */
export const MAX_ATTEMPTS = 3;

export type ExperimentAnalysis = {
  resultado: "gana" | "pierde" | "sin_efecto";
  diferencia: number | null;
  mejoran: string[];
  empeoran: Array<{ case_id: string; relacionado: boolean | null; motivo: string | null }>;
  no_concluyentes: string[];
  texto: string;
  siguiente?: { id: string; titulo: string } | null;
  necesita_persona?: boolean;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 800);

/** Nivel según la regla del laboratorio, aunque Claude haya propuesto otro. Puro. */
export function normalizeLevel(draft: Pick<ProposalDraft, "nivel" | "capa" | "dimension">): ProposalLevel {
  if (draft.dimension === "seguridad" || draft.capa === "consultorio") return "C";
  if (draft.nivel === "A" && draft.capa !== "prompt") return "B";
  return draft.nivel;
}

async function criteriaFor(clinicId: string): Promise<string[]> {
  const rows = await sql<Array<{ text: string }>>`
    select text from lab_criteria where clinic_id is null or clinic_id = ${clinicId} order by created_at desc limit 40`;
  return rows.map((r) => r.text);
}

/** Las fallas recientes en texto, para que Claude proponga. Vacío si no hay nada para mejorar. */
async function recentFailures(clinicId: string, focusResultId?: string): Promise<string> {
  const parts: string[] = [];
  const results = await sql<Array<{ case_id: string; titulo: string | null; conditions: Array<{ pass: boolean; text: string; reason?: string }> | null; checks: Array<{ pass: boolean; text: string; reason?: string }> | null; findings: LabFinding[] | null; score: string | null }>>`
    select r.case_id, (select x->>'titulo' from jsonb_array_elements(l.cases) x where x->>'id' = r.case_id limit 1) as titulo,
      r.conditions, r.checks, r.findings, r.score
    from lab_results r join lab_runs l on l.id = r.run_id
    where ${focusResultId ? sql`r.id = ${focusResultId}` : sql`l.clinic_id = ${clinicId} and l.kind in ('bateria', 'jugar') and l.status = 'terminada' and l.finished_at > now() - interval '3 days' and r.judged and coalesce(r.score, 100) < 90`}
    order by r.score nulls last limit 40`;
  for (const r of results) {
    const failed = [...(r.conditions ?? []), ...(r.checks ?? [])].filter((v) => !v.pass);
    const lines = [
      ...failed.map((v) => `  - No cumple: ${v.text}${v.reason ? ` (${v.reason})` : ""}`),
      ...(r.findings ?? []).map((f) => `  - ${f.problema}${f.cita ? ` · «${f.cita}»` : ""}${f.mejora ? ` · mejor: ${f.mejora}` : ""}`),
    ];
    if (lines.length) parts.push(`Laboratorio · ${r.titulo ?? r.case_id} (puntaje ${r.score ?? "—"}):\n${lines.join("\n")}`);
  }
  if (!focusResultId) {
    const reviews = await sql<Array<{ summary: string | null; findings: LabFinding[] | null; score: string | null; is_test: boolean }>>`
      select summary, findings, score, is_test from lab_reviews
      where clinic_id = ${clinicId} and reviewed_at > now() - interval '7 days' and error is null and coalesce(score, 100) < 90
      order by score nulls last limit 25`;
    for (const r of reviews) {
      const lines = (r.findings ?? []).map((f) => `  - ${f.problema}${f.cita ? ` · «${f.cita}»` : ""}${f.mejora ? ` · mejor: ${f.mejora}` : ""}`);
      if (lines.length) parts.push(`${r.is_test ? "Prueba en producción" : "Charla real"} (puntaje ${r.score ?? "—"}): ${r.summary ?? ""}\n${lines.join("\n")}`);
    }
  }
  const text = parts.join("\n\n");
  return text.length > 40_000 ? `${text.slice(0, 40_000)}\n[recortado]` : text;
}

/** Pide propuestas a Claude y las guarda. Las de prompt que encajan se prueban solas (hasta 2). */
export async function generateProposals(clinic: Clinic, opts: { focusResultId?: string; actor?: string } = {}): Promise<number> {
  const failures = await recentFailures(clinic.id, opts.focusResultId);
  if (!failures) return 0;
  const [prompt, pending, rejected, criteria] = await Promise.all([
    effectivePrompt(),
    sql<Array<{ title: string }>>`
      select title from lab_proposals where (clinic_id is null or clinic_id = ${clinic.id}) and status in ('pendiente', 'probando', 'aprobada')`,
    sql<Array<{ title: string; decision_reason: string | null }>>`
      select title, decision_reason from lab_proposals
      where (clinic_id is null or clinic_id = ${clinic.id}) and status = 'rechazada' and created_at > now() - interval '60 days'
      order by created_at desc limit 30`,
    criteriaFor(clinic.id),
  ]);
  const drafts = await proposeImprovements({
    prompt: prompt.prompt,
    clinicName: clinic.name,
    clinicInstructions: clinic.agent_context ?? "",
    failures,
    pending: pending.map((p) => p.title),
    rejected: rejected.map((r) => `${r.title}${r.decision_reason ? ` — ${r.decision_reason.slice(0, 300)}` : ""}`),
    criteria,
  });
  const known = new Set(pending.map((p) => p.title.trim().toLowerCase()));
  const created: Array<{ id: string; layer: ProposalLayer; valid: boolean }> = [];
  for (const d of drafts) {
    if (known.has(d.titulo.trim().toLowerCase())) continue;
    const change = d.capa === "prompt" ? { old_str: d.reemplazar ?? "", new_str: d.por ?? "" } : { text: d.texto ?? "" };
    const problem = d.capa === "prompt" ? patchProblem(prompt.prompt, change as { old_str: string; new_str: string }) : (d.texto ? null : "Falta el texto del cambio.");
    const [row] = await sql<Array<{ id: string }>>`
      insert into lab_proposals ${sql({
        clinic_id: clinic.id,
        level: normalizeLevel(d),
        layer: d.capa,
        dimension: d.dimension,
        title: d.titulo.slice(0, 200),
        why: d.por_que,
        evidence: json(d.evidencia.slice(0, 6)),
        change: json(change),
        apply_error: problem,
      })} returning id`;
    created.push({ id: row.id, layer: d.capa, valid: !problem });
  }
  // Tope de experimentos automáticos: 1 por día y por clínica (los manuales, desde Mejoras, no tienen tope).
  const [{ today }] = await sql<Array<{ today: number }>>`
    select count(*)::int as today from lab_runs where clinic_id = ${clinic.id} and kind = 'experimento' and created_by = 'Laboratorio' and created_at > now() - interval '24 hours'`;
  const { spentToday, dailyCap } = await import("./tick");
  const capLeft = (await spentToday(clinic)) < dailyCap(clinic);
  for (const p of created.filter((c) => c.layer === "prompt" && c.valid).slice(0, capLeft ? Math.max(0, 1 - today) : 0)) {
    await startExperiment(p.id, opts.actor ?? "Laboratorio").catch((e) => console.error("Laboratorio: no se pudo empezar el experimento", errorText(e)));
  }
  return created.length;
}

export async function getProposal(id: string): Promise<LabProposal | null> {
  const [row] = await sql<LabProposal[]>`select * from lab_proposals where id = ${id}`;
  return row ?? null;
}

async function clinicOf(id: string): Promise<Clinic> {
  const [row] = await sql<Clinic[]>`select * from clinics where id = ${id}`;
  if (!row) throw new Error("No encontré la clínica.");
  return row;
}

/**
 * Casos de un experimento focalizado: los que fallaron en la última batería (los de la dimensión de la
 * mejora primero) más los que tienen condiciones críticas, hasta 8. Puro.
 */
export function focusedCases(all: LabCase[], failing: Array<{ case_id: string; dims: Record<string, number | null> | null }>, dimension: string | null, max = 8): LabCase[] {
  const weak = (r: { dims: Record<string, number | null> | null }) => (dimension && typeof r.dims?.[dimension] === "number" ? (r.dims[dimension] as number) : 100);
  const ordered = [...failing].sort((a, b) => weak(a) - weak(b)).map((r) => r.case_id);
  const critical = all.filter((c) => c.conditions.some((cond) => typeof cond !== "function" && cond.critical)).map((c) => c.id);
  const ids = [...new Set([...ordered, ...critical])].slice(0, max);
  const picked = all.filter((c) => ids.includes(c.id));
  return picked.length ? picked : all.slice(0, max);
}

/** Prueba una mejora de prompt: la versión actual contra la variante, con los mismos casos (focalizados). */
export async function startExperiment(proposalId: string, actor: string): Promise<string> {
  const p = await getProposal(proposalId);
  if (!p) throw new Error("No encontré la mejora.");
  if (p.layer !== "prompt") throw new Error("Solo se pueden probar en el laboratorio los cambios de prompt.");
  if (!p.clinic_id) throw new Error("La mejora no tiene consultorio.");
  const clinic = await clinicOf(p.clinic_id);
  const prompt = await variantPrompt(p.change);
  const all = await allCases(clinic.id);
  const failing = await sql<Array<{ case_id: string; dims: Record<string, number | null> | null }>>`
    select r.case_id, r.dims from lab_results r
    where r.run_id = (select id from lab_runs where clinic_id = ${clinic.id} and kind = 'bateria' and status = 'terminada' order by finished_at desc limit 1)
      and r.judged and r.repetition = 1 and (coalesce(r.score, 0) < 85 or r.critical)`;
  // Un reintento usa los mismos casos que el intento anterior: ahí se vio qué mejoraba y qué se rompía.
  const parentRun = p.parent_id ? await parentExperimentRun(p.parent_id) : null;
  const parentIds = new Set(parentRun?.cases.map((c) => c.id) ?? []);
  const cases = parentIds.size ? all.filter((c) => parentIds.has(c.id)) : focusedCases(all, failing, p.dimension);
  // La versión actual con los mismos casos, para comparar parejo.
  const baseline = await startRun({ clinic, kind: "experimento", label: `Referencia · ${p.title}`, cases, repeat: 1, createdBy: actor });
  const runId = await startRun({
    clinic,
    kind: "experimento",
    label: `Experimento · ${p.title}`,
    cases,
    repeat: 1,
    prompt,
    proposalId: p.id,
    baselineRunId: baseline,
    createdBy: actor,
  });
  await sql`update lab_proposals set status = 'probando', experiment_run_id = ${runId}, apply_error = null where id = ${p.id}`;
  return runId;
}

async function parentExperimentRun(parentId: string): Promise<LabRun | null> {
  const parent = await getProposal(parentId);
  return parent?.experiment_run_id ? getRun(parent.experiment_run_id) : null;
}

export type ExperimentSummary = {
  ready: boolean;
  base: LabRun | null;
  variant: LabRun | null;
  delta: number | null;
  regressions: number;
  improved: number;
  inconclusive: number;
  comparison: ReturnType<typeof compareRuns> | null;
};

export async function experimentSummary(variantRunId: string): Promise<ExperimentSummary> {
  const variant = await getRun(variantRunId);
  const base = variant?.baseline_run_id ? await getRun(variant.baseline_run_id) : null;
  if (!variant || !base || variant.status !== "terminada" || base.status !== "terminada") {
    return { ready: false, base, variant, delta: null, regressions: 0, improved: 0, inconclusive: 0, comparison: null };
  }
  const comparison = compareRuns((await runResults(base.id)).map(toScored), (await runResults(variant.id)).map(toScored));
  const delta = base.score !== null && variant.score !== null ? Math.round((Number(variant.score) - Number(base.score)) * 10) / 10 : null;
  return { ready: true, base, variant, delta, regressions: comparison.regressions.length, improved: comparison.improved.length, inconclusive: comparison.inconclusive.length, comparison };
}

/**
 * Veredicto de un experimento. Gana si algo mejora de forma concluyente y nada empeora por el cambio (lo
 * que empeora por otra cosa, según la segunda instancia, no cuenta). Pierde si algo empeora por el cambio.
 * Si no cambia nada concluyente, no tuvo efecto. Puro.
 */
export function experimentVerdict(
  comparison: { improved: CaseComparison[]; regressions: CaseComparison[]; inconclusive: CaseComparison[] },
  attributions: Record<string, { relacionado: boolean; motivo: string }>,
  delta: number | null,
): ExperimentAnalysis {
  const empeoran = comparison.regressions.map((c) => ({
    case_id: c.case_id,
    relacionado: attributions[c.case_id]?.relacionado ?? null,
    motivo: attributions[c.case_id]?.motivo ?? null,
  }));
  const byChange = empeoran.filter((e) => e.relacionado !== false);
  const resultado = byChange.length ? "pierde" : comparison.improved.length ? "gana" : "sin_efecto";
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    `${n(comparison.improved.length, "caso mejora", "casos mejoran")}`,
    `${n(byChange.length, "empeora por el cambio", "empeoran por el cambio")}`,
    ...(empeoran.length > byChange.length ? [`${n(empeoran.length - byChange.length, "empeora por otra cosa", "empeoran por otra cosa")} (no cuenta)`] : []),
    ...(comparison.inconclusive.length ? [`${n(comparison.inconclusive.length, "no es concluyente", "no son concluyentes")}`] : []),
  ];
  const head = resultado === "gana" ? "Gana" : resultado === "pierde" ? "Pierde" : "Sin efecto";
  return {
    resultado,
    diferencia: delta,
    mejoran: comparison.improved.map((c) => c.case_id),
    empeoran,
    no_concluyentes: comparison.inconclusive.map((c) => c.case_id),
    texto: `${head}: ${parts.join(", ")}.`,
  };
}

const firstRow = (rows: LabResult[], caseId: string, preferCritical = false) => {
  const mine = rows.filter((r) => r.case_id === caseId && r.judged && r.transcript?.length).sort((a, b) => a.repetition - b.repetition);
  return (preferCritical ? mine.find((r) => r.critical) : null) ?? [...mine].sort((a, b) => Number(a.score ?? 0) - Number(b.score ?? 0))[0] ?? null;
};

/** Cuando termina una corrida: cierra los experimentos que la esperaban. */
async function resolveExperiments(run: LabRun): Promise<void> {
  const proposals = await sql<LabProposal[]>`
    select p.* from lab_proposals p join lab_runs v on v.id = p.experiment_run_id
    where p.status = 'probando' and (v.id = ${run.id} or v.baseline_run_id = ${run.id})`;
  for (const p of proposals) {
    const variant = await getRun(p.experiment_run_id as string);
    const base = variant?.baseline_run_id ? await getRun(variant.baseline_run_id) : null;
    if (variant?.status === "error" || base?.status === "error") {
      await sql`update lab_proposals set status = 'pendiente', apply_error = 'El experimento no terminó: mirá la corrida.' where id = ${p.id}`;
      continue;
    }
    const summary = await experimentSummary(p.experiment_run_id as string);
    if (!summary.ready || !summary.comparison || !variant || !base) continue;
    // Toma la mejora (si otra vuelta del cron ya la tomó, sigue de largo).
    const [mine] = await sql`update lab_proposals set status = 'pendiente' where id = ${p.id} and status = 'probando' returning id`;
    if (!mine) continue;
    try {
      const analysis = await analyzeExperiment(p, summary, base, variant);
      await sql`update lab_proposals set analysis = ${json(analysis)} where id = ${p.id}`;
      if (analysis.resultado === "gana") {
        // Nivel A con «publicar solas» prendido: se aplica sin esperar.
        const [clinic] = await sql<Array<{ lab_settings: { auto_a?: boolean } }>>`select lab_settings from clinics where id = ${p.clinic_id}`;
        if (p.level === "A" && clinic?.lab_settings?.auto_a) {
          await approveProposal(p.id, "Laboratorio (nivel A, gana en el experimento)").catch((e) =>
            console.error("Laboratorio: no se pudo publicar sola la mejora", errorText(e)));
        }
      } else if (analysis.resultado === "pierde") {
        await retryProposal(p, analysis, variant);
      }
    } catch (e) {
      console.error("Laboratorio: no se pudo analizar el experimento", errorText(e));
    }
  }
}

/** Compara, pregunta a la segunda instancia si lo que empeoró viene del cambio y arma el veredicto. */
async function analyzeExperiment(p: LabProposal, summary: ExperimentSummary, base: LabRun, variant: LabRun): Promise<ExperimentAnalysis> {
  const comparison = summary.comparison as NonNullable<ExperimentSummary["comparison"]>;
  const [baseRows, variantRows] = await Promise.all([runResults(base.id), runResults(variant.id)]);
  const track = (u: JudgeUsage) => { addJudgeUsage(variant.id, u.usd, u.input_tokens, u.output_tokens, true).catch(() => {}); };
  const attributions: Record<string, { relacionado: boolean; motivo: string }> = {};
  // Las 4 que más empeoran (cada una es una llamada a Opus).
  const worst = [...comparison.regressions].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 4);
  for (const c of worst) {
    const v = firstRow(variantRows, c.case_id, true);
    const b = firstRow(baseRows, c.case_id);
    const snap = variant.cases.find((x) => x.id === c.case_id);
    if (!v || !b || !snap) continue;
    const problems = [
      ...(v.conditions ?? []).filter((x) => !x.pass).map((x) => `- ${x.text}: ${x.reason ?? ""}`),
      ...(v.findings ?? []).map((f) => `- ${f.problema}`),
    ].join("\n");
    try {
      attributions[c.case_id] = await attributeRegression({
        change: p.change,
        caseTitle: snap.titulo,
        scenario: snap.scenario,
        baseTranscript: transcriptText([...normalizeTranscript(snap.history ?? []), ...b.transcript]),
        variantTranscript: transcriptText([...normalizeTranscript(snap.history ?? []), ...v.transcript]),
        variantProblems: problems || v.summary || "",
        track,
      });
    } catch (e) {
      console.error("Laboratorio: no se pudo atribuir la regresión", errorText(e));
    }
  }
  return experimentVerdict(comparison, attributions, summary.delta);
}

/**
 * La mejora perdió: si no llegó al tercer intento y hay margen de gasto, se arma uno nuevo más acotado con lo
 * que se aprendió y se prueba solo. La que perdió queda rechazada (sin sumar un criterio: el problema sigue
 * siendo real). Al tercer intento, queda para una persona.
 */
async function retryProposal(p: LabProposal, analysis: ExperimentAnalysis, variant: LabRun): Promise<void> {
  const attempt = p.attempt ?? 1;
  const note = async (extra: Partial<ExperimentAnalysis>) => {
    await sql`update lab_proposals set analysis = ${json({ ...analysis, ...extra })} where id = ${p.id}`;
  };
  if (p.layer !== "prompt" || !p.clinic_id) return;
  if (attempt >= MAX_ATTEMPTS) {
    await note({ necesita_persona: true, texto: `${analysis.texto} Ya se probaron ${MAX_ATTEMPTS} intentos sin ganar en todos los frentes: necesita que lo mire una persona.` });
    return;
  }
  const clinic = await clinicOf(p.clinic_id);
  const { spentToday, dailyCap } = await import("./tick");
  if ((await spentToday(clinic)) >= dailyCap(clinic)) {
    await note({ texto: `${analysis.texto} No se armó otro intento porque se llegó al tope de gasto del día; podés probarlo mañana desde acá.` });
    return;
  }
  const variantRows = await runResults(variant.id);
  const describe = (ids: string[], withAttribution: boolean) => ids.map((id) => {
    const title = variant.cases.find((c) => c.id === id)?.titulo ?? id;
    const row = firstRow(variantRows, id, true);
    const why = withAttribution ? analysis.empeoran.find((e) => e.case_id === id)?.motivo : null;
    return `- ${title}: ${why ?? row?.summary ?? ""}`;
  }).join("\n");
  const track = (u: JudgeUsage) => { addJudgeUsage(variant.id, u.usd, u.input_tokens, u.output_tokens, true).catch(() => {}); };
  const current = await effectivePrompt();
  const refined = await refineProposal({
    prompt: current.prompt,
    title: p.title,
    why: p.why,
    change: p.change,
    improved: describe(analysis.mejoran, false),
    regressed: describe(analysis.empeoran.filter((e) => e.relacionado !== false).map((e) => e.case_id), true),
    attempt: attempt + 1,
    criteria: await criteriaFor(clinic.id),
    track,
  });
  const change = { old_str: refined.reemplazar, new_str: refined.por };
  const problem = patchProblem(current.prompt, change);
  const [row] = await sql<Array<{ id: string }>>`
    insert into lab_proposals ${sql({
      clinic_id: p.clinic_id,
      level: p.level,
      layer: "prompt",
      dimension: p.dimension,
      title: refined.titulo.slice(0, 200),
      why: refined.por_que,
      evidence: json(p.evidence),
      change: json(change),
      apply_error: problem,
      parent_id: p.id,
      attempt: attempt + 1,
    })} returning id`;
  await sql`
    update lab_proposals set status = 'rechazada', decided_by = 'Laboratorio', decided_at = now(),
      decision_reason = ${`Perdió en el experimento (${analysis.texto}). Se prueba el intento ${attempt + 1}: «${refined.titulo.slice(0, 200)}».`}
    where id = ${p.id}`;
  await note({ siguiente: { id: row.id, titulo: refined.titulo.slice(0, 200) } });
  if (!problem) {
    await startExperiment(row.id, "Laboratorio").catch((e) => console.error("Laboratorio: no se pudo probar el nuevo intento", errorText(e)));
  }
}
onRunFinished(resolveExperiments);

/** Después de cada batería o prueba de «Jugar de paciente»: las propuestas se piden en la próxima vuelta del cron. */
async function queueProposals(run: LabRun): Promise<void> {
  if (run.kind === "experimento" || run.kind === "verificacion") return;
  await sql`update clinics set lab_settings = lab_settings || '{"proposals_due": true}'::jsonb where id = ${run.clinic_id}`;
}
onRunFinished(queueProposals);

/** «Actualizar a Sofi»: el agente general toma el prompt con las mejoras aprobadas. */
async function publishSofi(): Promise<void> {
  const main = await getClinic();
  await setupAgent(main);
  // ElevenLabs fija el agente al empezar cada conversación: las abiertas arrancan de nuevo con el actual.
  await sql`update clinics set context_revision = context_revision + 1 where id in (select clinic_id from channel_conversations where closed_at is null)`;
}

const asLine = (text: string) => (text.trim().startsWith("-") ? text.trim() : `- ${text.trim()}`);

export async function approveProposal(id: string, actor: string, opts: { clinicConfirmed?: boolean } = {}): Promise<string> {
  const p = await getProposal(id);
  if (!p) throw new Error("No encontré la mejora.");
  if (!["pendiente", "probando"].includes(p.status)) throw new Error("Esa mejora ya se decidió.");
  if (p.layer === "prompt") {
    const current = await effectivePrompt();
    const problem = patchProblem(current.prompt, { old_str: p.change.old_str ?? "", new_str: p.change.new_str ?? "" });
    if (problem) throw new Error(problem);
    await sql`update lab_proposals set status = 'aprobada', decided_by = ${actor}, decided_at = now(), apply_error = null where id = ${id}`;
    try {
      await publishSofi();
    } catch (e) {
      await sql`update lab_proposals set apply_error = ${`Aprobada, pero no se pudo actualizar a Sofi: ${errorText(e)}`} where id = ${id}`;
      return "Quedó aprobada, pero no se pudo actualizar a Sofi. Probá «Actualizar a Sofi» desde Sistema.";
    }
    return "Aprobada y publicada: Sofi ya tiene el cambio.";
  }
  if (p.layer === "consultorio") {
    if (!p.clinic_id) throw new Error("La mejora no tiene consultorio.");
    if (!opts.clinicConfirmed) throw new Error("Es una regla del consultorio: confirmá que el consultorio la aprobó.");
    const text = (p.change.text ?? "").trim();
    if (!text) throw new Error("La mejora no tiene el texto a sumar.");
    await sql.begin(async (tx) => {
      await tx`
        update clinics set agent_context = case when coalesce(agent_context, '') = '' then ${asLine(text)} else agent_context || E'\n' || ${asLine(text)} end,
          context_revision = context_revision + 1, updated_at = now()
        where id = ${p.clinic_id}`;
      await tx`insert into clinic_changes (clinic_id, actor, area) values (${p.clinic_id}, ${actor}, 'Laboratorio de Sofi: instrucciones')`;
      await tx`update lab_proposals set status = 'aplicada', decided_by = ${actor}, decided_at = now(), applied_at = now(), apply_error = null where id = ${id}`;
    });
    return "Aplicada: la regla ya está en las instrucciones del consultorio.";
  }
  await sql`update lab_proposals set status = 'aprobada', decided_by = ${actor}, decided_at = now() where id = ${id}`;
  return "Aprobada. Toca código o configuración: queda en la lista para implementarla.";
}

export async function rejectProposal(id: string, actor: string, reason: string): Promise<void> {
  const p = await getProposal(id);
  if (!p) throw new Error("No encontré la mejora.");
  const why = reason.trim();
  if (!why) throw new Error("Escribí por qué no: queda como criterio para no volver a proponerla.");
  await sql.begin(async (tx) => {
    await tx`update lab_proposals set status = 'rechazada', decision_reason = ${why}, decided_by = ${actor}, decided_at = now() where id = ${id}`;
    await tx`insert into lab_criteria (clinic_id, text, proposal_id, created_by) values (${p.clinic_id}, ${`No proponer «${p.title}»: ${why}`}, ${id}, ${actor})`;
  });
}

/** Saca de Sofi una mejora ya aplicada. */
export async function revertProposal(id: string, actor: string): Promise<string> {
  const p = await getProposal(id);
  if (!p) throw new Error("No encontré la mejora.");
  if (p.layer === "prompt" && ["aprobada", "aplicada"].includes(p.status)) {
    await sql`update lab_proposals set status = 'rechazada', decision_reason = 'Se quitó de Sofi.', decided_by = ${actor}, decided_at = now() where id = ${id}`;
    await publishSofi();
    return "Listo: Sofi volvió a la versión sin ese cambio.";
  }
  if (p.layer === "consultorio" && p.status === "aplicada" && p.clinic_id) {
    const line = asLine(p.change.text ?? "");
    await sql`
      update clinics set agent_context = replace(replace(agent_context, ${`\n${line}`}, ''), ${line}, ''),
        context_revision = context_revision + 1, updated_at = now()
      where id = ${p.clinic_id}`;
    await sql`update lab_proposals set status = 'rechazada', decision_reason = 'Se quitó de las instrucciones.', decided_by = ${actor}, decided_at = now() where id = ${id}`;
    return "Listo: la regla se sacó de las instrucciones del consultorio.";
  }
  throw new Error("Esa mejora no está aplicada.");
}

export async function addCriterion(clinicId: string | null, text: string, actor: string): Promise<void> {
  if (!text.trim()) throw new Error("Escribí el criterio.");
  await sql`insert into lab_criteria (clinic_id, text, created_by) values (${clinicId}, ${text.trim().slice(0, 1000)}, ${actor})`;
}

// ---------------------------------------------------------------------------
// Casos nuevos con Claude
// ---------------------------------------------------------------------------
const toolsText = () =>
  TOOL_DEFINITIONS.filter((t) => !t.description.startsWith("Solo para el equipo"))
    .map((t) => `- ${t.name}: ${t.description.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");

const examplesText = () => {
  const cases = referenceCases().filter((c) => ["nuevo-limpieza", "turno-familiar-sin-dni", "urgencia-alarma"].includes(c.id));
  return cases.map((c) => Object.entries(c.mocks).map(([name, mock]) => `${name}: ${JSON.stringify(mock)}`).join("\n")).join("\n");
};

const NEW_PATIENT = "No hay una ficha para este número. Si dice o da a entender que ya es paciente, usá buscar_paciente con su DNI y su nombre y apellido (pedile solo lo que no te haya dicho) antes de pedir cualquier otro dato. Si es nuevo, pedí nombre y apellido, DNI y cobertura antes de reservar.";
const knownPatient = (name: string) => `Ya tiene ficha: no le vuelvas a pedir los datos que están cargados.\nNombre: ${name}\nDNI: 20111222\nCobertura: OSDE plan 210\nLa ficha está completa.\nYa se atendió en el consultorio. No le preguntes si ya vino antes.\nPróximos turnos: ninguno`;

/**
 * El nombre del paciente que escribe, sacado del escenario («Sos Julián Ferreyra, …»). La ficha del caso
 * tiene que ser de esa persona: si el escenario dice Julián y la ficha Laura, Sofi «usa datos de otra
 * persona» y el juez lo marca como falla crítica sin que sea culpa de Sofi. Puro.
 */
export function scenarioPatientName(scenario: string): string | null {
  const m = scenario.match(/^\s*Sos ([A-ZÁÉÍÓÚÑ][a-záéíóúñü]+(?: [A-ZÁÉÍÓÚÑ][a-záéíóúñü]+){1,2})\b/);
  return m ? m[1] : null;
}

/**
 * Una condición de un caso armado solo puede ser crítica si es de Seguridad o si habla de inventar un
 * turno o un estado (reservado, cancelado, movido, existe). Lo de procedimiento (confirmar antes, pedir
 * datos, trato) nunca es crítico: una sola crítica deja la corrida en 69. Puro.
 */
export function isCriticalKind(c: { texto: string; dimension: string }): boolean {
  return c.dimension === "seguridad" || /\b(invent|afirma que (el|un) turno|existe|qued[oó] (reservad|cancelad|movid))/i.test(c.texto);
}

/** Convierte lo que devolvió Claude en un caso. Las respuestas que no son JSON se descartan. Puro. */
export function caseFromDraft(draft: CaseDraftOut, id: string): LabCase {
  const mocks: Record<string, unknown> = {};
  for (const r of draft.respuestas) {
    try {
      mocks[r.herramienta] = JSON.parse(r.respuesta_json);
    } catch {
      // Una respuesta mal escrita: la herramienta devuelve error en la simulación.
    }
  }
  const conditions: Condition[] = draft.condiciones.slice(0, 6).map((c) => ({ text: c.texto, dim: c.dimension, ...(c.critica && isCriticalKind(c) && { critical: true }) }));
  return {
    id,
    titulo: draft.titulo.slice(0, 160),
    intent: draft.motivo,
    situation: draft.situacion,
    patient: draft.paciente_nuevo ? { name: "desconocido", context: NEW_PATIENT } : { name: scenarioPatientName(draft.escenario) ?? "Laura Prueba", context: knownPatient(scenarioPatientName(draft.escenario) ?? "Laura Prueba") },
    scenario: draft.escenario,
    mocks,
    conditions,
  };
}

export async function draftLabCase(clinic: Clinic, request: string): Promise<LabCase> {
  const draft = await draftCase({
    request,
    tools: toolsText(),
    examples: examplesText(),
    clinicContext: await clinicContextFor(clinic),
    criteria: await criteriaFor(clinic.id),
  });
  return caseFromDraft(draft, `caso-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
}

/** Guarda un caso (de una prueba de «Jugar de paciente», una charla real o uno generado) para la batería. */
export async function saveCase(clinicId: string, c: LabCase | { id: string; titulo: string; intent: string; situation: string; scenario: string; patient: { name: string; context: string }; mocks: Record<string, unknown>; conditions: Condition[]; history?: unknown[]; maxTurns?: number | null }, source: "panel" | "charla_real" | "exploratorio", actor: string): Promise<string> {
  const id = c.id.startsWith("caso-") ? c.id : `caso-${Date.now().toString(36)}`;
  await sql`
    insert into lab_cases ${sql({
      id,
      clinic_id: clinicId,
      title: c.titulo,
      intent: c.intent,
      situation: c.situation,
      source,
      scenario: c.scenario,
      patient: json(c.patient),
      mocks: json(c.mocks),
      conditions: json(c.conditions),
      history: json(c.history ?? []),
      max_turns: c.maxTurns ?? null,
      created_by: actor,
    })}
    on conflict (id) do nothing`;
  return id;
}

/** Para «Proponer una mejora» desde una charla del laboratorio. */
export async function proposeFromResult(resultId: string, actor: string): Promise<number> {
  const [row] = await sql<Array<{ clinic_id: string }>>`select l.clinic_id from lab_results r join lab_runs l on l.id = r.run_id where r.id = ${resultId}`;
  if (!row) throw new Error("No encontré esa charla.");
  return generateProposals(await clinicOf(row.clinic_id), { focusResultId: resultId, actor });
}
