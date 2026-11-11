import { describe, expect, it } from "vitest";
import { executionDays, lastDays, weeklyByType, type DayExecution, type QueueDayRow } from "./followup-results";

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
  });
  it("counts each type's sends and conversions per week", () => {
    const out = weeklyByType([ex("a", "sin-saludo", "2026-11-10T13:00:00Z")], new Map([["a", 0]]), label, 1, now);
    expect(out["Paso 1: el saludo"]).toEqual([{ week: "2026-11-13", executed: 1, conversions: 1 }]);
  });
});
