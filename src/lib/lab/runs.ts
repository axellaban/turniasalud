import "server-only";
import { json, sql } from "../db";
import { buildDynamicVariables, getClinic } from "../clinic";
import { elevenlabs } from "../elevenlabs";
import type { Clinic } from "../types";
import { referenceCases, resolveCondition, type Condition, type HistoryLine, type Intent, type LabCase, type Mock, type Situation } from "./cases";
import { judgeSimulation, labJudgeConfigured, type LabFinding } from "./judge";
import { applyPatches, effectivePrompt, promptHash } from "./prompt";
import { aggregateRun, automaticChecks, caseWeights, conversationScore, type Dims, type ScoredResult, type Verdict } from "./score";
import { normalizeTranscript, transcriptText, type LabLine } from "./transcript";

// Corridas del Laboratorio de Sofi: arma las simulaciones en ElevenLabs (agent-testing, todas las
// herramientas simuladas), espera los resultados, los puntúa con el juez y calcula el puntaje.
//
//   preparando → corriendo (ElevenLabs simula) → puntuando (el juez evalúa cada charla) → terminada
//
// Lo avanza el cron «calendario» cada 10 minutos (src/lib/lab/tick.ts) y el panel al abrir una corrida.

export type RunKind = "bateria" | "experimento" | "jugar";
export type RunStatus = "preparando" | "corriendo" | "puntuando" | "terminada" | "error";

/** El caso tal como se corrió: las condiciones ya resueltas para esa clínica. */
export type CaseSnapshot = {
  id: string;
  titulo: string;
  intent: Intent;
  situation: Situation;
  scenario: string;
  patient: { name: string; context: string };
  mocks: Record<string, Mock>;
  conditions: Condition[];
  history: HistoryLine[];
  maxTurns: number | null;
};

export type LabRun = {
  id: string;
  clinic_id: string;
  kind: RunKind;
  status: RunStatus;
  label: string;
  prompt_hash: string;
  prompt_override: string | null;
  proposal_id: string | null;
  baseline_run_id: string | null;
  case_ids: string[];
  repeat_count: number;
  agent_id: string | null;
  /** Modelo con que respondió Sofi en la simulación (null: el del agente, Opus). */
  agent_llm: string | null;
  invocation_id: string | null;
  test_ids: Record<string, string>;
  cases: CaseSnapshot[];
  score: number | null;
  spread: number | null;
  dims: Dims | null;
  critical_count: number;
  error: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type LabResult = {
  id: string;
  run_id: string;
  case_id: string;
  repetition: number;
  el_status: string | null;
  transcript: LabLine[];
  judged: boolean;
  score: number | null;
  dims: Dims | null;
  conditions: Verdict[] | null;
  checks: Verdict[] | null;
  critical: boolean;
  findings: LabFinding[] | null;
  summary: string | null;
  error: string | null;
};

const TEST_PREFIX = "Turnia Lab · ";
const FAKE_PHONE = "5491100000000";
/** Más que esto corriendo en ElevenLabs: se da por perdida. */
const RUN_TIMEOUT_MS = 90 * 60_000;

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------
type CaseRow = {
  id: string;
  title: string;
  intent: Intent;
  situation: Situation;
  scenario: string;
  patient: { name?: string; context?: string };
  mocks: Record<string, Mock>;
  conditions: Condition[];
  history: HistoryLine[];
  max_turns: number | null;
};

/** Los casos guardados desde el panel para esta clínica (o para todas). */
export async function savedCases(clinicId: string): Promise<LabCase[]> {
  const rows = await sql<CaseRow[]>`
    select id, title, intent, situation, scenario, patient, mocks, conditions, history, max_turns from lab_cases
    where active and (clinic_id is null or clinic_id = ${clinicId}) order by created_at`;
  return rows.map((r) => ({
    id: r.id,
    titulo: r.title,
    intent: r.intent,
    situation: r.situation,
    scenario: r.scenario,
    patient: { name: r.patient?.name ?? "desconocido", context: r.patient?.context ?? "" },
    mocks: r.mocks ?? {},
    conditions: r.conditions ?? [],
    history: r.history ?? [],
    ...(r.max_turns && { maxTurns: r.max_turns }),
  }));
}

/** Todos los casos activos: los de referencia (código) y los guardados. */
export async function allCases(clinicId: string): Promise<LabCase[]> {
  return [...referenceCases(), ...(await savedCases(clinicId))];
}

function snapshot(c: LabCase, vars: Record<string, string>): CaseSnapshot {
  return {
    id: c.id,
    titulo: c.titulo,
    intent: c.intent,
    situation: c.situation,
    scenario: c.scenario,
    patient: c.patient,
    mocks: c.mocks,
    conditions: c.conditions.map((cond) => resolveCondition(cond, vars)),
    history: c.history ?? [],
    maxTurns: c.maxTurns ?? null,
  };
}

/** Las variables de la clínica como las arma la conversación real, con un paciente ficticio. */
async function clinicVariables(clinic: Clinic): Promise<Record<string, string>> {
  return buildDynamicVariables(clinic, FAKE_PHONE);
}

/** Lo que el juez necesita saber del consultorio (información, catálogo e instrucciones), recortado. */
export async function clinicContextFor(clinic: Clinic, vars?: Record<string, string>): Promise<string> {
  const v = vars ?? (await clinicVariables(clinic));
  const text = [
    `Nombre: ${clinic.name}. Asistente: ${clinic.agent_name}.`,
    `Trato: ${v.trato ?? ""}`,
    v.clinic_info ?? "",
    v.clinic_catalog ? `Catálogo:\n${v.clinic_catalog}` : "",
    v.urgency_instructions ? `Urgencias: ${v.urgency_instructions}` : "",
  ].filter(Boolean).join("\n\n");
  return text.length > 14_000 ? `${text.slice(0, 14_000)}\n[recortado]` : text;
}

// ---------------------------------------------------------------------------
// Modelo de Sofi en el laboratorio: Haiku (barato), sin tocar el agente real. Se elige de la lista que
// ElevenLabs acepta hoy: LAB_AGENT_LLM si está, si no el Haiku más nuevo disponible.
// ---------------------------------------------------------------------------
let llmCache: { at: number; value: string } | null = null;

/** El modelo de la lista: el pedido si está; si no, el Haiku más nuevo. Puro. */
export function pickLabLlm(available: string[], wanted = "claude-haiku-5-5"): string | null {
  if (available.includes(wanted)) return wanted;
  const haikus = available.filter((id) => /haiku/i.test(id)).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  return haikus[0] ?? null;
}

/** Junta los ids de modelo de la respuesta de /v1/convai/llm/list, tenga la forma que tenga. Puro. */
export function llmIds(body: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === "string" && ["llm", "id", "model_id", "name"].includes(k) && /^(claude|gpt|gemini|grok|qwen|glm|custom)/i.test(x)) ids.add(x);
        else walk(x);
      }
    }
  };
  walk(body);
  return [...ids];
}

export async function labAgentLlm(): Promise<string> {
  const wanted = process.env.LAB_AGENT_LLM || "claude-haiku-5-5";
  if (llmCache && Date.now() - llmCache.at < 6 * 3600_000) return llmCache.value;
  let value = wanted;
  try {
    const picked = pickLabLlm(llmIds(await elevenlabs("/v1/convai/llm/list")), wanted);
    if (picked) value = picked;
  } catch (e) {
    console.error("Laboratorio: no se pudo leer la lista de modelos de ElevenLabs; va", wanted, errorText(e));
  }
  llmCache = { at: Date.now(), value };
  return value;
}

// ---------------------------------------------------------------------------
// Crear y lanzar
// ---------------------------------------------------------------------------
async function labAgentId(): Promise<string> {
  // Las simulaciones son de WhatsApp: las atiende el agente general (el de la clínica principal).
  const main = await getClinic();
  if (!main.elevenlabs_agent_id) throw new Error("Falta preparar a Sofi en ElevenLabs (Sistema → Actualizar a Sofi).");
  return main.elevenlabs_agent_id;
}

export type StartRunInput = {
  clinic: Clinic;
  kind: RunKind;
  label: string;
  cases: LabCase[];
  repeat: number;
  /** Para experimentos: el prompt con el cambio a probar. Sin esto, el prompt efectivo de Sofi. */
  prompt?: string;
  proposalId?: string | null;
  baselineRunId?: string | null;
  createdBy?: string | null;
};

/** Crea la corrida y la lanza en ElevenLabs. Si falla el lanzamiento, la corrida queda en error con el motivo. */
export async function startRun(input: StartRunInput): Promise<string> {
  if (!input.cases.length) throw new Error("No hay casos para correr.");
  const vars = await clinicVariables(input.clinic);
  const prompt = input.prompt ?? (await effectivePrompt()).prompt;
  const cases = input.cases.map((c) => snapshot(c, vars));
  const repeat = Math.min(5, Math.max(1, Math.round(input.repeat)));
  const [run] = await sql<Array<{ id: string }>>`
    insert into lab_runs ${sql({
      clinic_id: input.clinic.id,
      kind: input.kind,
      label: input.label.slice(0, 200),
      prompt_hash: promptHash(prompt),
      prompt_override: input.prompt ?? null,
      proposal_id: input.proposalId ?? null,
      baseline_run_id: input.baselineRunId ?? null,
      case_ids: cases.map((c) => c.id),
      repeat_count: repeat,
      cases: json(cases),
      created_by: input.createdBy ?? null,
    })} returning id`;
  try {
    await launch(run.id, input.clinic, cases, vars, prompt, repeat);
  } catch (e) {
    await sql`update lab_runs set status = 'error', error = ${errorText(e)}, finished_at = now() where id = ${run.id}`;
  }
  return run.id;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

type RemoteTool = { id: string; tool_config?: { name?: string } };

/** Nombre → id de las herramientas del agente. */
async function agentTools(agentId: string): Promise<{ ids: string[]; byName: Record<string, string> }> {
  const agent = await elevenlabs<{ conversation_config?: { agent?: { prompt?: { tool_ids?: string[] } } } }>(`/v1/convai/agents/${agentId}`);
  const ids = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  const byName: Record<string, string> = {};
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const body = await elevenlabs<{ tools?: RemoteTool[]; has_more?: boolean; next_cursor?: string }>(
      `/v1/convai/tools${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    for (const t of body.tools ?? []) if (ids.includes(t.id) && t.tool_config?.name) byName[t.tool_config.name] = t.id;
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return { ids, byName };
}

/** Las respuestas fijas en el formato de ElevenLabs (las herramientas que el agente no tiene se ignoran). */
/**
 * Respuestas que valen para todos los casos si el caso no trae la suya: derivar a recepción siempre
 * funciona. Sin esto, la simulación devuelve error y Sofi termina hablando de fallas del sistema.
 */
const DEFAULT_MOCKS: Record<string, Mock> = {
  crear_tarea: { ok: true, tarea_id: "tarea-simulada", mensaje: "Tarea creada para el equipo." },
  anular_tarea: { ok: true, anuladas: [], mensaje: "No había pedidos de esta charla para anular." },
};

export function mockOverrides(mocks: Record<string, Mock>, byName: Record<string, string>): Record<string, unknown[]> {
  const overrides: Record<string, unknown[]> = {};
  for (const [name, mock] of Object.entries({ ...DEFAULT_MOCKS, ...mocks })) {
    const id = byName[name];
    if (!id) continue;
    const options = Array.isArray(mock) && mock.every((o) => o && typeof o === "object" && "resultado" in o)
      ? (mock as Array<{ si?: { campo: string; valor: string }; resultado: unknown }>)
      : [{ resultado: mock }];
    overrides[id] = options.map((o) => ({
      mock_result: JSON.stringify(o.resultado),
      parameter_conditions: o.si ? [{ path: o.si.campo, eval: { type: "exact", expected_value: o.si.valor } }] : [],
    }));
  }
  return overrides;
}

async function launch(runId: string, clinic: Clinic, cases: CaseSnapshot[], vars: Record<string, string>, prompt: string, repeat: number): Promise<void> {
  const agentId = await labAgentId();
  const [tools, llm] = await Promise.all([agentTools(agentId), labAgentLlm()]);
  const testIds: Record<string, string> = {};
  for (const c of cases) {
    const created = await elevenlabs<{ id: string }>("/v1/convai/agent-testing/create", {
      method: "POST",
      body: JSON.stringify({
        type: "simulation",
        name: `${TEST_PREFIX}${runId.slice(0, 8)} · ${c.id}`.slice(0, 120),
        simulation_scenario: c.scenario,
        success_conditions: c.conditions.map((cond) => cond.text),
        simulation_max_turns: c.maxTurns ?? 14,
        // Todas simuladas: lo que no tiene respuesta preparada devuelve error, nunca llama a la herramienta real.
        tool_mock_config: { mocking_strategy: "selected", fallback_strategy: "raise_error", mocked_tool_ids: tools.ids },
        tool_mock_overrides: mockOverrides(c.mocks, tools.byName),
        dynamic_variables: {
          ...vars,
          patient_phone: FAKE_PHONE,
          patient_name: c.patient.name,
          patient_context: c.patient.context,
          conversation_context: "El paciente inició la conversación.",
          campaign_id: "ninguna",
        },
        chat_history: c.history.map((m, i) => ({ ...m, time_in_call_secs: i * 5 })),
        conversation_initiation_source: "whatsapp",
      }),
    });
    testIds[created.id] = c.id;
  }
  const run = await elevenlabs<{ id: string }>(`/v1/convai/agents/${agentId}/run-tests`, {
    method: "POST",
    body: JSON.stringify({
      name: `Laboratorio de Sofi · ${clinic.name} · ${runId.slice(0, 8)}`,
      tests: Object.keys(testIds).map((test_id) => ({ test_id })),
      repeat_count: repeat,
      // Por WhatsApp escribe primero el paciente: sin el saludo inicial de las llamadas.
      // El laboratorio responde con Haiku: el agente real (y las charlas de pacientes) siguen con su modelo.
      agent_config_override: { conversation_config: { conversation: { text_only: true }, agent: { first_message: "", prompt: { prompt, llm } } } },
    }),
  });
  await sql`
    update lab_runs set status = 'corriendo', agent_id = ${agentId}, agent_llm = ${llm}, invocation_id = ${run.id}, test_ids = ${json(testIds)}, started_at = now()
    where id = ${runId}`;
}

// ---------------------------------------------------------------------------
// Avanzar: traer resultados, puntuar, terminar
// ---------------------------------------------------------------------------
type TestRun = {
  test_id?: string;
  status?: string;
  agent_responses?: unknown;
  condition_result?: { result?: string; rationale?: unknown } | null;
  error?: unknown;
};

export async function getRun(id: string): Promise<LabRun | null> {
  const [row] = await sql<LabRun[]>`select * from lab_runs where id = ${id}`;
  return row ?? null;
}

export async function runResults(runId: string): Promise<LabResult[]> {
  return sql<LabResult[]>`select * from lab_results where run_id = ${runId} order by case_id, repetition`;
}

/** Deja la corrida un paso más adelante. `budgetMs`: cuánto puede tardar el juez en esta vuelta. */
export async function advanceRun(runId: string, budgetMs = 60_000): Promise<LabRun | null> {
  let run = await getRun(runId);
  if (!run) return null;
  if (run.status === "corriendo") {
    await collect(run);
    run = await getRun(runId);
  }
  if (run?.status === "puntuando") {
    await judgePending(run, budgetMs);
    await maybeFinish(run.id);
    run = await getRun(runId);
  }
  return run;
}

async function collect(run: LabRun): Promise<void> {
  if (!run.invocation_id) return;
  let invocation: { test_runs?: TestRun[] };
  try {
    invocation = await elevenlabs<{ test_runs?: TestRun[] }>(`/v1/convai/test-invocations/${run.invocation_id}`);
  } catch (e) {
    console.error("Laboratorio: no se pudieron leer los resultados de ElevenLabs", errorText(e));
    return;
  }
  const testRuns = invocation.test_runs ?? [];
  const pending = testRuns.some((r) => ["pending", "running", "queued"].includes(String(r.status)));
  const tooOld = run.started_at && Date.now() - new Date(run.started_at).getTime() > RUN_TIMEOUT_MS;
  if (pending && !tooOld) return;
  const seen: Record<string, number> = {};
  for (const r of testRuns) {
    const caseId = run.test_ids[r.test_id ?? ""];
    if (!caseId) continue;
    const repetition = (seen[caseId] = (seen[caseId] ?? 0) + 1);
    const status = String(r.status ?? "desconocido");
    const unfinished = ["pending", "running", "queued"].includes(status);
    await sql`
      insert into lab_results ${sql({
        run_id: run.id,
        case_id: caseId,
        repetition,
        el_status: unfinished ? "sin_terminar" : status,
        transcript: json(normalizeTranscript(r.agent_responses)),
        error: unfinished ? "ElevenLabs no terminó esta simulación a tiempo." : null,
      })}
      on conflict (run_id, case_id, repetition) do nothing`;
  }
  const [{ count }] = await sql<Array<{ count: number }>>`select count(*)::int as count from lab_results where run_id = ${run.id}`;
  if (!count) {
    await sql`update lab_runs set status = 'error', error = 'ElevenLabs no devolvió ninguna simulación.', finished_at = now() where id = ${run.id}`;
  } else {
    await sql`update lab_runs set status = 'puntuando' where id = ${run.id} and status = 'corriendo'`;
  }
  // Las simulaciones quedan guardadas acá: las pruebas de ElevenLabs ya no hacen falta.
  for (const testId of Object.keys(run.test_ids)) {
    await elevenlabs(`/v1/convai/agent-testing/${testId}`, { method: "DELETE" }).catch(() => {});
  }
}

async function criteriaFor(clinicId: string): Promise<string[]> {
  const rows = await sql<Array<{ text: string }>>`
    select text from lab_criteria where clinic_id is null or clinic_id = ${clinicId} order by created_at desc limit 40`;
  return rows.map((r) => r.text);
}

async function judgePending(run: LabRun, budgetMs: number): Promise<void> {
  const started = Date.now();
  const clinic = await clinicById(run.clinic_id);
  if (!clinic) return;
  const criteria = await criteriaFor(run.clinic_id);
  let context: string | null = null;
  while (Date.now() - started < budgetMs) {
    const claimed = await sql<LabResult[]>`
      update lab_results set judge_started_at = now()
      where id in (
        select id from lab_results
        where run_id = ${run.id} and not judged and (judge_started_at is null or judge_started_at < now() - interval '10 minutes')
        order by case_id, repetition limit 3 for update skip locked)
      returning *`;
    if (!claimed.length) return;
    context ??= await clinicContextFor(clinic);
    await Promise.all(claimed.map((r) => judgeResult(run, r, context as string, criteria)));
  }
}

async function judgeResult(run: LabRun, result: LabResult, clinicContext: string, criteria: string[]): Promise<void> {
  const c = run.cases.find((x) => x.id === result.case_id);
  const history = normalizeTranscript(c?.history ?? []);
  const lines = [...history, ...result.transcript];
  const checks = automaticChecks(lines);
  const finish = (fields: Record<string, unknown>) => sql`
    update lab_results set ${sql({ ...fields, judged: true, judged_at: new Date() })} where id = ${result.id}`;
  if (!c || !result.transcript.some((l) => l.role === "sofi" && l.text)) {
    await finish({ error: result.error ?? "La simulación no tiene respuestas de Sofi.", checks: json(checks) });
    return;
  }
  if (!labJudgeConfigured()) {
    await finish({ error: "Falta ANTHROPIC_API_KEY: la charla se simuló pero no se pudo puntuar.", checks: json(checks) });
    return;
  }
  try {
    const verdict = await judgeSimulation({
      scenario: c.scenario,
      conditions: c.conditions,
      transcript: transcriptText(lines),
      clinicContext,
      criteria,
    });
    const scored = conversationScore({ verdicts: [...verdict.verdicts, ...checks], judge: verdict.judge, judgeCritical: verdict.judgeCritical });
    const findings = verdict.judgeCritical && verdict.criticalReason
      ? [{ problema: verdict.criticalReason, cita: "", dimension: "seguridad" as const, gravedad: "alta" as const, mejora: "" }, ...verdict.findings]
      : verdict.findings;
    await finish({
      score: scored.score,
      dims: json(scored.dims),
      conditions: json(verdict.verdicts),
      checks: json(checks),
      critical: scored.critical,
      findings: json(findings),
      summary: verdict.summary,
      error: null,
    });
  } catch (e) {
    // Se reintenta en la próxima vuelta (judge_started_at vence a los 10 minutos), salvo que ya falló varias veces.
    console.error("Laboratorio: el juez falló", errorText(e));
    await sql`update lab_results set error = ${errorText(e)} where id = ${result.id}`;
  }
}

async function clinicById(id: string): Promise<Clinic | null> {
  const [row] = await sql<Clinic[]>`select * from clinics where id = ${id}`;
  return row ?? null;
}

/** Qué parte de las charlas reales de los últimos 30 días es de cada motivo. */
export async function intentShare(clinicId: string): Promise<Record<string, number>> {
  const rows = await sql<Array<{ intent: string; n: number }>>`
    select coalesce(c.intent, r.intent) as intent, count(*)::int as n
    from conversations c left join lab_reviews r on r.conversation_id = c.id
    where c.clinic_id = ${clinicId} and not c.is_test and c.started_at > now() - interval '30 days'
      and coalesce(c.intent, r.intent) is not null
    group by 1`;
  const total = rows.reduce((a, r) => a + r.n, 0);
  return total ? Object.fromEntries(rows.map((r) => [r.intent, r.n / total])) : {};
}

const RUN_HOOKS: Array<(run: LabRun) => Promise<void>> = [];
/** Lo que corre cuando termina una corrida (por ejemplo, resolver un experimento). */
export function onRunFinished(hook: (run: LabRun) => Promise<void>): void {
  if (!RUN_HOOKS.includes(hook)) RUN_HOOKS.push(hook);
}

async function maybeFinish(runId: string): Promise<void> {
  // Un resultado cuyo juez falló 3 veces (más de 30 minutos reintentando) se da por perdido.
  await sql`
    update lab_results set judged = true, judged_at = now()
    where run_id = ${runId} and not judged and error is not null and created_at < now() - interval '40 minutes'`;
  const [{ open }] = await sql<Array<{ open: number }>>`select count(*)::int as open from lab_results where run_id = ${runId} and not judged`;
  if (open) return;
  const run = await getRun(runId);
  if (!run || run.status !== "puntuando") return;
  const results = await runResults(runId);
  const weights = caseWeights(run.cases, await intentShare(run.clinic_id));
  const agg = aggregateRun(results.map(toScored), weights);
  const [done] = await sql<LabRun[]>`
    update lab_runs set status = 'terminada', score = ${agg.score}, spread = ${agg.spread}, dims = ${json(agg.dims)},
      critical_count = ${agg.criticalCount}, finished_at = now(),
      error = ${agg.score === null ? "No se pudo puntuar ninguna charla (mirá el detalle)." : null}
    where id = ${runId} and status = 'puntuando' returning *`;
  if (!done) return;
  for (const hook of RUN_HOOKS) {
    await hook(done).catch((e) => console.error("Laboratorio: falló un paso al terminar la corrida", errorText(e)));
  }
}

export const toScored = (r: LabResult): ScoredResult => ({
  case_id: r.case_id,
  repetition: r.repetition,
  score: r.score === null ? null : Number(r.score),
  critical: r.critical,
  dims: r.dims,
});

/** Las corridas sin terminar (para el cron). */
export async function openRuns(): Promise<string[]> {
  const rows = await sql<Array<{ id: string }>>`
    select id from lab_runs where status in ('corriendo', 'puntuando') order by created_at`;
  return rows.map((r) => r.id);
}

/** Prompt de una variante: el efectivo con un cambio más. Error si el cambio no encaja. */
export async function variantPrompt(change: { old_str?: string; new_str?: string }): Promise<string> {
  const base = await effectivePrompt();
  const result = applyPatches(base.prompt, [{ id: "variante", old_str: change.old_str ?? "", new_str: change.new_str ?? "" }]);
  if (result.failed.length) throw new Error(result.failed[0].reason);
  return result.prompt;
}
