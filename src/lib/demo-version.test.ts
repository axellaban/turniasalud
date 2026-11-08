import { describe, expect, it } from "vitest";
import { DEMO_VERSION_HOGQL, ESFERA_DESDE, demoVersionAt } from "./demo-version";

describe("versión de la demo personal", () => {
  it("antes del deploy de la esfera es A; desde ahí, B", () => {
    expect(demoVersionAt("2026-11-07T15:26:44Z")).toBe("con_probar"); // se mergeó a las 12:26
    expect(demoVersionAt("2026-11-07T15:32:13Z")).toBe("esfera"); // primera visita con la esfera
    expect(demoVersionAt(new Date(ESFERA_DESDE))).toBe("esfera");
    expect(demoVersionAt(null)).toBeNull();
    expect(demoVersionAt("no es fecha")).toBeNull();
  });
  it("la regla de PostHog usa el mismo corte", () => {
    expect(DEMO_VERSION_HOGQL).toContain("toDateTime('2026-11-07 15:30:00')");
  });
});
