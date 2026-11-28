#!/usr/bin/env node
// Batería de pruebas de Sofi con casos reales (las charlas de Guerra–Mininni).
//
// Corre simulaciones de ElevenLabs (agent-testing): un paciente simulado le escribe a Sofi y otro
// modelo juzga la charla contra las condiciones de cada caso. TODAS las herramientas están
// simuladas (respuestas fijas por caso; las demás devuelven error), así que no toca la agenda,
// Smile Connect ni ningún paciente real.
//
// Por defecto prueba el prompt del repositorio (src/lib/agent/prompt.ts) sin cargarlo en el agente:
// sirve para probar un cambio ANTES de «Actualizar a Sofi». Con --prompt actual, prueba el que
// tiene cargado el agente.
//
// Uso:
//   ELEVENLABS_API_KEY=... node scripts/probar-sofi.mjs --agente <agent_id> --clinica "Guerra"
//   Opciones: --casos nuevo-limpieza,viernes   --prompt actual   --repetir 2
//
// Las variables del consultorio (información, catálogo, trato) se toman de la última conversación
// real de esa clínica con ese agente; el paciente y su contexto son ficticios, de cada caso.

import { readFileSync } from "node:fs";
// Node carga el .ts sacándole los tipos (Node 22.18 o más nuevo).
import { referenceCases, resolveCondition } from "../src/lib/lab/cases.ts";

const API = "https://api.elevenlabs.io";
// PAUSA TOTAL del laboratorio (Axel, 28/11/2026, src/lib/lab/policy.ts): esta batería gasta ElevenLabs y no
// corre hasta que Axel la levante por escrito en PENDIENTES.md.
console.error("probar-sofi está en pausa por decisión de Axel: no corre ninguna simulación (cuesta ElevenLabs).");
process.exit(1);

const KEY = process.env.ELEVENLABS_API_KEY;
const PREFIX = "Turnia QA · ";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"]] : pairs), []),
);
if (!KEY) fail("Falta ELEVENLABS_API_KEY.");
if (!args.agente || !args.clinica) fail('Uso: node scripts/probar-sofi.mjs --agente <agent_id> --clinica "Guerra" [--casos a,b] [--prompt actual] [--repetir N]');

function fail(message) {
  console.error(message);
  process.exit(2);
}

async function el(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { "xi-api-key": KEY, "content-type": "application/json", ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// Los casos viven en src/lib/lab/cases.ts: los mismos que corre el Laboratorio de Sofi del panel.
const CASES = referenceCases();
const json = (value) => JSON.stringify(value);

// ---------------------------------------------------------------------------
async function main() {
  const agent = await el(`/v1/convai/agents/${args.agente}`);
  const toolIds = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  const toolsByName = {};
  for (const id of toolIds) {
    const tool = await el(`/v1/convai/tools/${id}`);
    toolsByName[tool.tool_config?.name] = id;
  }
  const vars = await clinicVariables();
  const prompt = args.prompt === "actual" ? null : repoPrompt();
  const wanted = args.casos ? new Set(args.casos.split(",")) : null;
  const cases = CASES.filter((c) => !wanted || wanted.has(c.id)).filter((c) => {
    // Una herramienta nueva llega al agente con «Actualizar a Sofi»: hasta entonces, el caso se saltea.
    const missing = Object.keys(c.mocks).filter((name) => !toolsByName[name]);
    if (missing.length) console.warn(`⚠️  Salteo «${c.id}»: el agente todavía no tiene ${missing.join(", ")} (falta «Actualizar a Sofi»).`);
    return !missing.length;
  });
  if (!cases.length) fail(`No hay casos con esos nombres. Casos: ${CASES.map((c) => c.id).join(", ")}`);

  console.log(`Agente: ${agent.name}\nClínica: ${vars.clinic_name}\nPrompt: ${prompt ? "el del repositorio (sin cargarlo en el agente)" : "el que tiene cargado el agente"}\nCasos: ${cases.length}\n`);

  // Editar una simulación es borrarla y crearla de nuevo.
  const existing = await el(`/v1/convai/agent-testing?page_size=100&search=${encodeURIComponent(PREFIX)}`).catch(() => ({ tests: [] }));
  for (const t of existing.tests ?? []) {
    // Una prueba archivada ya no se puede borrar (404): se deja y se crea otra.
    if (t.name?.startsWith(PREFIX) && cases.some((c) => t.name === PREFIX + c.id)) await el(`/v1/convai/agent-testing/${t.id}`, { method: "DELETE" }).catch(() => {});
  }
  const tests = [];
  for (const c of cases) {
    const overrides = {};
    // Cada herramienta: una respuesta fija, o una lista { si: { campo, valor }, resultado } (gana la primera que coincide).
    for (const [name, mock] of Object.entries(c.mocks)) {
      if (!toolsByName[name]) fail(`El agente no tiene la herramienta ${name}.`);
      const options = Array.isArray(mock) ? mock : [{ resultado: mock }];
      overrides[toolsByName[name]] = options.map((o) => ({
        mock_result: json(o.resultado),
        parameter_conditions: o.si ? [{ path: o.si.campo, eval: { type: "exact", expected_value: o.si.valor } }] : [],
      }));
    }
    const body = {
      type: "simulation",
      name: PREFIX + c.id,
      simulation_scenario: c.scenario,
      success_conditions: c.conditions.map((cond) => resolveCondition(cond, vars).text),
      simulation_max_turns: c.maxTurns ?? 14,
      // Todas simuladas: lo que no tiene respuesta preparada devuelve error, nunca llama a la herramienta real.
      tool_mock_config: { mocking_strategy: "selected", fallback_strategy: "raise_error", mocked_tool_ids: toolIds },
      tool_mock_overrides: overrides,
      dynamic_variables: {
        ...vars,
        patient_phone: "5491100000000",
        patient_name: c.patient.name,
        patient_context: c.patient.context,
        conversation_context: "El paciente inició la conversación.",
        campaign_id: "ninguna",
      },
      chat_history: (c.history ?? []).map((m, i) => ({ ...m, time_in_call_secs: i * 5 })),
      conversation_initiation_source: "whatsapp",
    };
    const created = await el("/v1/convai/agent-testing/create", { method: "POST", body: json(body) });
    tests.push({ id: created.id, case: c });
  }

  const run = await el(`/v1/convai/agents/${args.agente}/run-tests`, {
    method: "POST",
    body: json({
      name: `Batería de Sofi · ${new Date().toISOString().slice(0, 16)}`,
      tests: tests.map((t) => ({ test_id: t.id })),
      repeat_count: Number(args.repetir ?? 1),
      // Por WhatsApp escribe primero el paciente: sin el saludo inicial de las llamadas.
      agent_config_override: { conversation_config: {
        conversation: { text_only: true },
        agent: { first_message: "", ...(prompt && { prompt: { prompt } }) },
      } },
    }),
  });
  const invocationId = run.id;
  console.log(`Corriendo (${invocationId})…`);
  let result;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    result = await el(`/v1/convai/test-invocations/${invocationId}`);
    if ((result.test_runs ?? []).every((r) => !["pending", "running"].includes(r.status))) break;
  }
  report(result, tests);
}

/** El prompt del repositorio, tal cual lo carga «Actualizar a Sofi». */
function repoPrompt() {
  const source = readFileSync(new URL("../src/lib/agent/prompt.ts", import.meta.url), "utf8");
  const start = source.indexOf("export const SYSTEM_PROMPT = `");
  const end = source.indexOf("`;", start);
  if (start < 0 || end < 0) fail("No encontré SYSTEM_PROMPT en src/lib/agent/prompt.ts.");
  return source.slice(start + "export const SYSTEM_PROMPT = `".length, end);
}

/** Información, catálogo y trato de la clínica, de su última conversación real con este agente. */
async function clinicVariables() {
  const list = await el(`/v1/convai/conversations?agent_id=${args.agente}&page_size=30`);
  for (const c of list.conversations ?? []) {
    const detail = await el(`/v1/convai/conversations/${c.conversation_id}`);
    const v = detail.conversation_initiation_client_data?.dynamic_variables ?? {};
    if (!String(v.clinic_name ?? "").toLowerCase().includes(args.clinica.toLowerCase()) || !v.clinic_info) continue;
    const keep = ["clinic_id", "clinic_name", "agent_name", "clinic_info", "clinic_catalog", "urgency_instructions", "trato"];
    const vars = Object.fromEntries(keep.filter((k) => v[k] != null).map((k) => [k, String(v[k])]));
    // Conversaciones de antes del trato en el prompt: se deduce igual que clinicTone (src/lib/clinic.ts).
    vars.trato ??= /Trato: de usted|\b(tratar|trato|trate)\b[^.\n]{0,30}\bde usted\b/i.test(vars.clinic_info)
      ? 'Tratás de usted a todos, pacientes y equipo ("usted", "tiene", "quiere", "le"), en cada mensaje desde la primera palabra, aunque te tuteen. Si alguna vez se te escapa el otro trato, seguí con el correcto sin pedir perdón ni repetir el mensaje.'
      : 'Tratás de vos, con voseo ("vos", "tenés", "querés", "te"). Si alguna vez se te escapa el otro trato, seguí con el correcto sin pedir perdón ni repetir el mensaje.';
    return vars;
  }
  fail(`No encontré una conversación reciente de «${args.clinica}» con este agente.`);
}

function report(result, tests) {
  const byTest = new Map(tests.map((t) => [t.id, t.case]));
  let passed = 0;
  let total = 0;
  for (const r of result?.test_runs ?? []) {
    total++;
    const c = byTest.get(r.test_id);
    const ok = r.status === "passed";
    if (ok) passed++;
    console.log(`\n${ok ? "✅" : r.status === "failed" ? "❌" : "⚠️ "} ${c?.titulo ?? r.test_name} (${r.status})`);
    const why = r.condition_result?.rationale ?? r.condition_result;
    if (why && !ok) console.log(`   Por qué: ${typeof why === "string" ? why : JSON.stringify(why).slice(0, 1500)}`);
    for (const m of r.agent_responses ?? []) {
      const text = (m.message ?? "").trim();
      if (text) console.log(`   ${m.role === "user" ? "Paciente" : "Sofi"}: ${text.replace(/\n+/g, " / ")}`);
    }
  }
  console.log(`\nResultado: ${passed}/${total} casos pasaron.`);
  process.exit(passed === total && total > 0 ? 0 : 1);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
