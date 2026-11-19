import { describe, expect, it } from "vitest";
import { CONSULTORIO, GARANTIAS_CONSULTORIO, PLANES, ahorroAnual } from "./precios";

// Lo que las páginas de precios prometen y tiene que cerrar entre sí.
describe("planes del Programa Fundadores", () => {
  const todos = [CONSULTORIO, ...PLANES];

  it("el pago anual son 10 meses repartidos en 12 (2 meses gratis)", () => {
    for (const p of todos) {
      expect(p.anual, p.nombre).toBe(Math.round((p.fundador * 10) / 12));
      expect(ahorroAnual(p), p.nombre).toBe(p.fundador * 12 - p.fundador * 10);
    }
  });

  it("la escalera sube de a un plan: precio y conversaciones; la lista siempre está arriba del precio fundador", () => {
    for (let i = 1; i < todos.length; i++) {
      expect(todos[i].fundador, todos[i].nombre).toBeGreaterThan(todos[i - 1].fundador);
      expect(todos[i].conversaciones, todos[i].nombre).toBeGreaterThan(todos[i - 1].conversaciones);
    }
    for (const p of todos) expect(p.lista, p.nombre).toBeGreaterThan(p.fundador);
    for (const p of PLANES) expect(p.setupLista, p.nombre).toBeGreaterThan(p.setupFundador);
  });

  it("/pricing: Core Access, Revenue Growth recomendado y Enterprise / Red", () => {
    expect(PLANES.map((p) => p.id)).toEqual(["core", "growth", "enterprise"]);
    expect(PLANES.filter((p) => p.destacado).map((p) => p.id)).toEqual(["growth"]);
  });

  it("Consultorio: un solo precio, sin voz, con una campaña por mes y sin la garantía de reactivación", () => {
    expect(CONSULTORIO.fundador).toBe(99);
    expect(CONSULTORIO.incluye.join(" ")).toMatch(/campaña/);
    expect(CONSULTORIO.noIncluye.join(" ")).toMatch(/voz/i);
    expect(GARANTIAS_CONSULTORIO.map((g) => g.plazo)).toEqual(["14 días", "30 días"]);
  });

  it("Core Access no tiene menos campaña que Consultorio", () => {
    const pacientesCore = Number(PLANES[0].reactivacion?.match(/hasta (\d+)/)?.[1]);
    expect(pacientesCore).toBeGreaterThan(CONSULTORIO.pacientesPorCampana);
  });
});
