import { describe, expect, it } from "vitest";
import { DIMENSIONS, INTENTS, SITUATIONS, VALID_CELLS, isValidCell, referenceCases, resolveCondition } from "./cases";
import { aggregateRun, automaticChecks, band, caseWeights, compareRuns, conversationScore, questionsWithoutOpening, type ScoredResult } from "./score";
import { normalizeTranscript, transcriptText, type LabLine } from "./transcript";
import { applyPatches, patchProblem, promptHash } from "./prompt";

const sofi = (text: string, tools: LabLine["tools"] = []): LabLine => ({ role: "sofi", text, tools });
const patient = (text: string): LabLine => ({ role: "paciente", text, tools: [] });

describe("puntaje de una charla", () => {
  it("combina condiciones (70 %) y la nota del juez (30 %) y pesa las dimensiones", () => {
    const r = conversationScore({
      verdicts: [
        { dim: "exactitud", pass: true, text: "a" },
        { dim: "exactitud", pass: false, text: "b" },
        { dim: "trato", pass: true, text: "c" },
      ],
      judge: { seguridad: null, exactitud: 60, resolucion: 80, eficiencia: 90, trato: 100 },
    });
    // exactitud: 0,7·50 + 0,3·60 = 53; trato: 100; resolución 80; eficiencia 90; seguridad no aplica.
    expect(r.dims.exactitud).toBe(53);
    expect(r.dims.seguridad).toBeNull();
    expect(r.score).toBe(Math.round(((25 * 53 + 25 * 80 + 10 * 90 + 10 * 100) / 70) * 10) / 10);
    expect(r.critical).toBe(false);
  });

  it("una falla crítica deja la charla en 0", () => {
    const r = conversationScore({ verdicts: [{ dim: "seguridad", critical: true, pass: false, text: "guardia" }], judge: { trato: 100 } });
    expect(r.critical).toBe(true);
    expect(r.score).toBe(0);
    expect(conversationScore({ verdicts: [], judge: { trato: 90 }, judgeCritical: true }).score).toBe(0);
  });

  it("sin nada que puntuar no inventa un número", () => {
    expect(conversationScore({ verdicts: [], judge: {} }).score).toBeNull();
  });

  it("bandas: 85 o más muy bien, 70 a 84 bien, menos de 70 corregir", () => {
    expect(band(85)).toBe("muy_bien");
    expect(band(70)).toBe("bien");
    expect(band(69.9)).toBe("corregir");
    expect(band(null)).toBeNull();
  });
});

describe("puntaje de una corrida", () => {
  const rows: ScoredResult[] = [
    { case_id: "a", repetition: 1, score: 90, critical: false, dims: { trato: 90 } },
    { case_id: "b", repetition: 1, score: 70, critical: false, dims: { trato: 70 } },
    { case_id: "a", repetition: 2, score: 80, critical: false, dims: { trato: 80 } },
    { case_id: "b", repetition: 2, score: 60, critical: false, dims: { trato: 60 } },
  ];

  it("promedia las repeticiones y el ± es la mitad de la diferencia entre la mejor y la peor", () => {
    const agg = aggregateRun(rows, {});
    expect(agg.score).toBe(75);
    expect(agg.spread).toBe(5);
    expect(agg.dims.trato).toBe(75);
    expect(agg.dims.seguridad).toBeNull();
  });

  it("pesa cada caso por lo frecuente que es su motivo", () => {
    const agg = aggregateRun(rows.filter((r) => r.repetition === 1), { a: 3, b: 1 });
    expect(agg.score).toBe(85);
  });

  it("con una falla crítica el puntaje no pasa de 69", () => {
    const agg = aggregateRun([...rows, { case_id: "c", repetition: 1, score: 100, critical: true, dims: null }], {});
    expect(agg.criticalCount).toBe(1);
    expect(agg.score).toBe(69);
  });

  it("pesos por motivo: mínimo 2 % y repartido entre los casos del mismo motivo", () => {
    const w = caseWeights([{ id: "a", intent: "agendar" }, { id: "b", intent: "agendar" }, { id: "c", intent: "urgencia" }], { agendar: 0.6 });
    expect(w).toEqual({ a: 0.3, b: 0.3, c: 0.02 });
    expect(caseWeights([{ id: "a", intent: "agendar" }], {})).toEqual({ a: 1 });
  });

  it("compara dos corridas caso por caso y marca regresiones", () => {
    const base: ScoredResult[] = [
      { case_id: "a", repetition: 1, score: 60, critical: false, dims: null },
      { case_id: "b", repetition: 1, score: 90, critical: false, dims: null },
      { case_id: "c", repetition: 1, score: 80, critical: false, dims: null },
    ];
    const variant: ScoredResult[] = [
      { case_id: "a", repetition: 1, score: 85, critical: false, dims: null },
      { case_id: "b", repetition: 1, score: 75, critical: false, dims: null },
      { case_id: "c", repetition: 1, score: 0, critical: true, dims: null },
    ];
    const cmp = compareRuns(base, variant);
    expect(cmp.improved.map((c) => c.case_id)).toEqual(["a"]);
    expect(cmp.regressions.map((c) => c.case_id).sort()).toEqual(["b", "c"]);
  });
});

describe("controles automáticos", () => {
  it("afirmar una reserva sin herramienta es una falla crítica", () => {
    const checks = automaticChecks([patient("quiero el martes"), sofi("Listo, quedó reservado el martes.")]);
    const state = checks.find((c) => c.text.includes("reservado, cancelado o movido"));
    expect(state?.pass).toBe(false);
    expect(state?.critical).toBe(true);
  });

  it("con la herramienta que lo confirma, pasa", () => {
    const checks = automaticChecks([
      sofi("", [{ name: "reservar_turno", params: "{}", result: '{"ok":true}', error: false }]),
      sofi("Listo, quedó reservado el martes."),
    ]);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it("decir «no hay turnos» sin consultar la disponibilidad falla", () => {
    const checks = automaticChecks([sofi("No tengo turnos después de las 17 hasta enero.")]);
    expect(checks.find((c) => c.text.includes("no hay turnos"))?.pass).toBe(false);
  });

  it("no penaliza la falta de «¿»: es el estilo elegido para WhatsApp", () => {
    expect(questionsWithoutOpening("Hola. Quiere que la anote? ¿Le sirve el martes?")).toBe(1);
    expect(automaticChecks([sofi("Cuál le queda mejor?")]).every((c) => c.pass)).toBe(true);
  });

  it("negar un estado no es afirmarlo, y anular un pedido con la herramienta cuenta", () => {
    expect(automaticChecks([sofi("Perdón, el jueves 3/12 a las 12 se ocupó recién y no quedó reservado.")]).every((c) => c.pass)).toBe(true);
    const anulado = automaticChecks([
      sofi("", [{ name: "anular_tarea", params: "{}", result: '{"ok":true}', error: false }]),
      sofi("Listo, el pedido al doctor quedó cancelado."),
    ]);
    expect(anulado.every((c) => c.pass)).toBe(true);
  });
});

describe("charla de ElevenLabs", () => {
  it("une cada resultado con su llamada y junta las líneas de solo herramientas", () => {
    const lines = normalizeTranscript([
      { role: "user", message: "Hola" },
      { role: "agent", message: "", tool_calls: [{ request_id: "r1", tool_name: "consultar_disponibilidad", params_as_json: '{"desde":"2026-12-01"}' }] },
      { role: "agent", message: "", tool_results: [{ request_id: "r1", tool_name: "consultar_disponibilidad", result_value: '{"ok":true,"turnos":[]}', is_error: false }] },
      { role: "agent", message: "No hay lugar entre el 1/12 y el 14/12." },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[1].tools[0]).toMatchObject({ name: "consultar_disponibilidad", result: '{"ok":true,"turnos":[]}' });
    expect(transcriptText(lines)).toContain("[herramienta consultar_disponibilidad");
  });
});

describe("mejoras de prompt", () => {
  it("aplica los reemplazos que encajan una sola vez y avisa los que no", () => {
    const out = applyPatches("uno dos tres dos", [
      { id: "1", old_str: "uno", new_str: "UNO" },
      { id: "2", old_str: "dos", new_str: "DOS" },
      { id: "3", old_str: "cuatro", new_str: "4" },
    ]);
    expect(out.prompt).toBe("UNO dos tres dos");
    expect(out.applied).toEqual(["1"]);
    expect(out.failed.map((f) => f.id)).toEqual(["2", "3"]);
    expect(patchProblem("abc", { old_str: "b", new_str: "b" })).toMatch(/no cambia/);
    expect(applyPatches("precio $5", [{ id: "x", old_str: "$5", new_str: "$$6" }]).prompt).toBe("precio $$6");
  });

  it("el hash cambia con el prompt", () => {
    expect(promptHash("a")).not.toBe(promptHash("b"));
    expect(promptHash("a")).toHaveLength(10);
  });
});

describe("casos de referencia", () => {
  const cases = referenceCases();
  it("ids únicos, motivo, situación y dimensiones válidas", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(INTENTS).toContain(c.intent);
      expect(SITUATIONS).toContain(c.situation);
      expect(c.scenario.length).toBeGreaterThan(40);
      for (const spec of c.conditions) {
        const cond = resolveCondition(spec, { trato: "Tratás de usted" });
        expect(DIMENSIONS).toContain(cond.dim);
        expect(cond.text.length).toBeGreaterThan(10);
      }
    }
  });

  it("incluye el caso de la profesional mujer después de las 17", () => {
    const c = cases.find((x) => x.id === "profesional-mujer-tarde");
    expect(c?.situation).toBe("pide_profesional");
    expect(JSON.stringify(c?.mocks)).toContain("Busqué hasta el");
  });

  it("las fechas simuladas son futuras", () => {
    const today = new Date().toISOString().slice(0, 10);
    const dates = JSON.stringify(cases.map((c) => c.mocks)).match(/\d{4}-\d{2}-\d{2}T/g) ?? [];
    expect(dates.length).toBeGreaterThan(5);
    for (const d of dates) expect(d.slice(0, 10) >= today).toBe(true);
  });
});

describe("mapa de cobertura", () => {
  it("los tipos de caso válidos usan motivos y situaciones conocidos, sin repetir", () => {
    expect(new Set(VALID_CELLS.map(([i, s]) => `${i}|${s}`)).size).toBe(VALID_CELLS.length);
    for (const [i, s] of VALID_CELLS) {
      expect(INTENTS).toContain(i);
      expect(SITUATIONS).toContain(s);
    }
  });
  it("cada caso de referencia cae en un tipo de caso válido", () => {
    for (const c of referenceCases()) expect(isValidCell(c.intent, c.situation), c.id).toBe(true);
  });
});
