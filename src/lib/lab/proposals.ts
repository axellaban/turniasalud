import "server-only";
import { json, sql } from "../db";
import { getClinic } from "../clinic";
import { setupAgent } from "../agent/setup";
import { TOOL_DEFINITIONS } from "../agent/tools";
import type { Clinic } from "../types";
import { referenceCases, type Condition, type Dimension, type LabCase } from "./cases";
import { draftCase, proposeImprovements, type CaseDraftOut, type LabFinding, type ProposalDraft } from "./judge";
import { effectivePrompt, patchProblem } from "./prompt";
import { allCases, clinicContextFor, getRun, onRunFinished, runResults, startRun, toScored, variantPrompt, type LabRun } from "./runs";
import { compareRuns } from "./score";

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
  const [prompt, pending, criteria] = await Promise.all([
    effectivePrompt(),
    sql<Array<{ title: string }>>`
      select title from lab_proposals where (clinic_id is null or clinic_id = ${clinic.id}) and status in ('pendiente', 'probando', 'aprobada')`,
    criteriaFor(clinic.id),
  ]);
  const drafts = await proposeImprovements({
    prompt: prompt.prompt,
    clinicName: clinic.name,
    clinicInstructions: clinic.agent_context ?? "",
    failures,
    pending: pending.map((p) => p.title),
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
  for (const p of created.filter((c) => c.layer === "prompt" && c.valid).slice(0, 2)) {
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

/** Una batería terminada de la versión actual (de la última semana), o una nueva para comparar. */
async function baselineFor(clinic: Clinic, actor: string): Promise<string> {
  const current = await effectivePrompt();
  const [recent] = await sql<Array<{ id: string }>>`
    select id from lab_runs
    where clinic_id = ${clinic.id} and kind = 'bateria' and prompt_hash = ${current.hash}
      and status in ('preparando', 'corriendo', 'puntuando', 'terminada') and created_at > now() - interval '7 days'
    order by created_at desc limit 1`;
  if (recent) return recent.id;
  return startRun({ clinic, kind: "bateria", label: "Batería de referencia (versión actual)", cases: await allCases(clinic.id), repeat: 3, createdBy: actor });
}

/** Prueba una mejora de prompt: la versión actual contra la variante, con los mismos casos. */
export async function startExperiment(proposalId: string, actor: string): Promise<string> {
  const p = await getProposal(proposalId);
  if (!p) throw new Error("No encontré la mejora.");
  if (p.layer !== "prompt") throw new Error("Solo se pueden probar en el laboratorio los cambios de prompt.");
  if (!p.clinic_id) throw new Error("La mejora no tiene consultorio.");
  const clinic = await clinicOf(p.clinic_id);
  const prompt = await variantPrompt(p.change);
  const baseline = await baselineFor(clinic, actor);
  const runId = await startRun({
    clinic,
    kind: "experimento",
    label: `Experimento · ${p.title}`,
    cases: await allCases(clinic.id),
    repeat: 3,
    prompt,
    proposalId: p.id,
    baselineRunId: baseline,
    createdBy: actor,
  });
  await sql`update lab_proposals set status = 'probando', experiment_run_id = ${runId}, apply_error = null where id = ${p.id}`;
  return runId;
}

export type ExperimentSummary = {
  ready: boolean;
  base: LabRun | null;
  variant: LabRun | null;
  delta: number | null;
  regressions: number;
  improved: number;
  comparison: ReturnType<typeof compareRuns> | null;
};

export async function experimentSummary(variantRunId: string): Promise<ExperimentSummary> {
  const variant = await getRun(variantRunId);
  const base = variant?.baseline_run_id ? await getRun(variant.baseline_run_id) : null;
  if (!variant || !base || variant.status !== "terminada" || base.status !== "terminada") {
    return { ready: false, base, variant, delta: null, regressions: 0, improved: 0, comparison: null };
  }
  const comparison = compareRuns((await runResults(base.id)).map(toScored), (await runResults(variant.id)).map(toScored));
  const delta = base.score !== null && variant.score !== null ? Math.round((Number(variant.score) - Number(base.score)) * 10) / 10 : null;
  return { ready: true, base, variant, delta, regressions: comparison.regressions.length, improved: comparison.improved.length, comparison };
}

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
    if (!summary.ready) continue;
    await sql`update lab_proposals set status = 'pendiente' where id = ${p.id} and status = 'probando'`;
    // Nivel A con «publicar solas» prendido: si no empeora nada, se aplica sin esperar.
    const [clinic] = await sql<Array<{ lab_settings: { auto_a?: boolean } }>>`select lab_settings from clinics where id = ${p.clinic_id}`;
    if (p.level === "A" && clinic?.lab_settings?.auto_a && summary.delta !== null && summary.delta >= 0 && !summary.regressions) {
      await approveProposal(p.id, "Laboratorio (nivel A, sin regresiones)").catch((e) =>
        console.error("Laboratorio: no se pudo publicar sola la mejora", errorText(e)));
    }
  }
}
onRunFinished(resolveExperiments);

/** Después de cada batería o prueba de «Jugar de paciente»: las propuestas se piden en la próxima vuelta del cron. */
async function queueProposals(run: LabRun): Promise<void> {
  if (run.kind === "experimento") return;
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
const KNOWN_PATIENT = "Ya tiene ficha: no le vuelvas a pedir los datos que están cargados.\nNombre: Laura Prueba\nDNI: 20111222\nCobertura: OSDE plan 210\nLa ficha está completa.\nYa se atendió en el consultorio. No le preguntes si ya vino antes.\nPróximos turnos: ninguno";

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
  const conditions: Condition[] = draft.condiciones.slice(0, 6).map((c) => ({ text: c.texto, dim: c.dimension, ...(c.critica && { critical: true }) }));
  return {
    id,
    titulo: draft.titulo.slice(0, 160),
    intent: draft.motivo,
    situation: draft.situacion,
    patient: draft.paciente_nuevo ? { name: "desconocido", context: NEW_PATIENT } : { name: "Laura Prueba", context: KNOWN_PATIENT },
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
