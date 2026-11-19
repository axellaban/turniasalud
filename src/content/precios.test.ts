import { describe, expect, it } from "vitest";
import { PLANES, PLANES_TARJETA, plan } from "./precios";

// Lo que la página de precios promete y tiene que cerrar entre sí.
describe("planes del Programa Fundadores", () => {
  it("el pago anual son 10 meses repartidos en 12 (2 meses gratis)", () => {
    for (const p of PLANES) expect(p.anual, p.id).toBe(Math.round((p.fundador * 10) / 12));
  });

  it("la escalera sube de a un plan: precio, setup y conversaciones", () => {
    for (let i = 1; i < PLANES.length; i++) {
      const [antes, ahora] = [PLANES[i - 1], PLANES[i]];
      expect(ahora.fundador, ahora.id).toBeGreaterThan(antes.fundador);
      expect(ahora.setupFundador, ahora.id).toBeGreaterThan(antes.setupFundador);
      expect(ahora.conversaciones, ahora.id).toBeGreaterThan(antes.conversaciones);
      expect(ahora.lista, ahora.id).toBeGreaterThan(ahora.fundador);
      expect(ahora.setupLista, ahora.id).toBeGreaterThan(ahora.setupFundador);
    }
  });

  it("Consultorio: un profesional, solo WhatsApp, con campañas y sin retorno inventado", () => {
    const c = plan("consultorio");
    expect(c.minutos).toBe(0);
    expect(c.sillonExtra).toBeNull();
    expect(c.excedente.minuto).toBeNull();
    expect(c.reactivacion).toMatch(/campaña/);
    expect(c.retorno).toBeNull();
    expect(c.sePagaCon).toBeTruthy();
  });

  it("tres tarjetas, Enterprise / Red aparte y Core Access como recomendado", () => {
    expect(PLANES_TARJETA.map((p) => p.id)).toEqual(["consultorio", "core", "growth"]);
    expect(PLANES.filter((p) => p.destacado).map((p) => p.id)).toEqual(["core"]);
  });
});
