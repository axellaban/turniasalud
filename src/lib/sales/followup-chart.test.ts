import { describe, expect, it } from "vitest";
import { chartRange, commercialChart, type ChartPerson } from "./followup-chart";

const now = new Date("2026-11-11T15:00:00Z");
const p = (id: string, step: number, greetedAt: string | null, lost = false): ChartPerson => ({ id, name: id, phone: "2235000000", greetedAt, step, lost });

describe("commercialChart (Turnia)", () => {
  it("counts who reached each step or further, from the greeted, with the lost at their step", () => {
    const people = [p("a", 0, "2026-11-10T13:00:00Z"), p("b", 1, "2026-11-10T13:00:00Z", true), p("c", 3, "2026-11-09T13:00:00Z"), p("d", 6, "2026-11-01T13:00:00Z"), p("e", -1, null)];
    const { chart, lostAt, chartRows } = commercialChart(people, { periodo: "todo" }, now);
    expect(chart.map((x) => x.count)).toEqual([4, 3, 2, 2, 1, 1, 1]);
    expect(chart[1].ofPrevious).toBe(75);
    expect(chart[0].ofPrevious).toBeNull();
    expect(lostAt).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(chartRows.map((r) => r.agencyId)).toEqual(["a", "b", "c", "d"]);
  });
  it("filters by the greeting day in Buenos Aires", () => {
    const people = [p("a", 0, "2026-11-11T02:00:00Z"), p("b", 2, "2026-11-11T13:00:00Z")];
    // 02:00 UTC del 11 es el 10 en Buenos Aires.
    expect(commercialChart(people, { periodo: "hoy" }, now).chart[0].count).toBe(1);
    expect(commercialChart(people, { desde: "2026-11-10", hasta: "2026-11-10" }, now).chartRows.map((r) => r.agencyId)).toEqual(["a"]);
  });
  it("periods", () => {
    expect(chartRange({ periodo: "7" }, now)).toEqual({ from: "2026-11-05", to: "2026-11-11" });
    expect(chartRange({ periodo: "mes" }, now)).toEqual({ from: "2026-11-01", to: "2026-11-11" });
    expect(chartRange({ periodo: "todo" }, now)).toBeNull();
  });
});
