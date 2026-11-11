import { describe, expect, it } from "vitest";
import { capFirstContacts, executionDays, funnelCohorts, lastDays, messageExecutions, queueDayState, weeklyByType, type DayExecution, type QueueDayRow } from "./followup-results";

const now = new Date("2026-11-11T15:00:00Z");
const label = (stage: string) => (stage === "sin-saludo" ? "Paso 1: el saludo" : "Llevar a: demo visitada");
const ex = (id: string, stage: string, sent: string, o: Partial<DayExecution> = {}): DayExecution => ({ outreach_id: id, stage, from_step: -1, status: "sent", sent_at: sent, updated_at: sent, ...o });
const row = (day: string, id: string, stage: string, state: QueueDayRow["state"] = "lista"): QueueDayRow => ({ day, outreach_id: id, stage, state });

describe("executionDays (Turnia)", () => {
  it("uses Buenos Aires days", () => {
    expect(lastDays(2, now)).toEqual(["2026-11-10", "2026-11-11"]);
  });
  it("splits the day by type: person or bot, converted, blocked, not taken and rescheduled", () => {
    const rows = [row("2026-11-10", "a", "sin-saludo"), row("2026-11-10", "b", "sin-saludo", "bloqueada"), row("2026-11-10", "c", "sin-saludo", "programada"), row("2026-11-10", "d", "sin-saludo")];
    const list = [ex("a", "sin-saludo", "2026-11-10T13:00:00Z"), ex("e", "sin-saludo", "2026-11-10T14:00:00Z", { executed_by: "bot" }), ex("f", "demo-sin-abrir", "2026-11-10T14:00:00Z", { status: "failed", sent_at: null, from_step: 1 })];
    const [day] = executionDays(rows, list, new Map([["a", 0], ["e", -1]]), label, 2, now);
    expect(day.captured).toBe(true);
    expect(day.types.find((t) => t.type === "Paso 1: el saludo")).toEqual({
      type: "Paso 1: el saludo", stages: ["sin-saludo"], pending: 4, human: 1, bot: 1, successHuman: 1, successBot: 0, blocked: 1, unclaimed: 1, failed: 0, scheduled: 1,
    });
    expect(day.types.find((t) => t.stages.includes("demo-sin-abrir"))).toMatchObject({ pending: 1, failed: 1 });
    expect(day.stages.find((s) => s.stage === "sin-saludo")).toEqual({ stage: "sin-saludo", pending: 4, executed: 2, success: 1 });
  });
  it("counts each type's sends and conversions per week", () => {
    const out = weeklyByType([ex("a", "sin-saludo", "2026-11-10T13:00:00Z")], new Map([["a", 0]]), label, 1, now);
    expect(out["Paso 1: el saludo"]).toEqual([{ week: "2026-11-15", executed: 1, conversions: 1 }]);
  });
});

describe("los mensajes que salieron sin «Confirmar envío» (Turnia)", () => {
  const steps: Record<string, number> = { "sin-saludo": -1, "saludo-sin-demo": 0, "demo-sin-abrir": 1, "abrio-sin-conversar": 2 };
  const stepOf = (s: string) => steps[s] ?? null;
  it("cuentan como ejecutados, una vez por persona, día y etapa, salvo un envío ya confirmado ese día", () => {
    const events = [
      { outreach_id: "a", detail: "saludo", created_at: "2026-11-10T13:00:00Z" },
      { outreach_id: "b", detail: "primero", created_at: "2026-11-10T13:00:00Z" },
      { outreach_id: "c", detail: "seguimiento", created_at: "2026-11-10T13:00:00Z" },
      { outreach_id: "d", detail: "seguimiento", created_at: "2026-11-10T13:00:00Z" }, // la foto del día la tenía en «abrió, sin conversar»
      { outreach_id: "e", detail: "saludo", created_at: "2026-11-10T13:00:00Z" }, // ya confirmado desde Follow-up
      { outreach_id: "a", detail: "saludo", created_at: "2026-11-10T13:05:00Z" }, // repetido
      { outreach_id: "f", detail: "ya le había escrito", created_at: "2026-11-10T13:00:00Z" },
      { outreach_id: "g", detail: "Pedido de feedback", created_at: "2026-11-10T13:00:00Z" }, // sin etapa ni foto
    ];
    const out = messageExecutions(events, [row("2026-11-10", "d", "abrio-sin-conversar")], [ex("e", "sin-saludo", "2026-11-10T12:00:00Z")], stepOf);
    expect(out.map((e) => [e.outreach_id, e.stage, e.from_step])).toEqual([
      ["a", "sin-saludo", -1], ["b", "saludo-sin-demo", 0], ["c", "demo-sin-abrir", 1], ["d", "abrio-sin-conversar", 2],
    ]);
  });
  it("el saludo es exitoso si respondieron después; el resto, si avanzó de paso", () => {
    const list = [ex("a", "sin-saludo", "2026-11-10T13:00:00Z"), ex("b", "sin-saludo", "2026-11-10T13:00:00Z"), ex("c", "demo-sin-abrir", "2026-11-10T13:00:00Z", { from_step: 1 })];
    const replies = new Map([["a", Date.parse("2026-11-10T15:00:00Z")], ["b", Date.parse("2026-11-09T15:00:00Z")]]);
    const [day] = executionDays([], list, new Map([["a", 0], ["b", 0], ["c", 2]]), (s) => s, 2, now, replies);
    expect(day.types.find((t) => t.type === "sin-saludo")).toMatchObject({ human: 2, successHuman: 1 });
    expect(day.types.find((t) => t.type === "demo-sin-abrir")).toMatchObject({ human: 1, successHuman: 1 });
  });
});

describe("funnelCohorts (Turnia)", () => {
  it("counts each greeting week with the Follow-up stages from Saludado", () => {
    const T = [0, 1, 2, 3, 4, 5, 6];
    const p = (firstContact: string | null, step: number, greetingVersion: number | null = 2) => ({ firstContact, step, greetingVersion });
    const list = [p("2026-11-09T13:00:00Z", 0), p("2026-11-10T13:00:00Z", 2), p("2026-11-10T14:00:00Z", 6), p(null, -1)];
    expect(funnelCohorts(list, T, "contacto", 1, now)).toEqual([{ cohort: "2026-11-15", size: 3, reached: [3, 2, 2, 1, 1, 1, 1] }]);
    expect(funnelCohorts(list, T, "version", 8, now)).toEqual([{ cohort: "Saludo V2", size: 3, reached: [3, 2, 2, 1, 1, 1, 1] }]);
  });
});

describe("lo que le corresponde a hoy (Turnia)", () => {
  it("deja afuera el tope de saludos, lo de otro día y lo que espera respuesta", () => {
    expect(queueDayState({ blocked: "Tope de 50 contactos nuevos por día: ya se saludó a 50 hoy." }, now)).toBe("programada");
    expect(queueDayState({ blocked: "Sin WhatsApp: es un fijo o no tiene celular." }, now)).toBe("bloqueada");
    expect(queueDayState({ dueAt: "2026-11-13T12:00:00.000Z" }, now)).toBe("programada");
    expect(queueDayState({ blocked: "Fuera de horario: de lunes a sábado, de 8:30 a 20." }, now)).toBe("lista");
  });
  it("de los saludos listos, solo los que entran en el cupo que queda hoy", () => {
    const rows = [
      { stage: "sin-saludo", state: "lista" as const }, { stage: "sin-saludo", state: "lista" as const },
      { stage: "sin-saludo", state: "bloqueada" as const }, { stage: "sin-saludo", state: "lista" as const },
      { stage: "demo-sin-abrir", state: "lista" as const },
    ];
    // El trabado por un dato tampoco es de hoy.
    expect(capFirstContacts(rows, "sin-saludo", 2).map((r) => r.state)).toEqual(["lista", "lista", "programada", "programada", "lista"]);
  });
});
