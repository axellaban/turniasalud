import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { fillPrompt, historyMessages, mockResult, roleCost, simulateConversation, sofiTools } from "./simulator";
import { aggregateRun, unstableCases } from "./score";
import { failed, runCost } from "./runs";
import { focusedCases } from "./proposals";
import { referenceCases } from "./cases";

describe("simulador propio", () => {
  it("completa las variables del prompt como ElevenLabs y deja las desconocidas", () => {
    expect(fillPrompt("Hola {{clinic_name}}, {{agent_name}} y {{otra}}", { clinic_name: "Plaza", agent_name: "Sofi" })).toBe("Hola Plaza, Sofi y {{otra}}");
  });

  it("elige la respuesta fija por parámetro y si no, la general", () => {
    const mock = [{ si: { campo: "inicio", valor: "A" }, resultado: { ok: false } }, { resultado: { ok: true } }];
    expect(mockResult(mock, { inicio: "A" })).toEqual({ ok: false });
    expect(mockResult(mock, { inicio: "B" })).toEqual({ ok: true });
    expect(mockResult({ ok: 1 }, {})).toEqual({ ok: 1 });
    expect(mockResult(undefined, {})).toBeNull();
  });

  it("pasa el historial del caso a mensajes con herramientas", () => {
    const msgs = historyMessages(referenceCases().find((c) => c.id === "despedida")?.history ?? []);
    const toolUse = msgs.find((m) => Array.isArray(m.content) && (m.content as Anthropic.ContentBlockParam[]).some((b) => b.type === "tool_use"));
    expect(toolUse?.role).toBe("assistant");
    expect(msgs.at(-1)?.role).toBe("assistant");
  });

  it("las herramientas son las de producción, más end_call, con caché en la última", () => {
    const tools = sofiTools();
    expect(tools.some((t) => t.name === "consultar_disponibilidad")).toBe(true);
    expect(tools.at(-1)?.name).toBe("end_call");
    expect(tools.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("calcula el costo con caché (lectura al 10 %)", () => {
    expect(roleCost("claude-haiku-5-5", { input: 1_000_000, cache_write: 0, cache_read: 10_000_000, output: 0 })).toBeCloseTo(0.2, 6);
  });

  it("corre una charla: el paciente escribe, Sofi usa la herramienta simulada y el paciente termina", async () => {
    const replies: Array<Partial<Anthropic.Message>> = [
      { content: [{ type: "text", text: "Hola, quiero un turno", citations: null }] as Anthropic.ContentBlock[], stop_reason: "end_turn" },
      { content: [{ type: "tool_use", id: "t1", name: "consultar_disponibilidad", input: {} }] as Anthropic.ContentBlock[], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Tengo el martes a las 10. ¿Le sirve?", citations: null }] as Anthropic.ContentBlock[], stop_reason: "end_turn" },
      { content: [{ type: "text", text: "FIN", citations: null }] as Anthropic.ContentBlock[], stop_reason: "end_turn" },
    ];
    const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
    const create = vi.fn(async () => ({ ...replies.shift(), usage }));
    const client = { messages: { create } } as unknown as Anthropic;
    const sim = await simulateConversation({
      prompt: "Sos Sofi de {{clinic_name}}", vars: { clinic_name: "Plaza" }, scenario: "Pedís un turno.",
      mocks: { consultar_disponibilidad: { ok: true, turnos: [] } }, history: [], client,
    });
    expect(sim.ended).toBe("paciente");
    expect(sim.lines.map((l) => l.role)).toEqual(["paciente", "sofi"]);
    expect(sim.lines[1].tools[0]).toMatchObject({ name: "consultar_disponibilidad", error: false });
    expect(sim.usage.usd).toBeGreaterThan(0);
    const sofiCall = (create.mock.calls[1] as unknown as [{ system: Array<{ text: string }> }])[0];
    expect(sofiCall.system[0].text).toBe("Sos Sofi de Plaza");
  });
});

describe("corridas v2", () => {
  it("una charla falla si baja de 85, es crítica o no cumple una condición", () => {
    expect(failed(90, false, [{ pass: true }])).toBe(false);
    expect(failed(84, false, [])).toBe(true);
    expect(failed(95, true, [])).toBe(true);
    expect(failed(95, false, [{ pass: false }])).toBe(true);
  });

  it("cada caso vale el promedio de sus charlas y el ± sale de los repetidos", () => {
    const agg = aggregateRun([
      { case_id: "a", repetition: 1, score: 90, critical: false, dims: null },
      { case_id: "b", repetition: 1, score: 60, critical: false, dims: null },
      { case_id: "b", repetition: 2, score: 80, critical: false, dims: null },
      { case_id: "b", repetition: 3, score: 70, critical: false, dims: null },
    ], {});
    expect(agg.score).toBe(80);
    expect(agg.spread).toBe(10);
  });

  it("marca inestables los casos con más de 20 puntos entre repeticiones", () => {
    expect(unstableCases([
      { case_id: "a", repetition: 1, score: 40, critical: false, dims: null },
      { case_id: "a", repetition: 2, score: 90, critical: false, dims: null },
      { case_id: "b", repetition: 1, score: 80, critical: false, dims: null },
      { case_id: "b", repetition: 2, score: 90, critical: false, dims: null },
    ])).toEqual(["a"]);
  });

  it("suma el costo del simulador, el juez y ElevenLabs", () => {
    expect(runCost({ simulador: { usd: 0.2 } as never, juez: { usd: 0.05, tokens_entrada: 0, tokens_salida: 0, llamadas: 1 }, elevenlabs: { v: 2, usd: 1, simulaciones: 1, con_datos: 1, creditos: 1, llm_usd: 1 } } as never)).toBeCloseTo(1.25);
  });

  it("un experimento focalizado toma lo que falló y los casos críticos, hasta 8", () => {
    const all = referenceCases();
    const picked = focusedCases(all, [{ case_id: "viernes", dims: { exactitud: 40 } }], "exactitud");
    expect(picked.length).toBeLessThanOrEqual(8);
    expect(picked.map((c) => c.id)).toContain("viernes");
    expect(picked.map((c) => c.id)).toContain("urgencia-alarma");
  });
});
