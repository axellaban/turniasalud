import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { forbidLabApi } from "./policy";
import { TOOL_DEFINITIONS } from "../agent/tools";
import type { HistoryLine, Mock } from "./cases";
import type { LabLine, LabTool } from "./transcript";

// Simulador propio del Laboratorio de Sofi (v2). APAGADO POR REGLA (policy.ts, 28/11): corría contra la
// API de Claude con clave y eso está prohibido; las corridas van por ElevenLabs. Queda para los tests, con
// el cliente simulado. Cómo era: Sofi y el paciente simulado corrían directo contra la API, sin ElevenLabs. Sofi recibe el mismo prompt efectivo, las mismas variables del consultorio y
// las mismas herramientas que en producción; las herramientas devuelven las respuestas fijas del caso.
// Todo con Haiku (LAB_LLM) y con caché del prompt: el prefijo (herramientas + prompt) es igual en todos
// los turnos y en todos los casos del consultorio.

const MODEL = () => process.env.LAB_SIM_LLM || process.env.LAB_LLM || "claude-haiku-5-5";
const MAX_TURNS = 8;
const MAX_TOOL_STEPS = 6;
const TOOL_RESULT_MAX = 2500;

export type RoleUsage = { input: number; cache_write: number; cache_read: number; output: number };
export type SimulationUsage = { model: string; sofi: RoleUsage; paciente: RoleUsage; usd: number };
export type Simulation = { lines: LabLine[]; usage: SimulationUsage; turns: number; ended: "paciente" | "sofi" | "turnos" };

// USD por millón de tokens: entrada, escritura de caché (1,25×), lectura de caché (0,1×), salida.
const PRICES: Array<[RegExp, number, number]> = [[/haiku/, 0.1, 0.5], [/sonnet/, 2, 10], [/opus/, 4, 20], [/fable/, 8, 40]];

/** Costo de un rol con los precios de lista. Puro. */
export function roleCost(model: string, u: RoleUsage): number {
  const [, inP, outP] = PRICES.find(([re]) => re.test(model)) ?? [/./, 4, 20];
  return (u.input * inP + u.cache_write * inP * 1.25 + u.cache_read * inP * 0.1 + u.output * outP) / 1_000_000;
}

/** El prompt con las {{variables}} completadas, como lo hace ElevenLabs. Puro. */
export function fillPrompt(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => (key in vars ? vars[key] : whole));
}

const getPath = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);

/** La respuesta fija de una herramienta para estos parámetros, o null si el caso no la tiene. Puro. */
export function mockResult(mock: Mock | undefined, input: Record<string, unknown>): unknown | null {
  if (mock === undefined) return null;
  const options = Array.isArray(mock) && mock.every((o) => o && typeof o === "object" && "resultado" in o)
    ? (mock as Array<{ si?: { campo: string; valor: string }; resultado: unknown }>)
    : [{ resultado: mock }];
  const hit = options.find((o) => o.si && String(getPath(input, o.si.campo) ?? "") === o.si.valor) ?? options.find((o) => !o.si);
  return hit ? hit.resultado : null;
}

/** Las herramientas de Sofi en el formato de la API (las mismas definiciones que se suben a ElevenLabs). */
export function sofiTools(): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = TOOL_DEFINITIONS.map((def) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, p] of Object.entries(def.params)) {
      properties[key] = { type: p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) };
      if (p.required) required.push(key);
    }
    return { name: def.name, description: def.description, input_schema: { type: "object" as const, properties, required } };
  });
  tools.push({
    name: "end_call",
    description: "Termina la conversación cuando ya está todo resuelto y el paciente se despidió.",
    input_schema: { type: "object" as const, properties: { reason: { type: "string", description: "Por qué termina." } }, required: [] },
  });
  // El prefijo (herramientas + prompt) se guarda en caché: es igual en todos los turnos y casos.
  tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } };
  return tools;
}

/** El historial del caso como mensajes de la API (para retomar una charla ya empezada). Puro. */
export function historyMessages(history: HistoryLine[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const h of history) {
    if (h.role === "user") {
      if (h.message) out.push({ role: "user", content: h.message });
      continue;
    }
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (h.message) blocks.push({ type: "text", text: h.message });
    for (const c of h.tool_calls ?? []) {
      let input: unknown = {};
      try {
        input = JSON.parse(c.params_as_json);
      } catch {
        input = {};
      }
      blocks.push({ type: "tool_use", id: c.request_id, name: c.tool_name, input });
    }
    if (blocks.length) out.push({ role: "assistant", content: blocks });
    if (h.tool_results?.length) {
      out.push({ role: "user", content: h.tool_results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.request_id, content: r.result_value, is_error: r.is_error })) });
    }
  }
  return out;
}

const emptyUsage = (): RoleUsage => ({ input: 0, cache_write: 0, cache_read: 0, output: 0 });
function addUsage(target: RoleUsage, u: Anthropic.Usage) {
  target.input += u.input_tokens ?? 0;
  target.cache_write += u.cache_creation_input_tokens ?? 0;
  target.cache_read += u.cache_read_input_tokens ?? 0;
  target.output += u.output_tokens ?? 0;
}

const PATIENT_SYSTEM = (scenario: string) =>
  `Sos un paciente simulado que le escribe por WhatsApp a un consultorio odontológico de Argentina. Seguí este escenario al pie de la letra, sin agregar pedidos que no estén:

${scenario}

Reglas:
- Escribí solo tu próximo mensaje, corto y natural, como en WhatsApp. Nada de explicaciones ni comillas.
- Si según el escenario ya terminaste, o la charla quedó cerrada, respondé exactamente: FIN`;

function textOf(content: Anthropic.ContentBlock[]): string {
  return content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}

/**
 * Corre una charla completa: el paciente escribe, Sofi responde (con herramientas simuladas) y así hasta
 * que el paciente termina, Sofi cierra con end_call o se llega a 8 turnos.
 */
export async function simulateConversation(input: {
  prompt: string;
  vars: Record<string, string>;
  scenario: string;
  mocks: Record<string, Mock>;
  history: HistoryLine[];
  maxTurns?: number | null;
  client?: Anthropic;
}): Promise<Simulation> {
  // Prohibido por regla (policy.ts): sin un cliente inyectado (los tests) no se simula contra la API.
  const client = input.client ?? forbidLabApi("simulador del laboratorio");
  const model = MODEL();
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: fillPrompt(input.prompt, input.vars), cache_control: { type: "ephemeral" } }];
  const tools = sofiTools();
  const messages: Anthropic.MessageParam[] = historyMessages(input.history);
  const lines: LabLine[] = [];
  const usage = { sofi: emptyUsage(), paciente: emptyUsage() };
  const historyText = input.history.filter((h) => h.message).map((h) => `${h.role === "user" ? "Paciente" : "Consultorio"}: ${h.message}`);
  const maxTurns = Math.min(input.maxTurns ?? MAX_TURNS, MAX_TURNS);
  let ended: Simulation["ended"] = "turnos";
  let turns = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const talk = [...historyText, ...lines.filter((l) => l.text).map((l) => `${l.role === "paciente" ? "Vos" : "Consultorio"}: ${l.text}`)].join("\n");
    const patient = await client.messages.create({
      model,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: PATIENT_SYSTEM(input.scenario),
      messages: [{ role: "user", content: `${talk ? `Charla hasta ahora:\n${talk}\n\n` : "Todavía no escribiste nada.\n\n"}Tu próximo mensaje:` }],
    });
    addUsage(usage.paciente, patient.usage);
    const said = textOf(patient.content);
    if (!said || /^FIN\.?$/i.test(said)) {
      ended = "paciente";
      break;
    }
    turns++;
    lines.push({ role: "paciente", text: said, tools: [] });
    messages.push({ role: "user", content: said });

    const usedTools: LabTool[] = [];
    const texts: string[] = [];
    let closed = false;
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const res = await client.messages.create({
        model,
        max_tokens: 4000,
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system,
        tools,
        messages,
      });
      addUsage(usage.sofi, res.usage);
      messages.push({ role: "assistant", content: res.content });
      const t = textOf(res.content);
      if (t) texts.push(t);
      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!calls.length || res.stop_reason !== "tool_use") break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const params = (call.input ?? {}) as Record<string, unknown>;
        if (call.name === "end_call") {
          closed = true;
          usedTools.push({ name: "end_call", params: JSON.stringify(params), result: '{"status":"success"}', error: false });
          results.push({ type: "tool_result", tool_use_id: call.id, content: '{"status":"success"}' });
          continue;
        }
        const result = mockResult(input.mocks[call.name], params);
        const text = result === null ? `Error: no mock matched for tool '${call.name}'` : JSON.stringify(result).slice(0, TOOL_RESULT_MAX);
        usedTools.push({ name: call.name, params: JSON.stringify(params).slice(0, 1500), result: text, error: result === null });
        results.push({ type: "tool_result", tool_use_id: call.id, content: text, ...(result === null && { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
      if (closed) break;
    }
    lines.push({ role: "sofi", text: texts.join("\n\n"), tools: usedTools });
    if (closed) {
      ended = "sofi";
      break;
    }
  }
  const usd = roleCost(model, usage.sofi) + roleCost(model, usage.paciente);
  return { lines, usage: { model, ...usage, usd: Math.round(usd * 1e6) / 1e6 }, turns, ended };
}
