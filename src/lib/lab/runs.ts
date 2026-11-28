import "server-only";
import { json, sql } from "../db";
import { buildDynamicVariables, getClinic } from "../clinic";
import { elevenlabs } from "../elevenlabs";
import type { Clinic } from "../types";
import { referenceCases, resolveCondition, type Condition, type HistoryLine, type Intent, type LabCase, type Mock, type Situation } from "./cases";
import { APPEAL_MODEL, judgeSimulation, labJudgeConfigured, secondInstanceOn, type LabFinding } from "./judge";
import { applyPatches, effectivePrompt, promptHash } from "./prompt";
import { LAB_ELEVENLABS_MESSAGE, LAB_PAUSED_MESSAGE, labElevenLabsAllowed, labPaused, labSimModel, labSimulatorAllowed } from "./policy";
import { aggregateRun, automaticChecks, caseWeights, conversationScore, needsMoreReps, type Dims, type ScoredResult, type Verdict } from "./score";
import { normalizeTranscript, transcriptText, type LabLine } from "./transcript";
import { simulateConversation, type SimulationUsage } from "./simulator";

// Corridas del Laboratorio de Sofi: arma las simulaciones en ElevenLabs (agent-testing, todas las
// herramientas simuladas), espera los resultados, los puntúa con el juez y calcula el puntaje.
//
//   preparando → corriendo (simula el simulador con Haiku) → la suscripción evalúa cada charla → terminada
//
// REGLA (policy.ts): el juez no corre en el servidor. En «puntuando» las charlas esperan a que Claude Code o
// ChatGPT, con la suscripción, las evalúe por /api/lab/evaluaciones (saveJudgment + maybeFinish).
//
// Lo avanza el cron «calendario» cada 10 minutos (src/lib/lab/tick.ts) y el panel al abrir una corrida.

export type RunKind = "bateria" | "experimento" | "jugar" | "verificacion";
/** simulador: API de Claude directa (v2, por defecto). elevenlabs: pruebas de agentes de ElevenLabs (verificación). */
export type RunEngine = "simulador" | "elevenlabs";
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
  engine: RunEngine;
  sim_vars: Record<string, string> | null;
  sim_prompt: string | null;
  invocation_id: string | null;
  test_ids: Record<string, string>;
  cases: CaseSnapshot[];
  score: number | null;
  spread: number | null;
  dims: Dims | null;
  critical_count: number;
  /** Consumo: { elevenlabs: { creditos, llm_usd, … }, juez: { usd, tokens_entrada, tokens_salida, llamadas } }. */
  usage: { simulador?: { modelo?: string; usd: number; charlas: number; tokens_entrada?: number; tokens_cache_escritura?: number; tokens_cache_lectura?: number; tokens_salida?: number }; elevenlabs?: { v?: number; simulaciones: number; con_datos: number; creditos: number; llm_usd: number; plataforma_usd?: number; usd?: number }; juez?: { usd: number; tokens_entrada: number; tokens_salida: number; llamadas: number } } | null;
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
  judge_model?: string | null;
  first_opinion?: string | null;
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
  // El catálogo (prestaciones y precios) va antes que la información larga del consultorio: si el texto
  // se recortaba, el juez no veía los precios y marcaba como «inventado» un precio que sí está cargado.
  const text = [
    `Nombre: ${clinic.name}. Asistente: ${clinic.agent_name}.`,
    `Trato: ${v.trato ?? ""}`,
    v.clinic_catalog ? `Catálogo (prestaciones y precios que Sofi puede decir):\n${v.clinic_catalog}` : "",
    v.urgency_instructions ? `Urgencias: ${v.urgency_instructions}` : "",
    v.clinic_info ?? "",
  ].filter(Boolean).join("\n\n");
  return text.length > 24_000 ? `${text.slice(0, 24_000)}\n[recortado]` : text;
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
  /** Con la regla de policy.ts siempre ElevenLabs (el simulador propio usa la API y está prohibido). */
  engine?: RunEngine;
  /** Solo con ElevenLabs: usar el modelo del agente (producción) en vez de Haiku. */
  productionModel?: boolean;
};

/** Crea la corrida y la lanza en ElevenLabs. Si falla el lanzamiento, la corrida queda en error con el motivo. */
export async function startRun(input: StartRunInput): Promise<string> {
  // Pausa total (policy.ts): ninguna simulación nueva, ni en ElevenLabs ni en la API.
  if (labPaused()) throw new Error(LAB_PAUSED_MESSAGE);
  if (!input.cases.length) throw new Error("No hay casos para correr.");
  const vars = await clinicVariables(input.clinic);
  const prompt = input.prompt ?? (await effectivePrompt()).prompt;
  const cases = input.cases.map((c) => snapshot(c, vars));
  const repeat = Math.min(5, Math.max(1, Math.round(input.repeat)));
  // Regla de costos (policy.ts): todo va por el simulador (Haiku, con topes); ElevenLabs nunca.
  if (input.engine === "elevenlabs" && !labElevenLabsAllowed()) throw new Error(LAB_ELEVENLABS_MESSAGE);
  if (input.engine !== "elevenlabs" && !labSimulatorAllowed()) throw new Error(LAB_PAUSED_MESSAGE);
  const engine: RunEngine = input.engine === "elevenlabs" ? "elevenlabs" : "simulador";
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
      engine,
      ...(engine === "simulador" && { sim_vars: json(vars), sim_prompt: prompt, agent_llm: simulatorModel(), status: "corriendo", started_at: new Date() }),
    })} returning id`;
  if (engine === "simulador") {
    // Una charla por caso (o las repeticiones pedidas en «Jugar de paciente»); las que fallan se repiten solas.
    for (const c of cases) {
      for (let rep = 1; rep <= repeat; rep++) {
        await sql`insert into lab_results (run_id, case_id, repetition, el_status) values (${run.id}, ${c.id}, ${rep}, 'pendiente') on conflict do nothing`;
      }
    }
    return run.id;
  }
  try {
    await launch(run.id, input.clinic, cases, vars, prompt, repeat, Boolean(input.productionModel));
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

async function launch(runId: string, clinic: Clinic, cases: CaseSnapshot[], vars: Record<string, string>, prompt: string, repeat: number, productionModel = false): Promise<void> {
  const agentId = await labAgentId();
  const [tools, labLlm] = await Promise.all([agentTools(agentId), productionModel ? Promise.resolve(null) : labAgentLlm()]);
  const llm = labLlm;
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
      agent_config_override: { conversation_config: { conversation: { text_only: true }, agent: { first_message: "", prompt: { prompt, ...(llm && { llm }) } } } },
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
  if (run.engine === "simulador") {
    if (run.status !== "corriendo") return run;
    const started = Date.now();
    await simulatePending(run, Math.round(budgetMs * 0.6));
    await judgePending(run, Math.max(10_000, budgetMs - (Date.now() - started)));
    if (run.kind === "experimento") await balanceExperiment(run);
    await maybeFinish(run.id);
    return getRun(runId);
  }
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
  // Las pruebas quedan en ElevenLabs (Agents → Tests, «Turnia Lab · …») para poder ver su consumo allá.
  await recordElevenLabsUsage(run.id, testRuns);
}

/** Números de consumo que traiga una respuesta de ElevenLabs (créditos, costo, tokens), tenga la forma que tenga. Puro. */
export function usageNumbers(body: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof x === "number" && /cost|credit|price|charg|token|usage/i.test(p)) out[p] = x;
      else if (typeof x === "object") walk(x, p);
    }
  };
  walk(body, "");
  return out;
}

/**
 * Consumo de ElevenLabs de la corrida: lo que venga en cada simulación y, si trae conversation_id, el
 * detalle de esa conversación (metadata.cost son créditos; metadata.charging, el LLM). Se guarda crudo en
 * lab_runs.usage para no depender de una forma exacta, y el panel suma créditos y USD de LLM.
 */
async function recordElevenLabsUsage(runId: string, testRuns: TestRun[]): Promise<void> {
  const total = sumElevenLabsUsage(testRuns.map((r) => usageNumbers(r)));
  await sql`update lab_runs set usage = coalesce(usage, '{}'::jsonb) || ${json({ elevenlabs: total })} where id = ${runId}`;
}

/**
 * Suma el consumo que informa ElevenLabs en cada simulación: créditos («credits_used») y dólares
 * («charging.llm_price» del modelo y «charging.platform_price» de la plataforma). Los «…_charge» son
 * créditos, no dólares: no se suman como USD. Puro.
 */
export function sumElevenLabsUsage(perSimulation: Array<Record<string, number>>) {
  let credits = 0;
  let llmUsd = 0;
  let platformUsd = 0;
  let withData = 0;
  for (const n of perSimulation) {
    const c = n["credits_used"] ?? n["metadata.cost"];
    if (c === undefined && n["charging.llm_price"] === undefined) continue;
    withData++;
    credits += c ?? 0;
    llmUsd += n["charging.llm_price"] ?? 0;
    platformUsd += n["charging.platform_price"] ?? 0;
  }
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return { v: 2, simulaciones: perSimulation.length, con_datos: withData, creditos: credits, llm_usd: r4(llmUsd), plataforma_usd: r4(platformUsd), usd: r4(llmUsd + platformUsd) };
}

/** Vuelve a calcular el consumo de corridas que se guardó con la fórmula vieja (las pruebas siguen en ElevenLabs). */
export async function fixOldUsage(): Promise<number> {
  const runs = await sql<Array<{ id: string; invocation_id: string }>>`
    select id, invocation_id from lab_runs
    where invocation_id is not null and usage ? 'elevenlabs' and coalesce((usage->'elevenlabs'->>'v')::int, 1) < 2
    limit 3`;
  for (const r of runs) {
    const invocation = await elevenlabs<{ test_runs?: TestRun[] }>(`/v1/convai/test-invocations/${r.invocation_id}`).catch(() => null);
    if (invocation) await recordElevenLabsUsage(r.id, invocation.test_runs ?? []);
  }
  return runs.length;
}

/** Suma lo que costó el juez de la corrida. */
export async function addJudgeUsage(runId: string, usd: number, input: number, output: number, secondInstance = false): Promise<void> {
  const extra = secondInstance ? 1 : 0;
  await sql`
    update lab_runs set usage = jsonb_set(coalesce(usage, '{}'::jsonb), '{juez}', jsonb_build_object(
      'usd', coalesce((usage->'juez'->>'usd')::numeric, 0) + ${usd},
      'tokens_entrada', coalesce((usage->'juez'->>'tokens_entrada')::bigint, 0) + ${input},
      'tokens_salida', coalesce((usage->'juez'->>'tokens_salida')::bigint, 0) + ${output},
      'llamadas', coalesce((usage->'juez'->>'llamadas')::int, 0) + 1,
      'segunda_instancia_llamadas', coalesce((usage->'juez'->>'segunda_instancia_llamadas')::int, 0) + ${extra},
      'segunda_instancia_usd', coalesce((usage->'juez'->>'segunda_instancia_usd')::numeric, 0) + ${secondInstance ? usd : 0}))
    where id = ${runId}`;
}

async function criteriaFor(clinicId: string): Promise<string[]> {
  const rows = await sql<Array<{ text: string }>>`
    select text from lab_criteria where clinic_id is null or clinic_id = ${clinicId} order by created_at desc limit 40`;
  return rows.map((r) => r.text);
}

async function judgePending(run: LabRun, budgetMs: number): Promise<void> {
  if (!labJudgeConfigured()) {
    await closeEmptyResults(run.id);
    return;
  }
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
        where run_id = ${run.id} and not judged and coalesce(el_status, '') not in ('pendiente', 'simulando')
          and (judge_started_at is null or judge_started_at < now() - interval '10 minutes')
        order by case_id, repetition limit 6 for update skip locked)
      returning *`;
    if (!claimed.length) return;
    context ??= await clinicContextFor(clinic);
    await Promise.all(claimed.map((r) => judgeResult(run, r, context as string, criteria)));
  }
}

const hasSofi = (r: LabResult) => (r.transcript ?? []).some((l) => l.role === "sofi" && l.text);

/**
 * Sin juez en el servidor (regla de policy.ts): las charlas quedan esperando a la suscripción. Solo se cierran
 * las que no tienen nada que evaluar, para que la corrida no quede abierta por ellas.
 */
async function closeEmptyResults(runId: string): Promise<void> {
  const rows = await sql<LabResult[]>`
    select * from lab_results where run_id = ${runId} and not judged and coalesce(el_status, '') not in ('pendiente', 'simulando')`;
  for (const r of rows.filter((x) => !hasSofi(x))) {
    await sql`
      update lab_results set judged = true, judged_at = now(), error = ${r.error ?? "La simulación no tiene respuestas de Sofi."}
      where id = ${r.id} and not judged`;
  }
}

/** Lo que dijo el juez (en el formato del laboratorio). */
export type JudgmentInput = {
  verdicts: Verdict[];
  judge: Dims;
  judgeCritical: boolean;
  criticalReason: string | null;
  findings: LabFinding[];
  summary: string;
};

/** Calcula el puntaje de una charla simulada con lo que dijo el juez y lo guarda. Devuelve el puntaje. */
export async function saveJudgment(run: LabRun, result: LabResult, verdict: JudgmentInput, judgeModel: string | null, firstOpinion: string | null = null) {
  const c = run.cases.find((x) => x.id === result.case_id);
  const lines = [...normalizeTranscript(c?.history ?? []), ...result.transcript];
  const checks = automaticChecks(lines);
  const scored = conversationScore({ verdicts: [...verdict.verdicts, ...checks], judge: verdict.judge, judgeCritical: verdict.judgeCritical });
  const findings = verdict.judgeCritical && verdict.criticalReason
    ? [{ problema: verdict.criticalReason, cita: "", dimension: "seguridad" as const, gravedad: "alta" as const, mejora: "" }, ...verdict.findings]
    : verdict.findings;
  await sql`
    update lab_results set ${sql({
      score: scored.score,
      dims: json(scored.dims),
      conditions: json(verdict.verdicts),
      checks: json(checks),
      critical: scored.critical,
      findings: json(findings),
      summary: verdict.summary,
      judge_model: judgeModel,
      first_opinion: firstOpinion,
      error: null,
      judged: true,
      judged_at: new Date(),
    })} where id = ${result.id}`;
  return { ...scored, checks };
}

async function judgeResult(run: LabRun, result: LabResult, clinicContext: string, criteria: string[]): Promise<void> {
  const c = run.cases.find((x) => x.id === result.case_id);
  const history = normalizeTranscript(c?.history ?? []);
  const lines = [...history, ...result.transcript];
  const checks = automaticChecks(lines);
  const finish = (fields: Record<string, unknown>) => sql`
    update lab_results set ${sql({ ...fields, judged: true, judged_at: new Date() })} where id = ${result.id}`;
  if (!c || !hasSofi(result)) {
    await finish({ error: result.error ?? "La simulación no tiene respuestas de Sofi.", checks: json(checks) });
    return;
  }
  try {
    const input = { scenario: c.scenario, conditions: c.conditions, transcript: transcriptText(lines), clinicContext, criteria };
    let verdict = await judgeSimulation(input);
    if (verdict.usage) await addJudgeUsage(run.id, verdict.usage.usd, verdict.usage.input_tokens, verdict.usage.output_tokens);
    let scored = conversationScore({ verdicts: [...verdict.verdicts, ...checks], judge: verdict.judge, judgeCritical: verdict.judgeCritical });
    // Segunda instancia: si el juez (no un control automático) dio falla crítica, Opus la revisa de cero.
    // Una crítica deja la charla en 0 y la corrida en 69: es la decisión que más pesa, y la que el juez
    // barato más erró (precios que sí estaban cargados, fichas mal armadas).
    let firstOpinion: string | null = null;
    let judgeModel = verdict.usage?.model ?? null;
    const judgeSaysCritical = verdict.judgeCritical || verdict.verdicts.some((v) => v.critical && !v.pass);
    if (scored.critical && judgeSaysCritical && secondInstanceOn()) {
      firstOpinion = (verdict.criticalReason ?? verdict.verdicts.find((v) => v.critical && !v.pass)?.reason ?? verdict.summary).slice(0, 600);
      try {
        const second = await judgeSimulation({ ...input, model: APPEAL_MODEL(), firstOpinion });
        if (second.usage) await addJudgeUsage(run.id, second.usage.usd, second.usage.input_tokens, second.usage.output_tokens, true);
        verdict = second;
        judgeModel = second.usage?.model ?? APPEAL_MODEL();
        scored = conversationScore({ verdicts: [...verdict.verdicts, ...checks], judge: verdict.judge, judgeCritical: verdict.judgeCritical });
      } catch (e) {
        // Si la segunda instancia falla, queda lo que dijo el primer juez.
        console.error("Laboratorio: falló la segunda instancia", errorText(e));
        firstOpinion = null;
      }
    }
    scored = await saveJudgment(run, result, verdict, judgeModel, firstOpinion);
    // Repetición a demanda: si la primera charla falla, el caso corre 2 veces más para descartar casualidad.
    if (run.engine === "simulador" && run.kind !== "jugar" && result.repetition === 1 && failed(scored.score, scored.critical, [...verdict.verdicts, ...checks])) {
      for (const rep of [2, 3]) {
        await sql`insert into lab_results (run_id, case_id, repetition, el_status) values (${run.id}, ${result.case_id}, ${rep}, 'pendiente') on conflict do nothing`;
      }
    }
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

export async function maybeFinish(runId: string): Promise<void> {
  // Un resultado cuyo juez falló 3 veces (más de 30 minutos reintentando) se da por perdido.
  await sql`
    update lab_results set judged = true, judged_at = now()
    where run_id = ${runId} and not judged and error is not null and created_at < now() - interval '40 minutes'`;
  const [{ open }] = await sql<Array<{ open: number }>>`select count(*)::int as open from lab_results where run_id = ${runId} and not judged`;
  if (open) return;
  const run = await getRun(runId);
  if (!run || run.status !== (run.engine === "simulador" ? "corriendo" : "puntuando")) return;
  const results = await runResults(runId);
  const weights = caseWeights(run.cases, await intentShare(run.clinic_id));
  const agg = aggregateRun(results.map(toScored), weights);
  const [done] = await sql<LabRun[]>`
    update lab_runs set status = 'terminada', score = ${agg.score}, spread = ${agg.spread}, dims = ${json(agg.dims)},
      critical_count = ${agg.criticalCount}, finished_at = now(),
      error = ${agg.score === null ? "No se pudo puntuar ninguna charla (mirá el detalle)." : null}
    where id = ${runId} and status = ${run.status} returning *`;
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

/**
 * Un experimento son dos corridas con los mismos casos (la versión actual y la variante). Si un caso dio muy
 * distinto entre las dos con una sola charla de cada lado, se repite en las dos (hasta 3 charlas por lado)
 * antes de contarlo. Si la otra corrida ya había terminado, se reabre.
 */
async function balanceExperiment(run: LabRun): Promise<void> {
  const [sibling] = run.baseline_run_id
    ? await sql<LabRun[]>`select * from lab_runs where id = ${run.baseline_run_id}`
    : await sql<LabRun[]>`select * from lab_runs where baseline_run_id = ${run.id} limit 1`;
  if (!sibling || sibling.engine !== "simulador") return;
  const [mine, theirs] = await Promise.all([runResults(run.id), runResults(sibling.id)]);
  const base = (run.baseline_run_id ? theirs : mine).map(toScored);
  const variant = (run.baseline_run_id ? mine : theirs).map(toScored);
  const reopen = new Set<string>();
  for (const id of new Set(base.map((r) => r.case_id))) {
    if (!needsMoreReps(base, variant, id)) continue;
    for (const runId of [run.id, sibling.id]) {
      for (const rep of [2, 3]) {
        const added = await sql`
          insert into lab_results (run_id, case_id, repetition, el_status) values (${runId}, ${id}, ${rep}, 'pendiente')
          on conflict do nothing returning id`;
        if (added.length) reopen.add(runId);
      }
    }
  }
  for (const runId of reopen) {
    await sql`update lab_runs set status = 'corriendo', finished_at = null where id = ${runId} and status = 'terminada'`;
  }
}

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

// ---------------------------------------------------------------------------
// Simulador propio (v2)
// ---------------------------------------------------------------------------
export const simulatorModel = () => labSimModel();

/** Una charla falla si baja de 85, tiene una falla crítica o no cumple alguna condición. Puro. */
export function failed(score: number | null, critical: boolean, verdicts: Array<{ pass: boolean }>): boolean {
  return critical || score === null || score < 85 || verdicts.some((v) => !v.pass);
}

/** Lo que lleva gastado la corrida (simulador + juez + ElevenLabs), en USD. Puro. */
export function runCost(usage: LabRun["usage"]): number {
  const u = (usage ?? {}) as { simulador?: { usd?: number }; juez?: { usd?: number }; elevenlabs?: { usd?: number; v?: number } };
  return Number(u.simulador?.usd ?? 0) + Number(u.juez?.usd ?? 0) + (u.elevenlabs?.v === 2 ? Number(u.elevenlabs.usd ?? 0) : 0);
}

async function addSimUsage(runId: string, u: SimulationUsage): Promise<void> {
  const tokens = (k: "input" | "cache_write" | "cache_read" | "output") => u.sofi[k] + u.paciente[k];
  await sql`
    update lab_runs set usage = jsonb_set(coalesce(usage, '{}'::jsonb), '{simulador}', jsonb_build_object(
      'modelo', ${u.model}::text,
      'usd', coalesce((usage->'simulador'->>'usd')::numeric, 0) + ${u.usd},
      'charlas', coalesce((usage->'simulador'->>'charlas')::int, 0) + 1,
      'tokens_entrada', coalesce((usage->'simulador'->>'tokens_entrada')::bigint, 0) + ${tokens("input")},
      'tokens_cache_escritura', coalesce((usage->'simulador'->>'tokens_cache_escritura')::bigint, 0) + ${tokens("cache_write")},
      'tokens_cache_lectura', coalesce((usage->'simulador'->>'tokens_cache_lectura')::bigint, 0) + ${tokens("cache_read")},
      'tokens_salida', coalesce((usage->'simulador'->>'tokens_salida')::bigint, 0) + ${tokens("output")}))
    where id = ${runId}`;
}

/** Tope de gasto por corrida (USD), de la configuración del laboratorio de la clínica. */
async function runCap(clinicId: string): Promise<number> {
  const [row] = await sql<Array<{ cap: string | null }>>`select lab_settings->>'tope_corrida_usd' as cap from clinics where id = ${clinicId}`;
  const n = Number(row?.cap);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function simulatePending(run: LabRun, budgetMs: number): Promise<void> {
  if (!labSimulatorAllowed() || !process.env.ANTHROPIC_API_KEY) {
    await sql`
      update lab_results set el_status = 'omitida', judged = true, judged_at = now(), error = 'El simulador no está disponible (pausa o falta ANTHROPIC_API_KEY).'
      where run_id = ${run.id} and el_status in ('pendiente', 'simulando')`;
    return;
  }
  const started = Date.now();
  const cap = await runCap(run.clinic_id);
  const clinic = await clinicById(run.clinic_id);
  const { spentToday, dailyCap } = await import("./tick");
  const prompt = run.sim_prompt ?? run.prompt_override ?? (await effectivePrompt()).prompt;
  const vars = run.sim_vars ?? {};
  while (Date.now() - started < budgetMs) {
    const fresh = await getRun(run.id);
    if (runCost(fresh?.usage ?? null) >= cap) {
      await sql`
        update lab_results set el_status = 'omitida', judged = true, judged_at = now(),
          error = ${`Se alcanzó el tope de gasto de la corrida (USD ${cap}).`}
        where run_id = ${run.id} and el_status = 'pendiente'`;
      return;
    }
    // Tope del día (policy.ts): corta también a mitad de corrida.
    if (clinic && (await spentToday(clinic)) >= dailyCap(clinic)) {
      await sql`
        update lab_results set el_status = 'omitida', judged = true, judged_at = now(),
          error = ${`Se alcanzó el tope de gasto del día (USD ${dailyCap(clinic)}).`}
        where run_id = ${run.id} and el_status = 'pendiente'`;
      return;
    }
    const claimed = await sql<LabResult[]>`
      update lab_results set el_status = 'simulando', judge_started_at = now()
      where id in (
        select id from lab_results
        where run_id = ${run.id} and (el_status = 'pendiente' or (el_status = 'simulando' and judge_started_at < now() - interval '10 minutes'))
        order by repetition, case_id limit 6 for update skip locked)
      returning *`;
    if (!claimed.length) return;
    await Promise.all(claimed.map(async (r) => {
      const c = run.cases.find((x) => x.id === r.case_id);
      if (!c) {
        await sql`update lab_results set el_status = 'omitida', judged = true, judged_at = now(), error = 'El caso ya no existe.' where id = ${r.id}`;
        return;
      }
      try {
        const sim = await simulateConversation({
          prompt,
          vars: { ...vars, patient_name: c.patient.name, patient_context: c.patient.context, patient_phone: "5491100000000", conversation_context: "El paciente inició la conversación.", campaign_id: "ninguna" },
          scenario: c.scenario,
          mocks: { ...DEFAULT_MOCKS, ...c.mocks },
          history: c.history,
          maxTurns: c.maxTurns,
        });
        await sql`
          update lab_results set el_status = 'simulada', transcript = ${json(sim.lines)}, judge_started_at = null, error = null
          where id = ${r.id}`;
        await addSimUsage(run.id, sim.usage);
      } catch (e) {
        console.error("Laboratorio: falló la simulación", errorText(e));
        // Se reintenta en la próxima vuelta; si ya lleva más de 40 minutos, se da por perdida.
        await sql`
          update lab_results set el_status = case when created_at < now() - interval '40 minutes' then 'omitida' else 'pendiente' end,
            judged = created_at < now() - interval '40 minutes', error = ${errorText(e)}
          where id = ${r.id}`;
      }
    }));
  }
}
